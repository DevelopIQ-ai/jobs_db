import { chromium, Page } from 'playwright';
import * as fs from 'fs';

const OUTPUT_DIR = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output';
const OUTPUT_FILE = `${OUTPUT_DIR}/us-jobs-final.jsonl`;
const SEEN_FILE = `${OUTPUT_DIR}/seen-keys-final.json`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress-final.json`;
const INDUSTRIES_FILE = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/industries.txt';

const PAGE_SIZE = 40;
const DELAY_MS = 200;
const MAX_PAGES = 250;

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

function buildFilter(industry: string) {
  return {
    searchQuery: '',
    dateFetchedPastNDays: 120,
    industries: [industry],
    // US only
    locations: [{
      formatted_address: 'United States',
      types: ['country'],
      geometry: { location: { lat: '37.0902', lon: '-95.7129' } },
      id: 'user_country',
      address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }]
    }]
  };
}

async function getCount(page: Page, filter: object): Promise<number> {
  const encoded = Buffer.from(JSON.stringify(filter)).toString('base64');
  try {
    const result = await page.evaluate(async (f: string) => {
      const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(f)}`;
      const resp = await fetch(url);
      if (!resp.ok) return 0;
      const data = await resp.json();
      return data.collapsedTotal || 0;
    }, encoded);
    return result;
  } catch {
    return 0;
  }
}

async function fetchPage(page: Page, filter: object, pageNum: number): Promise<any[]> {
  const encoded = Buffer.from(JSON.stringify(filter)).toString('base64');
  return page.evaluate(async ({ f, size, pageNum }) => {
    const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(f)}&size=${size}&page=${pageNum}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.results || [];
  }, { f: encoded, size: PAGE_SIZE, pageNum });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const industries = fs.readFileSync(INDUSTRIES_FILE, 'utf-8').split('\n').filter(Boolean);
  console.log(`Loaded ${industries.length} industries`);

  // Load or init state
  let seenKeys: Set<string>;
  let completedIndustries: Set<string>;
  let totalUnique = 0;
  let maxedOutIndustries: string[] = [];

  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    totalUnique = progress.totalUnique;
    completedIndustries = new Set(progress.completedIndustries || []);
    maxedOutIndustries = progress.maxedOutIndustries || [];
    const seenArray = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    seenKeys = new Set(seenArray);
    console.log(`Resuming: ${totalUnique} unique, ${completedIndustries.size} industries done`);
  } else {
    seenKeys = new Set();
    completedIndustries = new Set();
    // Start fresh
    fs.writeFileSync(OUTPUT_FILE, '');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('=== Industry-Only Scrape ===\n');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  const startTime = Date.now();
  const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
  let industriesDone = completedIndustries.size;
  let errors = 0;

  for (const industry of industries) {
    if (completedIndustries.has(industry)) continue;

    const filter = buildFilter(industry);
    const count = await getCount(page, filter);

    if (count === 0) {
      completedIndustries.add(industry);
      industriesDone++;
      continue;
    }

    const maxPages = Math.min(Math.ceil(count / PAGE_SIZE), MAX_PAGES);
    let industryNew = 0;
    let pagesScraped = 0;

    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      try {
        const jobs = await fetchPage(page, filter, pageNum);
        if (jobs.length === 0) break;

        for (const job of jobs) {
          if (!seenKeys.has(job.collapse_key)) {
            seenKeys.add(job.collapse_key);
            outputStream.write(JSON.stringify(transformJob(job)) + '\n');
            totalUnique++;
            industryNew++;
          }
        }
        pagesScraped++;
        await page.waitForTimeout(DELAY_MS);
      } catch (err) {
        errors++;
        if (errors > 20) {
          await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });
          errors = 0;
        }
        break;
      }
    }

    // Track if this industry maxed out (might need state chunking later)
    if (pagesScraped >= MAX_PAGES) {
      maxedOutIndustries.push(industry);
    }

    completedIndustries.add(industry);
    industriesDone++;

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = industriesDone / elapsed;
    const remaining = industries.length - industriesDone;
    const etaMins = Math.round(remaining / rate / 60);

    console.log(`[${industriesDone}/${industries.length}] ${industry}: +${industryNew} (${count} avail, ${pagesScraped} pages) | Total: ${totalUnique.toLocaleString()} | ETA: ${etaMins}min`);

    // Save every 50 industries
    if (industriesDone % 50 === 0) {
      fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
        totalUnique,
        completedIndustries: [...completedIndustries],
        maxedOutIndustries,
        timestamp: new Date().toISOString()
      }));
    }
  }

  outputStream.close();

  // Final save
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    totalUnique,
    completedIndustries: [...completedIndustries],
    maxedOutIndustries,
    timestamp: new Date().toISOString(),
    completed: true
  }));

  await browser.close();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n=== Complete ===');
  console.log(`Unique jobs: ${totalUnique.toLocaleString()}`);
  console.log(`Industries: ${industriesDone}`);
  console.log(`Maxed out (need state chunking): ${maxedOutIndustries.length}`);
  if (maxedOutIndustries.length > 0) {
    console.log(`  ${maxedOutIndustries.join(', ')}`);
  }
  console.log(`Time: ${Math.round(elapsed / 60)}min`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(console.error);
