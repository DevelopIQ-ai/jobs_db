import { chromium } from 'playwright';
import * as fs from 'fs';

const OUTPUT_DIR = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output';

// US-only filter
const US_FILTER = {
  locations: [{
    formatted_address: "United States",
    types: ["country"],
    geometry: { location: { lat: "37.0902", lon: "-95.7129" } },
    id: "user_country",
    address_components: [{
      long_name: "United States",
      short_name: "US",
      types: ["country"]
    }]
  }],
  workplaceTypes: ["Remote", "Hybrid", "Onsite"],
  dateFetchedPastNDays: 30,
  searchQuery: ""
};

// Simple HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let md = html
    // Remove script/style tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')

    // Bold/italic
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')

    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

    // Lists
    .replace(/<ul[^>]*>/gi, '\n')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '\n')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')

    // Paragraphs and breaks
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')

    // Remove remaining tags
    .replace(/<[^>]+>/g, '')

    // Decode entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&bull;/g, '•')

    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();

  return md;
}

interface RawJob {
  id: string;
  source: string;
  board_token: string;
  apply_url: string;
  collapse_key: string;
  job_information?: {
    title?: string;
    description?: string;
  };
  v5_processed_job_data?: Record<string, any>;
  enriched_company_data?: {
    name?: string;
    homepage_uri?: string;
    hq_country?: string;
    industries?: string[];
    nb_employees?: number;
    year_founded?: number;
    organization_type?: string;
    latest_funding_type?: string;
    latest_funding_year?: number;
    latest_funding_amount?: number;
    latest_funding_investors?: string[];
    stock_exchange?: string;
    stock_symbol?: string;
  };
  [key: string]: any;
}

interface CleanJob {
  // Identifiers
  job_id: string;
  collapse_key: string;
  source: string;
  apply_url: string;

  // Job details (INDEX: title)
  title: string;
  description_md: string;
  workplace_type: string | null;
  locations: string[] | null;
  commitment: string[] | null;
  seniority_level: string | null;

  // Compensation
  salary_min_yearly: number | null;
  salary_max_yearly: number | null;

  // Company (INDEX: company_domain, company_name, company_industry)
  company_domain: string | null;
  company_name: string | null;
  company_industry: string[] | null;
  company_hq_country: string | null;
  company_employee_count: number | null;
  company_year_founded: number | null;
  company_organization_type: string | null;

  // Funding (INDEX: funding fields)
  funding_type: string | null;
  funding_year: number | null;
  funding_amount: number | null;
  funding_investors: string[] | null;

  // Public company info
  stock_exchange: string | null;
  stock_symbol: string | null;

  // Meta
  scraped_at: string;
}

function transformJob(job: RawJob): CleanJob {
  const processed = job.v5_processed_job_data || {};
  const info = job.job_information || {};
  const company = job.enriched_company_data || {};

  return {
    // Identifiers
    job_id: job.id,
    collapse_key: job.collapse_key,
    source: job.source,
    apply_url: job.apply_url,

    // Job details
    title: info.title || processed.core_job_title || '',
    description_md: htmlToMarkdown(info.description || ''),
    workplace_type: processed.workplace_type || null,
    locations: processed.workplace_cities || processed.workplace_states || null,
    commitment: processed.commitment || null,
    seniority_level: processed.seniority_level || null,

    // Compensation
    salary_min_yearly: processed.yearly_min_compensation || null,
    salary_max_yearly: processed.yearly_max_compensation || null,

    // Company
    company_domain: company.homepage_uri || null,
    company_name: company.name || null,
    company_industry: company.industries || null,
    company_hq_country: company.hq_country || null,
    company_employee_count: company.nb_employees || null,
    company_year_founded: company.year_founded || null,
    company_organization_type: company.organization_type || null,

    // Funding
    funding_type: company.latest_funding_type || null,
    funding_year: company.latest_funding_year || null,
    funding_amount: company.latest_funding_amount || null,
    funding_investors: company.latest_funding_investors || null,

    // Public company
    stock_exchange: company.stock_exchange || null,
    stock_symbol: company.stock_symbol || null,

    // Meta
    scraped_at: new Date().toISOString(),
  };
}

async function testScrapeV2() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('=== Test Scrape V2: hiring.cafe US Jobs ===\n');

  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  const encodedFilter = Buffer.from(JSON.stringify(US_FILTER)).toString('base64');

  // Get count
  const countResponse = await page.evaluate(async (filter: string) => {
    const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(filter)}`;
    const resp = await fetch(url);
    return resp.json();
  }, encodedFilter);

  console.log(`Total: ${countResponse.total?.toLocaleString()}, Unique: ${countResponse.collapsedTotal?.toLocaleString()}`);

  // Fetch 5 pages for better sample
  const PAGE_SIZE = 40;
  const TEST_PAGES = 5;
  const allJobs: RawJob[] = [];

  console.log(`\nFetching ${TEST_PAGES} pages...`);

  for (let pageNum = 0; pageNum < TEST_PAGES; pageNum++) {
    const jobs = await page.evaluate(async ({ filter, size, pageNum }: { filter: string; size: number; pageNum: number }) => {
      const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(filter)}&size=${size}&page=${pageNum}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return data.results || [];
    }, { filter: encodedFilter, size: PAGE_SIZE, pageNum });

    if (jobs.length === 0) break;
    allJobs.push(...jobs);
    console.log(`  Page ${pageNum + 1}: ${jobs.length} jobs (total: ${allJobs.length})`);
    await page.waitForTimeout(500);
  }

  await browser.close();

  // Transform
  console.log('\nTransforming...');
  const cleanJobs = allJobs.map(transformJob);

  // Write JSONL
  const outputPath = `${OUTPUT_DIR}/test-v2.jsonl`;
  fs.writeFileSync(outputPath, cleanJobs.map(j => JSON.stringify(j)).join('\n'));
  console.log(`Wrote ${cleanJobs.length} records to ${outputPath}`);

  // Stats
  console.log('\n=== Schema Validation ===');

  const withDomain = cleanJobs.filter(j => j.company_domain).length;
  const withTitle = cleanJobs.filter(j => j.title).length;
  const withIndustry = cleanJobs.filter(j => j.company_industry?.length).length;
  const withFunding = cleanJobs.filter(j => j.funding_type).length;
  const withSalary = cleanJobs.filter(j => j.salary_min_yearly || j.salary_max_yearly).length;

  console.log(`company_domain:   ${withDomain}/${cleanJobs.length} (${pct(withDomain, cleanJobs.length)})`);
  console.log(`title:            ${withTitle}/${cleanJobs.length} (${pct(withTitle, cleanJobs.length)})`);
  console.log(`company_industry: ${withIndustry}/${cleanJobs.length} (${pct(withIndustry, cleanJobs.length)})`);
  console.log(`funding_type:     ${withFunding}/${cleanJobs.length} (${pct(withFunding, cleanJobs.length)})`);
  console.log(`salary:           ${withSalary}/${cleanJobs.length} (${pct(withSalary, cleanJobs.length)})`);

  // Unique companies
  const uniqueDomains = new Set(cleanJobs.map(j => j.company_domain).filter(Boolean));
  console.log(`\nUnique companies: ${uniqueDomains.size}`);

  // Sample output
  console.log('\n=== Sample Record ===');
  const sample = cleanJobs.find(j => j.funding_type) || cleanJobs[0];
  console.log(JSON.stringify(sample, null, 2));

  // Sample markdown
  console.log('\n=== Sample Markdown Description (first 500 chars) ===');
  const withDesc = cleanJobs.find(j => j.description_md.length > 100);
  if (withDesc) {
    console.log(withDesc.description_md.substring(0, 500) + '...');
  }
}

function pct(n: number, total: number): string {
  return `${Math.round(n / total * 100)}%`;
}

testScrapeV2().catch(console.error);
