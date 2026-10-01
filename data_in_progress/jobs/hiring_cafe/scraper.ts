import { chromium } from "playwright";
import * as fs from "fs";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
  getRecordEntityType,
} from "../../../lib/source-config";

// SSR-based scraper: pulls job data from __NEXT_DATA__.props.pageProps.ssrHits
// on public search pages. Works without the /api/search-jobs endpoint, which
// Cloudflare challenges on datacenter IPs. Only the first page per query is
// SSR'd, so coverage comes from slicing across industries.txt.
//
// usage:
//   npx tsx scraper.ts [maxIndustries] [daysLookback] [--fresh] [--retry-failed]
//
// Refresh semantics:
//   - Rows stream into output/leads-inprogress.jsonl; output/leads.jsonl always
//     holds the last COMPLETED snapshot, so the loader's default input never
//     disappears or turns partial mid-sweep.
//   - When a sweep finishes, the previous leads.jsonl moves to
//     output/archive/leads-<epoch>.jsonl and the in-progress file is promoted.
//   - An interrupted sweep resumes from output/scrape-progress.json and rebuilds
//     its dedupe set from leads-inprogress.jsonl (within-run only — runs never
//     dedupe against a previous run's output).
//   - Once a sweep completes, the next launch starts a fresh sweep; --fresh
//     forces it.
//   - Challenged/errored industries are recorded by name in
//     output/failed-industries.json and retried once automatically at the end of
//     the sweep; --retry-failed runs only that retry pass (appending into the
//     current leads.jsonl).

const SCRAPER_DIR = __dirname;
const config = loadSourceConfig(SCRAPER_DIR);
const paths = getOutputPaths(SCRAPER_DIR);

const INPROGRESS_FILE = `${paths.outputDir}/leads-inprogress.jsonl`;
const FAILED_FILE = `${paths.outputDir}/failed-industries.json`;
const LOCK_FILE = `${paths.outputDir}/scrape.lock`;
const ARCHIVE_DIR = `${paths.outputDir}/archive`;
const DOC_FILE = `${paths.outputDir}/process_documentation.txt`;
const INDUSTRIES_FILE = `${SCRAPER_DIR}/industries.txt`;

const DELAY_MS = 2500;
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const FRESH = process.argv.includes("--fresh");
const RETRY_ONLY = process.argv.includes("--retry-failed");
const DAYS = Number(args[1] || 30);
const MAX_INDUSTRIES = Number(args[0] || 10);

const US_LOCATION = {
  formatted_address: "United States",
  types: ["country"],
  geometry: { location: { lat: "37.0902", lon: "-95.7129" } },
  id: "user_country",
  address_components: [{ long_name: "United States", short_name: "US", types: ["country"] }],
};

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/gi, "$1\n\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?(p|div|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"').replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/\n\s*\n\s*\n/g, "\n\n").replace(/  +/g, " ").trim();
}

// Flat job fields live in `context`; company fields live in `company`.
// Returns null when the hit lacks a usable company name (contract requires it).
function transformJob(job: any, scrapedAt: string): Record<string, unknown> | null {
  const processed = job.v5_processed_job_data || {};
  const info = job.job_information || {};
  const company = job.enriched_company_data || {};
  const companyName = company.name || processed.company_name || job.company_name;
  if (!companyName || typeof companyName !== "string") return null;

  const record: Record<string, unknown> = {
    core: {
      source_id: config.source_id,
      entity_type: getRecordEntityType(config, "company"),
      scraped_at: scrapedAt,
      raw_url: job.apply_url || "",
      primary_key: "",
    },
    company: {
      company_name: companyName,
      domain: company.homepage_uri || undefined,
      website: company.homepage_uri || undefined,
      industry: company.industries || undefined,
      location: company.hq_country ? { country: company.hq_country } : undefined,
    },
    contact: {},
    context: {
      job_id: job.id,
      collapse_key: job.collapse_key,
      source: job.source,
      apply_url: job.apply_url,
      title: info.title || processed.core_job_title || "",
      description_md: htmlToMarkdown(info.description || ""),
      workplace_type: processed.workplace_type || null,
      locations: processed.workplace_cities || processed.workplace_states || null,
      commitment: processed.commitment || null,
      seniority_level: processed.seniority_level || null,
      salary_min_yearly: processed.yearly_min_compensation || null,
      salary_max_yearly: processed.yearly_max_compensation || null,
      company_domain: company.homepage_uri || null,
      company_industry: company.industries || null,
      company_hq_country: company.hq_country || null,
      company_employee_count: company.nb_employees || null,
      company_year_founded: company.year_founded || null,
      company_organization_type: company.organization_type || null,
      funding_type: company.latest_funding_type || null,
      funding_year: company.latest_funding_year || null,
      funding_amount: company.latest_funding_amount || null,
      funding_investors: company.latest_funding_investors || null,
      stock_exchange: company.stock_exchange || null,
      stock_symbol: company.stock_symbol || null,
    },
  };
  (record.core as any).primary_key = generatePrimaryKey(config, record);
  return record;
}

function searchUrl(state: object): string {
  return `https://hiringcafe.com/?searchState=${encodeURIComponent(JSON.stringify(state))}`;
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path, "utf-8")); } catch { return fallback; }
}

function saveFailed(names: ReadonlySet<string>) {
  fs.writeFileSync(FAILED_FILE, JSON.stringify({ industries: [...names].sort(), ts: new Date().toISOString() }));
}

// A stale lock must not outlive the scraper it names: beyond PID liveness we
// verify the live process is actually this scraper, so a reused PID can't pin
// the lock forever.
function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(readJson<{ pid?: number }>(LOCK_FILE, {}).pid);
    if (pid && pid !== process.pid) {
      let isScraper = false;
      try {
        isScraper = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8").includes("scraper.ts");
      } catch {}
      if (isScraper) {
        console.log(`Another scraper.ts is running (pid ${pid}) — exiting`);
        return false;
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
  return true;
}

function loadDedupeFrom(file: string, seen: Set<string>) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ctx = (JSON.parse(line) as any).context || {};
      if (ctx.collapse_key) seen.add(ctx.collapse_key);
      if (ctx.job_id) seen.add(ctx.job_id);
    } catch {}
  }
}

// Promote leads-inprogress.jsonl to leads.jsonl, archiving the previous
// snapshot. leads.jsonl only ever changes to a fully completed file.
function promoteCompleted() {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (fs.existsSync(paths.leadsFile)) {
    const dest = `${ARCHIVE_DIR}/leads-${Date.now()}.jsonl`;
    fs.renameSync(paths.leadsFile, dest);
    console.log(`Archived previous snapshot -> ${dest}`);
  }
  fs.renameSync(INPROGRESS_FILE, paths.leadsFile);
}

function writeReviewSample() {
  const lines = fs.existsSync(paths.leadsFile)
    ? fs.readFileSync(paths.leadsFile, "utf-8").split("\n").filter(Boolean)
    : [];
  const sample: unknown[] = [];
  const n = Math.min(20, lines.length);
  const used = new Set<number>();
  while (sample.length < n) {
    const i = Math.floor(Math.random() * lines.length);
    if (used.has(i)) continue;
    used.add(i);
    const r = JSON.parse(lines[i]);
    sample.push({ core: r.core, company: r.company, contact: r.contact, context: r.context });
  }
  fs.writeFileSync(paths.reviewSampleFile, JSON.stringify(sample, null, 2));
}

function appendDoc(entry: string) {
  fs.appendFileSync(DOC_FILE, `\n=== ${new Date().toISOString()} ===\n${entry}\n`);
}

interface SweepResult { hits: number; added: number; skipped: number; ok: boolean }

async function scrapeIndustry(browser: any, industry: string, targetFile: string, seen: Set<string>, scrapedAt: string): Promise<SweepResult> {
  const state = {
    searchQuery: "",
    industries: [industry],
    locations: [US_LOCATION],
    workplaceTypes: ["Remote", "Hybrid", "Onsite"],
    dateFetchedPastNDays: DAYS,
  };

  // CF gives each fresh browser context one clean document load — rotate
  // contexts per industry instead of reusing one page.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    let d: any = null;
    await page.goto(searchUrl(state), { waitUntil: "domcontentloaded", timeout: 30000 });
    for (let w = 0; w < 10 && !d; w++) {
      await page.waitForTimeout(2500);
      d = await page.evaluate(() => {
        const el = document.getElementById("__NEXT_DATA__");
        if (!el) return null;
        const pp = JSON.parse(el.textContent || "{}")?.props?.pageProps || {};
        return { total: pp.ssrTotalCount, hits: pp.ssrHits || [], title: document.title };
      });
    }

    if (!d) {
      console.log(`[${industry}]: challenged, skipping`);
      return { hits: 0, added: 0, skipped: 0, ok: false };
    }

    // rows flush synchronously before the checkpoint write — a crash between
    // the two can never lose rows the progress file marks done
    let added = 0;
    let skipped = 0;
    for (const hit of d.hits) {
      const key = hit.collapse_key || hit.id;
      if (!key) { skipped++; continue; }
      if (seen.has(key)) continue;
      const rec = transformJob(hit, scrapedAt);
      if (!rec) { skipped++; continue; }
      seen.add(key);
      fs.appendFileSync(targetFile, JSON.stringify(rec) + "\n");
      added++;
    }
    console.log(`[${industry}]: ${d.hits.length} hits, +${added} new${skipped ? `, ${skipped} skipped (no company_name)` : ""} (total ${d.total} avail)`);
    return { hits: d.hits.length, added, skipped, ok: true };
  } catch (err: any) {
    console.error(`[${industry}]: ERROR ${err.message}`);
    return { hits: 0, added: 0, skipped: 0, ok: false };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const runStart = new Date().toISOString();
  const industries = fs.readFileSync(INDUSTRIES_FILE, "utf-8").split("\n").map(s => s.trim()).filter(Boolean);
  const slice = industries.slice(0, MAX_INDUSTRIES);
  ensureOutputDir(SCRAPER_DIR);

  if (!acquireLock()) return;
  const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
  process.on("exit", releaseLock);

  let totalNew = 0;
  let totalHits = 0;
  let totalSkipped = 0;

  if (RETRY_ONLY) {
    // retry-only: append into the current completed snapshot; dedupe against
    // it so retries never duplicate rows already written
    const seen = new Set<string>();
    loadDedupeFrom(paths.leadsFile, seen);
    const names = new Set<string>(readJson(FAILED_FILE, { industries: [] }).industries || []);
    if (names.size === 0) {
      console.log("No failed industries recorded — nothing to retry");
      releaseLock();
      return;
    }
    const browser = await chromium.launch({ headless: false });
    for (const name of [...names]) {
      const r = await scrapeIndustry(browser, name, paths.leadsFile, seen, runStart);
      totalNew += r.added; totalHits += r.hits; totalSkipped += r.skipped;
      if (r.ok) names.delete(name);
      saveFailed(names);
      await new Promise(r2 => setTimeout(r2, DELAY_MS));
    }
    await browser.close();
    console.log(`Retry pass done — ${names.size} still failing`);
  } else {
    // normal sweep — resume support: dedupe rebuilds only from this run's
    // in-progress file, counters restore from the checkpoint
    const seen = new Set<string>();
    loadDedupeFrom(INPROGRESS_FILE, seen);
    if (seen.size) console.log(`Loaded ${seen.size} in-progress keys`);

    let startIdx = 0;
    const failed = new Set<string>(readJson(FAILED_FILE, { industries: [] }).industries || []);
    if (fs.existsSync(paths.progressFile)) {
      const prog = readJson(paths.progressFile, { nextIndustryIdx: 0 });
      startIdx = prog.nextIndustryIdx || 0;
      totalNew = (prog as any).totalNew || 0;
      totalHits = (prog as any).totalHits || 0;
      totalSkipped = (prog as any).totalSkipped || 0;
    }

    const sweepComplete = startIdx >= slice.length;
    const inprogressHasRows = fs.existsSync(INPROGRESS_FILE) && fs.statSync(INPROGRESS_FILE).size > 0;

    if (sweepComplete && inprogressHasRows && !FRESH) {
      // crashed between the last checkpoint and promotion — finish the
      // pending work (retry leftovers, then promote) before starting fresh
      console.log("Recovering unpromoted sweep…");
      if (failed.size > 0) {
        const browser = await chromium.launch({ headless: false });
        console.log(`Retrying ${failed.size} failed industries…`);
        for (const name of [...failed]) {
          const r = await scrapeIndustry(browser, name, INPROGRESS_FILE, seen, runStart);
          totalNew += r.added; totalHits += r.hits; totalSkipped += r.skipped;
          if (r.ok) failed.delete(name);
          saveFailed(failed);
          await new Promise(r2 => setTimeout(r2, DELAY_MS));
        }
        await browser.close();
      }
      promoteCompleted();
      updateDataAsOf(SCRAPER_DIR);
      writeReviewSample();
    }

    if (FRESH || sweepComplete) {
      // a completed (or forced-fresh) sweep starts over; the previous snapshot
      // stays at leads.jsonl until this one is promoted at completion.
      // never delete collected rows — archive any leftovers instead
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
      if (fs.existsSync(INPROGRESS_FILE)) {
        fs.renameSync(INPROGRESS_FILE, `${ARCHIVE_DIR}/leads-inprogress-${Date.now()}.jsonl`);
      }
      for (const f of [paths.progressFile, FAILED_FILE]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      seen.clear(); startIdx = 0; failed.clear();
      totalNew = 0; totalHits = 0; totalSkipped = 0;
      console.log(sweepComplete ? "Previous sweep complete — starting fresh" : "Fresh start (--fresh)");
    } else if (startIdx > 0) {
      console.log(`Resuming at industry #${startIdx}`);
    }

    const browser = await chromium.launch({ headless: false });

    for (let i = startIdx; i < slice.length; i++) {
      const industry = slice[i];
      const r = await scrapeIndustry(browser, industry, INPROGRESS_FILE, seen, runStart);
      totalNew += r.added; totalHits += r.hits; totalSkipped += r.skipped;
      if (r.ok) failed.delete(industry); else failed.add(industry);
      fs.writeFileSync(paths.progressFile, JSON.stringify({ nextIndustryIdx: i + 1, totalNew, totalHits, totalSkipped, ts: new Date().toISOString() }));
      saveFailed(failed);
      await new Promise(r2 => setTimeout(r2, DELAY_MS));
    }

    // automatic retry pass for challenged/errored industries
    if (failed.size > 0) {
      console.log(`\nRetrying ${failed.size} failed industries…`);
      for (const name of [...failed]) {
        const r = await scrapeIndustry(browser, name, INPROGRESS_FILE, seen, runStart);
        totalNew += r.added; totalHits += r.hits; totalSkipped += r.skipped;
        if (r.ok) failed.delete(name);
        saveFailed(failed);
        await new Promise(r2 => setTimeout(r2, DELAY_MS));
      }
      console.log(`Retry pass done — ${failed.size} still failing`);
    }

    await browser.close();
    promoteCompleted();
    updateDataAsOf(SCRAPER_DIR);
    writeReviewSample();
  }

  const stillFailing = readJson(FAILED_FILE, { industries: [] as string[] }).industries || [];
  fs.writeFileSync(paths.runFile, JSON.stringify({
    source_id: config.source_id,
    run_id: `run_${Date.now()}`,
    started_at: runStart,
    ended_at: new Date().toISOString(),
    records_found: totalHits,
    records_valid: totalNew,
    records_written: totalNew,
    error_count: stillFailing.length + totalSkipped,
    errors: [
      ...stillFailing.map((name: string) => ({ industry: name, message: "cloudflare_challenge" })),
      ...(totalSkipped ? [{ message: `${totalSkipped} records skipped: missing company_name` }] : []),
    ],
  }, null, 2));

  appendDoc(`mode=${RETRY_ONLY ? "retry-failed" : "sweep"} industries=${RETRY_ONLY ? "n/a" : slice.length} hits=${totalHits} written=${totalNew} skipped=${totalSkipped} run_id=run_${Date.now()}`);

  releaseLock();
  console.log(`\nDone: ${totalNew} records written to ${paths.leadsFile}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
