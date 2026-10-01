import { chromium } from "playwright";
import * as fs from "fs";

// SSR-based scraper: pulls job data from __NEXT_DATA__.props.pageProps.ssrHits
// on public search pages. Works without the /api/search-jobs endpoint, which
// Cloudflare challenges on datacenter IPs. Only first page per query is SSR'd,
// so coverage comes from slicing across industries.txt.
//
// usage:
//   npx tsx scrape-ssr.ts [maxIndustries] [daysLookback] [--fresh] [--retry-failed]
//
// Resume semantics:
//   - An interrupted sweep resumes from output/progress-ssr.json.
//   - Once a sweep completes, the next launch archives the previous
//     output/leads.jsonl to leads-<epoch>.jsonl and starts a fresh sweep —
//     so periodic relaunches (cron/watchdog) actually re-scrape.
//   - --fresh forces that immediately.
//   - Challenged/errored industries are recorded in output/failed-ssr.json
//     and retried once automatically at the end of the sweep; --retry-failed
//     runs only that retry pass.

const OUTPUT_DIR = __dirname + "/output";
const OUTPUT_FILE = `${OUTPUT_DIR}/leads.jsonl`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress-ssr.json`;
const FAILED_FILE = `${OUTPUT_DIR}/failed-ssr.json`;
const LOCK_FILE = `${OUTPUT_DIR}/scrape-ssr.lock`;
const RUN_FILE = `${OUTPUT_DIR}/run.json`;
const INDUSTRIES_FILE = __dirname + "/industries.txt";

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

function transformJob(job: any): object {
  const processed = job.v5_processed_job_data || {};
  const info = job.job_information || {};
  const company = job.enriched_company_data || {};
  return {
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
    company_name: company.name || null,
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
    scraped_at: new Date().toISOString(),
  };
}

function searchUrl(state: object): string {
  return `https://hiringcafe.com/?searchState=${encodeURIComponent(JSON.stringify(state))}`;
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path, "utf-8")); } catch { return fallback; }
}

function saveFailed(idxs: ReadonlySet<number>) {
  fs.writeFileSync(FAILED_FILE, JSON.stringify({ failed: [...idxs].sort((a, b) => a - b), ts: new Date().toISOString() }));
}

function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(readJson<{ pid?: number }>(LOCK_FILE, {}).pid);
    let alive = false;
    if (pid) {
      try { process.kill(pid, 0); alive = true; } catch {}
    }
    if (alive) {
      console.log(`Another scrape-ssr is running (pid ${pid}) — exiting`);
      return false;
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
  return true;
}

function archiveForFreshRun() {
  if (fs.existsSync(OUTPUT_FILE)) {
    const dest = `${OUTPUT_DIR}/leads-${Date.now()}.jsonl`;
    fs.renameSync(OUTPUT_FILE, dest);
    console.log(`Archived previous output -> ${dest}`);
  }
  for (const f of [PROGRESS_FILE, FAILED_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function scrapeIndustry(browser: any, slice: string[], i: number, seen: Set<string>): Promise<{ hits: number; added: number; ok: boolean }> {
  const industry = slice[i];
  const state = {
    searchQuery: "",
    industries: [industry],
    locations: [US_LOCATION],
    workplaceTypes: ["Remote", "Hybrid", "Onsite"],
    dateFetchedPastNDays: DAYS,
  };

  // CF gives each fresh browser context one clean document load — rotate
  // contexts per slice instead of reusing one page.
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
      console.log(`[${i}] ${industry}: challenged, skipping`);
      return { hits: 0, added: 0, ok: false };
    }

    // append rows synchronously before the checkpoint is written — a crash
    // between the two can never lose rows that are marked done
    let added = 0;
    for (const hit of d.hits) {
      const key = hit.collapse_key || hit.id;
      if (!seen.has(key)) {
        seen.add(key);
        fs.appendFileSync(OUTPUT_FILE, JSON.stringify(transformJob(hit)) + "\n");
        added++;
      }
    }
    console.log(`[${i}] ${industry}: ${d.hits.length} hits, +${added} new (total ${d.total} avail)`);
    return { hits: d.hits.length, added, ok: true };
  } catch (err: any) {
    console.error(`[${i}] ${industry}: ERROR ${err.message}`);
    return { hits: 0, added: 0, ok: false };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const runStart = new Date().toISOString();
  const industries = fs.readFileSync(INDUSTRIES_FILE, "utf-8").split("\n").map(s => s.trim()).filter(Boolean);
  const slice = industries.slice(0, MAX_INDUSTRIES);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!acquireLock()) return;
  const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
  process.on("exit", releaseLock);

  // resume support — rebuild the dedupe set from rows already written so
  // resumed runs don't re-append overlapping hits
  const seen = new Set<string>();
  if (fs.existsSync(OUTPUT_FILE)) {
    for (const line of fs.readFileSync(OUTPUT_FILE, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.collapse_key) seen.add(row.collapse_key);
        if (row.job_id) seen.add(row.job_id);
      } catch {}
    }
    console.log(`Loaded ${seen.size} existing keys from output`);
  }

  let startIdx = 0;
  const failed = new Set<number>(readJson(FAILED_FILE, { failed: [] }).failed || []);
  if (fs.existsSync(PROGRESS_FILE)) {
    const prog = readJson(PROGRESS_FILE, { nextIndustryIdx: 0 });
    startIdx = prog.nextIndustryIdx || 0;
  }

  const sweepComplete = startIdx >= slice.length;
  if (FRESH || (sweepComplete && !RETRY_ONLY && failed.size === 0)) {
    archiveForFreshRun();
    seen.clear();
    startIdx = 0;
    failed.clear();
  } else if (startIdx > 0) {
    console.log(`Resuming at industry #${startIdx}`);
  }

  const browser = await chromium.launch({ headless: false });

  let totalNew = 0;
  let totalHits = 0;

  if (!RETRY_ONLY) {
    for (let i = startIdx; i < slice.length; i++) {
      const r = await scrapeIndustry(browser, slice, i, seen);
      totalNew += r.added;
      totalHits += r.hits;
      if (r.ok) {
        failed.delete(i);
      } else {
        failed.add(i);
      }
      // checkpoint after rows are flushed to leads.jsonl
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ nextIndustryIdx: i + 1, totalNew, totalHits, ts: new Date().toISOString() }));
      saveFailed(failed);
      await new Promise((r2) => setTimeout(r2, DELAY_MS));
    }
  }

  // retry pass for challenged/errored industries — runs automatically after a
  // sweep, or standalone via --retry-failed
  if (failed.size > 0) {
    console.log(`\nRetrying ${failed.size} failed industries…`);
    const retries = [...failed];
    for (const i of retries) {
      const r = await scrapeIndustry(browser, slice, i, seen);
      totalNew += r.added;
      totalHits += r.hits;
      if (r.ok) failed.delete(i);
      saveFailed(failed);
      await new Promise((r2) => setTimeout(r2, DELAY_MS));
    }
    console.log(`Retry pass done — ${failed.size} still failing`);
  }

  await browser.close();

  fs.writeFileSync(RUN_FILE, JSON.stringify({
    source_id: "jobs/hiring_cafe",
    run_id: `run_${Date.now()}`,
    started_at: runStart,
    ended_at: new Date().toISOString(),
    records_found: totalHits,
    records_valid: totalNew,
    records_written: totalNew,
    error_count: failed.size,
    errors: [...failed].map(i => ({ industry: slice[i], message: "cloudflare_challenge" })),
  }, null, 2));

  releaseLock();
  console.log(`\nDone: ${totalNew} unique jobs written to ${OUTPUT_FILE} (${failed.size} industries still failing)`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
