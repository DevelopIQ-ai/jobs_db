import { chromium, Page } from 'playwright';
import * as fs from 'fs';

const OUTPUT_DIR = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output';
const OUTPUT_FILE = `${OUTPUT_DIR}/us-jobs-unique.jsonl`;
const SEEN_FILE = `${OUTPUT_DIR}/seen-collapse-keys.json`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress-deduped.json`;

const US_FILTER = {
  locations: [{
    formatted_address: 'United States',
    types: ['country'],
    geometry: { location: { lat: '37.0902', lon: '-95.7129' } },
    id: 'user_country',
    address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }]
  }],
  workplaceTypes: ['Remote', 'Hybrid', 'Onsite'],
  dateFetchedPastNDays: 120,
  searchQuery: ''
};

const PAGE_SIZE = 40;
const DELAY_MS = 500;  // Increased to avoid rate limiting
const TARGET_UNIQUE = 160000;  // Stop after ~160k unique jobs
const MAX_RETRIES = 5;
const BACKOFF_MS = 5000;  // 5 second backoff on errors

function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<ul[^>]*>/gi, '\n').replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '\n').replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"').replace(/&ldquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\n\s*\n\s*\n/g, '\n\n').replace(/  +/g, ' ').trim();
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
    title: info.title || processed.core_job_title || '',
    description_md: htmlToMarkdown(info.description || ''),
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

async function fetchPage(page: Page, encodedFilter: string, pageNum: number): Promise<any[]> {
  return page.evaluate(async ({ filter, size, pageNum }) => {
    const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(filter)}&size=${size}&page=${pageNum}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.results || [];
  }, { filter: encodedFilter, size: PAGE_SIZE, pageNum });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load or init seen collapse keys
  let seenKeys: Set<string>;
  let startPage = 0;
  let totalUnique = 0;

  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    startPage = progress.lastPage + 1;
    totalUnique = progress.totalUnique;
    const seenArray = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    seenKeys = new Set(seenArray);
    console.log(`Resuming from page ${startPage} (${totalUnique} unique jobs)`);
  } else {
    seenKeys = new Set();
    fs.writeFileSync(OUTPUT_FILE, '');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('=== Deduped US Jobs Scrape ===\n');
  console.log('Initializing...');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  const encodedFilter = Buffer.from(JSON.stringify(US_FILTER)).toString('base64');

  // Get total count
  const countResponse = await page.evaluate(async (filter: string) => {
    const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(filter)}`;
    const resp = await fetch(url);
    return resp.json();
  }, encodedFilter);

  console.log(`Total: ${countResponse.total?.toLocaleString()}, Unique target: ${countResponse.collapsedTotal?.toLocaleString()}`);
  console.log(`Starting from page ${startPage}`);
  console.log('');

  const startTime = Date.now();
  let pageNum = startPage;
  let emptyPages = 0;
  let errors = 0;
  let totalFetched = 0;
  const MAX_EMPTY_PAGES = 5;
  const MAX_ERRORS = 20;  // Allow more retries with backoff

  const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

  while (totalUnique < TARGET_UNIQUE && emptyPages < MAX_EMPTY_PAGES && errors < MAX_ERRORS) {
    try {
      const jobs = await fetchPage(page, encodedFilter, pageNum);
      totalFetched += jobs.length;

      if (jobs.length === 0) {
        emptyPages++;
        console.log(`Page ${pageNum}: empty (${emptyPages}/${MAX_EMPTY_PAGES})`);
      } else {
        emptyPages = 0;
        let newUnique = 0;

        for (const job of jobs) {
          const collapseKey = job.collapse_key;
          if (!seenKeys.has(collapseKey)) {
            seenKeys.add(collapseKey);
            const transformed = transformJob(job);
            outputStream.write(JSON.stringify(transformed) + '\n');
            totalUnique++;
            newUnique++;
          }
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const uniquePerSec = totalUnique / elapsed;
        const remaining = TARGET_UNIQUE - totalUnique;
        const etaMins = Math.round(remaining / uniquePerSec / 60);
        const dupeRate = Math.round((1 - totalUnique / totalFetched) * 100);

        if (pageNum % 20 === 0 || pageNum < 5) {
          console.log(`Page ${pageNum}: +${newUnique} new | Unique: ${totalUnique.toLocaleString()}/${TARGET_UNIQUE.toLocaleString()} | Dupe: ${dupeRate}% | ETA: ${etaMins}min`);
        }

        // Save progress every 50 pages
        if (pageNum % 50 === 0) {
          fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
          fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
            lastPage: pageNum,
            totalUnique,
            totalFetched,
            timestamp: new Date().toISOString()
          }));
        }
      }

      pageNum++;
      await page.waitForTimeout(DELAY_MS);

    } catch (err: any) {
      errors++;
      const backoff = BACKOFF_MS * Math.pow(2, Math.min(errors - 1, 4));  // Exponential backoff, max 80s
      console.error(`Page ${pageNum}: ERROR - ${err.message} (${errors}/${MAX_ERRORS}) - waiting ${backoff/1000}s`);
      await page.waitForTimeout(backoff);

      // Refresh page context on repeated errors
      if (errors >= 3) {
        console.log('Refreshing browser context...');
        await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });
      }
    }
  }

  outputStream.close();

  // Save final state
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    lastPage: pageNum,
    totalUnique,
    totalFetched,
    timestamp: new Date().toISOString(),
    completed: totalUnique >= TARGET_UNIQUE || emptyPages >= MAX_EMPTY_PAGES
  }));

  await browser.close();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n=== Complete ===');
  console.log(`Unique jobs: ${totalUnique.toLocaleString()}`);
  console.log(`Total fetched: ${totalFetched.toLocaleString()}`);
  console.log(`Dupe rate: ${Math.round((1 - totalUnique / totalFetched) * 100)}%`);
  console.log(`Pages: ${pageNum - startPage}`);
  console.log(`Time: ${Math.round(elapsed / 60)}min`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
