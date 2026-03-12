import { chromium, Page } from 'playwright';
import * as fs from 'fs';

const OUTPUT_DIR = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output';
const OUTPUT_FILE = `${OUTPUT_DIR}/us-jobs-chunked.jsonl`;
const SEEN_FILE = `${OUTPUT_DIR}/seen-keys-chunked.json`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress-chunked.json`;
const INDUSTRIES_FILE = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/industries.txt';

const PAGE_SIZE = 40;
const DELAY_MS = 300;
const MAX_PAGES_PER_COMBO = 250;

// All 50 US states + DC
const US_STATES = [
  { name: 'Alabama', abbr: 'AL', lat: '32.3182', lon: '-86.9023' },
  { name: 'Alaska', abbr: 'AK', lat: '64.2008', lon: '-152.4937' },
  { name: 'Arizona', abbr: 'AZ', lat: '34.0489', lon: '-111.0937' },
  { name: 'Arkansas', abbr: 'AR', lat: '35.2010', lon: '-91.8318' },
  { name: 'California', abbr: 'CA', lat: '36.7783', lon: '-119.4179' },
  { name: 'Colorado', abbr: 'CO', lat: '39.5501', lon: '-105.7821' },
  { name: 'Connecticut', abbr: 'CT', lat: '41.6032', lon: '-73.0877' },
  { name: 'Delaware', abbr: 'DE', lat: '38.9108', lon: '-75.5277' },
  { name: 'Florida', abbr: 'FL', lat: '27.6648', lon: '-81.5158' },
  { name: 'Georgia', abbr: 'GA', lat: '32.1656', lon: '-82.9001' },
  { name: 'Hawaii', abbr: 'HI', lat: '19.8968', lon: '-155.5828' },
  { name: 'Idaho', abbr: 'ID', lat: '44.0682', lon: '-114.7420' },
  { name: 'Illinois', abbr: 'IL', lat: '40.6331', lon: '-89.3985' },
  { name: 'Indiana', abbr: 'IN', lat: '40.2672', lon: '-86.1349' },
  { name: 'Iowa', abbr: 'IA', lat: '41.8780', lon: '-93.0977' },
  { name: 'Kansas', abbr: 'KS', lat: '39.0119', lon: '-98.4842' },
  { name: 'Kentucky', abbr: 'KY', lat: '37.8393', lon: '-84.2700' },
  { name: 'Louisiana', abbr: 'LA', lat: '30.9843', lon: '-91.9623' },
  { name: 'Maine', abbr: 'ME', lat: '45.2538', lon: '-69.4455' },
  { name: 'Maryland', abbr: 'MD', lat: '39.0458', lon: '-76.6413' },
  { name: 'Massachusetts', abbr: 'MA', lat: '42.4072', lon: '-71.3824' },
  { name: 'Michigan', abbr: 'MI', lat: '44.3148', lon: '-85.6024' },
  { name: 'Minnesota', abbr: 'MN', lat: '46.7296', lon: '-94.6859' },
  { name: 'Mississippi', abbr: 'MS', lat: '32.3547', lon: '-89.3985' },
  { name: 'Missouri', abbr: 'MO', lat: '37.9643', lon: '-91.8318' },
  { name: 'Montana', abbr: 'MT', lat: '46.8797', lon: '-110.3626' },
  { name: 'Nebraska', abbr: 'NE', lat: '41.4925', lon: '-99.9018' },
  { name: 'Nevada', abbr: 'NV', lat: '38.8026', lon: '-116.4194' },
  { name: 'New Hampshire', abbr: 'NH', lat: '43.1939', lon: '-71.5724' },
  { name: 'New Jersey', abbr: 'NJ', lat: '40.0583', lon: '-74.4057' },
  { name: 'New Mexico', abbr: 'NM', lat: '34.5199', lon: '-105.8701' },
  { name: 'New York', abbr: 'NY', lat: '43.2994', lon: '-74.2179' },
  { name: 'North Carolina', abbr: 'NC', lat: '35.7596', lon: '-79.0193' },
  { name: 'North Dakota', abbr: 'ND', lat: '47.5515', lon: '-101.0020' },
  { name: 'Ohio', abbr: 'OH', lat: '40.4173', lon: '-82.9071' },
  { name: 'Oklahoma', abbr: 'OK', lat: '35.0078', lon: '-97.0929' },
  { name: 'Oregon', abbr: 'OR', lat: '43.8041', lon: '-120.5542' },
  { name: 'Pennsylvania', abbr: 'PA', lat: '41.2033', lon: '-77.1945' },
  { name: 'Rhode Island', abbr: 'RI', lat: '41.5801', lon: '-71.4774' },
  { name: 'South Carolina', abbr: 'SC', lat: '33.8361', lon: '-81.1637' },
  { name: 'South Dakota', abbr: 'SD', lat: '43.9695', lon: '-99.9018' },
  { name: 'Tennessee', abbr: 'TN', lat: '35.5175', lon: '-86.5804' },
  { name: 'Texas', abbr: 'TX', lat: '31.9686', lon: '-99.9018' },
  { name: 'Utah', abbr: 'UT', lat: '39.3210', lon: '-111.0937' },
  { name: 'Vermont', abbr: 'VT', lat: '44.5588', lon: '-72.5778' },
  { name: 'Virginia', abbr: 'VA', lat: '37.4316', lon: '-78.6569' },
  { name: 'Washington', abbr: 'WA', lat: '47.7511', lon: '-120.7401' },
  { name: 'West Virginia', abbr: 'WV', lat: '38.5976', lon: '-80.4549' },
  { name: 'Wisconsin', abbr: 'WI', lat: '43.7844', lon: '-88.7879' },
  { name: 'Wyoming', abbr: 'WY', lat: '43.0759', lon: '-107.2903' },
  { name: 'District of Columbia', abbr: 'DC', lat: '38.9072', lon: '-77.0369' },
];

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

function buildFilter(industry: string, state: typeof US_STATES[0]) {
  return {
    searchQuery: '',
    dateFetchedPastNDays: 120,
    industries: [industry],
    locations: [{
      formatted_address: `${state.name}, United States`,
      types: ['administrative_area_level_1', 'political'],
      geometry: { location: { lat: state.lat, lon: state.lon } },
      id: `${state.abbr.toLowerCase()}_us`,
      address_components: [
        { long_name: state.name, short_name: state.abbr, types: ['administrative_area_level_1'] },
        { long_name: 'United States', short_name: 'US', types: ['country'] }
      ]
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

  // Load industries
  const industries = fs.readFileSync(INDUSTRIES_FILE, 'utf-8').split('\n').filter(Boolean);
  console.log(`Loaded ${industries.length} industries`);

  // Load or init state
  let seenKeys: Set<string>;
  let completedCombos: Set<string>;
  let totalUnique = 0;

  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    totalUnique = progress.totalUnique;
    completedCombos = new Set(progress.completedCombos || []);
    const seenArray = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    seenKeys = new Set(seenArray);
    console.log(`Resuming: ${totalUnique} unique jobs, ${completedCombos.size} combos completed`);
  } else {
    seenKeys = new Set();
    completedCombos = new Set();
    fs.writeFileSync(OUTPUT_FILE, '');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('=== Chunked Scrape: Industry × State ===\n');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  const totalCombos = industries.length * US_STATES.length;
  console.log(`Total combinations: ${totalCombos.toLocaleString()}`);
  console.log(`Already completed: ${completedCombos.size.toLocaleString()}\n`);

  const startTime = Date.now();
  const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
  let combosDone = completedCombos.size;
  let errors = 0;

  for (const industry of industries) {
    for (const state of US_STATES) {
      const comboKey = `${industry}|${state.abbr}`;

      if (completedCombos.has(comboKey)) {
        continue;
      }

      const filter = buildFilter(industry, state);

      // Get count first
      const count = await getCount(page, filter);

      if (count === 0) {
        completedCombos.add(comboKey);
        combosDone++;
        continue;
      }

      // Scrape this combo
      const maxPages = Math.min(Math.ceil(count / PAGE_SIZE), MAX_PAGES_PER_COMBO);
      let comboNew = 0;

      for (let pageNum = 0; pageNum < maxPages; pageNum++) {
        try {
          const jobs = await fetchPage(page, filter, pageNum);

          if (jobs.length === 0) break;

          for (const job of jobs) {
            const collapseKey = job.collapse_key;
            if (!seenKeys.has(collapseKey)) {
              seenKeys.add(collapseKey);
              const transformed = transformJob(job);
              outputStream.write(JSON.stringify(transformed) + '\n');
              totalUnique++;
              comboNew++;
            }
          }

          await page.waitForTimeout(DELAY_MS);
        } catch (err: any) {
          errors++;
          if (errors > 50) {
            console.log('Too many errors, refreshing browser...');
            await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });
            errors = 0;
          }
          break;
        }
      }

      completedCombos.add(comboKey);
      combosDone++;

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const combosPerSec = (combosDone - (completedCombos.size - combosDone)) / elapsed || 0.1;
      const remaining = totalCombos - combosDone;
      const etaHours = (remaining / combosPerSec / 3600).toFixed(1);

      if (combosDone % 100 === 0 || comboNew > 100) {
        console.log(`[${combosDone}/${totalCombos}] ${industry} + ${state.abbr}: +${comboNew} new | Total: ${totalUnique.toLocaleString()} | ETA: ${etaHours}h`);
      }

      // Save progress every 500 combos
      if (combosDone % 500 === 0) {
        fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
          totalUnique,
          completedCombos: [...completedCombos],
          timestamp: new Date().toISOString()
        }));
        console.log(`  [Saved progress: ${totalUnique} unique, ${completedCombos.size} combos]`);
      }
    }
  }

  outputStream.close();

  // Final save
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenKeys]));
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    totalUnique,
    completedCombos: [...completedCombos],
    timestamp: new Date().toISOString(),
    completed: true
  }));

  await browser.close();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n=== Complete ===');
  console.log(`Unique jobs: ${totalUnique.toLocaleString()}`);
  console.log(`Combos processed: ${combosDone.toLocaleString()}`);
  console.log(`Time: ${(elapsed / 3600).toFixed(1)} hours`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
