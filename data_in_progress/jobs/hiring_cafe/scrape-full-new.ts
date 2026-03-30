import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = './output';
const OUTPUT_FILE = `${OUTPUT_DIR}/us-jobs-full.jsonl`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress.json`;
const COOKIES_FILE = path.join(__dirname, 'cookies.json');

const PAGE_SIZE = 40;
const DELAY_MS = 200;

const US_FILTER = {
  locations: [{
    id: 'FxY1yZQBoEtHp_8UEq7V',
    types: ['country'],
    address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }],
    formatted_address: 'United States',
    population: 327167434,
    workplace_types: ['Remote', 'Hybrid', 'Onsite'],
    options: { flexible_regions: [] },
  }],
  workplaceTypes: ['Remote', 'Hybrid', 'Onsite'],
  dateFetchedPastNDays: 1,
  searchQuery: '',
};

// --- Cookie & header helpers ---

function loadCookies() {
  if (!fs.existsSync(COOKIES_FILE)) {
    throw new Error(
      'cookies.json not found. Visit hiring.cafe in Chrome, open DevTools > Network,\n' +
      'copy the cf_clearance cookie value, and create cookies.json with:\n' +
      '{ "cf_clearance": "<value>", "user_agent": "<your browser UA>" }'
    );
  }
  return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
}

function encodeFilter(filter: object): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(filter))).toString('base64');
}

function buildHeaders(cookies: { cf_clearance: string; user_agent: string }) {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': `cf_clearance=${cookies.cf_clearance}`,
    'referer': 'https://hiring.cafe/',
    'user-agent': cookies.user_agent,
    'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
}

// --- Data transformation ---

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

// --- API helpers ---

async function fetchPage(
  headers: Record<string, string>,
  encodedFilter: string,
  pageNum: number
): Promise<any[]> {
  const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encodedFilter)}&size=${PAGE_SIZE}&page=${pageNum}&sv=control`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.results || [];
}

async function getTotalCount(
  headers: Record<string, string>,
  encodedFilter: string
): Promise<{ total: number; collapsedTotal: number }> {
  const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encodedFilter)}&sv=control`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// --- Main ---

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const cookies = loadCookies();
  const headers = buildHeaders(cookies);
  const encodedFilter = encodeFilter(US_FILTER);

  // Resume support
  let startPage = 0;
  let totalWritten = 0;
  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    startPage = progress.lastPage + 1;
    totalWritten = progress.totalWritten;
    console.log(`Resuming from page ${startPage} (${totalWritten} jobs already written)`);
  } else {
    fs.writeFileSync(OUTPUT_FILE, '');
  }

  console.log('=== Full US Jobs Scrape (headless, no browser) ===\n');

  // Get total count to estimate pages
  const countData = await getTotalCount(headers, encodedFilter);
  const estimatedPages = Math.ceil(countData.total / PAGE_SIZE);
  console.log(`Total jobs: ${countData.total.toLocaleString()}`);
  console.log(`Unique jobs: ${countData.collapsedTotal.toLocaleString()}`);
  console.log(`Estimated pages: ${estimatedPages.toLocaleString()}`);
  console.log(`Starting from page: ${startPage}\n`);

  const startTime = Date.now();
  let pageNum = startPage;
  let emptyPages = 0;
  let errors = 0;
  const MAX_EMPTY_PAGES = 3;
  const MAX_ERRORS = 10;

  const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

  while (emptyPages < MAX_EMPTY_PAGES && errors < MAX_ERRORS) {
    try {
      const jobs = await fetchPage(headers, encodedFilter, pageNum);

      if (jobs.length === 0) {
        emptyPages++;
        console.log(`Page ${pageNum}: empty (${emptyPages}/${MAX_EMPTY_PAGES})`);
      } else {
        emptyPages = 0;
        const transformed = jobs.map(transformJob);

        for (const job of transformed) {
          outputStream.write(JSON.stringify(job) + '\n');
        }
        totalWritten += transformed.length;

        const elapsed = (Date.now() - startTime) / 1000;
        const pagesPerSec = (pageNum - startPage + 1) / elapsed;
        const remainingPages = estimatedPages - pageNum;
        const etaMins = Math.round(remainingPages / pagesPerSec / 60);

        if (pageNum % 10 === 0 || pageNum < 5) {
          console.log(`Page ${pageNum}/${estimatedPages}: +${jobs.length} jobs | Total: ${totalWritten.toLocaleString()} | ETA: ${etaMins}min`);
        }

        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
          lastPage: pageNum,
          totalWritten,
          timestamp: new Date().toISOString()
        }));
      }

      pageNum++;
      await new Promise(r => setTimeout(r, DELAY_MS));

    } catch (err: any) {
      errors++;
      console.error(`Page ${pageNum}: ERROR - ${err.message} (${errors}/${MAX_ERRORS})`);
      if (err.message.includes('403')) {
        console.error('Cookie expired. Refresh cf_clearance in cookies.json and re-run.');
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  outputStream.close();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n=== Complete ===');
  console.log(`Total jobs written: ${totalWritten.toLocaleString()}`);
  console.log(`Pages scraped: ${pageNum - startPage}`);
  console.log(`Time: ${Math.round(elapsed)}s (${Math.round(elapsed / 60)}min)`);
  console.log(`Output: ${OUTPUT_FILE}`);

  if (emptyPages >= MAX_EMPTY_PAGES) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Scrape completed successfully!');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
