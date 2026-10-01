import { chromium } from "playwright";
import * as fs from "fs";

// SSR-based scraper: pulls job data from __NEXT_DATA__.props.pageProps.ssrHits
// on public search pages. Works without the /api/search-jobs endpoint, which
// Cloudflare challenges on datacenter IPs. Only first page per query is SSR'd,
// so coverage comes from slicing across industries.txt.
//
// usage: npx tsx scrape-ssr.ts [maxIndustries] [daysLookback]

const OUTPUT_DIR = __dirname + "/output";
const OUTPUT_FILE = `${OUTPUT_DIR}/us-jobs-ssr.jsonl`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress-ssr.json`;
const INDUSTRIES_FILE = __dirname + "/industries.txt";

const DELAY_MS = 2500;
const DAYS = Number(process.argv[3] || 30);
const MAX_INDUSTRIES = Number(process.argv[2] || 10);

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

async function main() {
  const industries = fs.readFileSync(INDUSTRIES_FILE, "utf-8").split("\n").map(s => s.trim()).filter(Boolean);
  const slice = industries.slice(0, MAX_INDUSTRIES);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // resume support — rebuild the dedupe set from rows already written so
  // resumed runs don't re-append overlapping hits
  let startIdx = 0;
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
  if (fs.existsSync(PROGRESS_FILE)) {
    const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    startIdx = prog.nextIndustryIdx || 0;
    console.log(`Resuming at industry #${startIdx}`);
  }

  const out = fs.createWriteStream(OUTPUT_FILE, { flags: "a" });
  const browser = await chromium.launch({ headless: false });

  let totalNew = 0;
  let totalHits = 0;

  for (let i = startIdx; i < slice.length; i++) {
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
        continue;
      }

      let newCount = 0;
      for (const hit of d.hits) {
        const key = hit.collapse_key || hit.id;
        if (!seen.has(key)) {
          seen.add(key);
          out.write(JSON.stringify(transformJob(hit)) + "\n");
          newCount++;
        }
      }
      totalNew += newCount;
      totalHits += d.hits.length;
      console.log(`[${i}] ${industry}: ${d.hits.length} hits, +${newCount} new (total ${d.total} avail) | run total: ${totalNew}`);

      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ nextIndustryIdx: i + 1, totalNew, totalHits, ts: new Date().toISOString() }));
    } catch (err: any) {
      console.error(`[${i}] ${industry}: ERROR ${err.message}`);
    } finally {
      await ctx.close().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  out.close();
  await browser.close();
  console.log(`\nDone: ${totalNew} unique jobs written to ${OUTPUT_FILE}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
