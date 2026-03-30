import * as fs from 'fs';
import * as path from 'path';

const COOKIES_FILE = path.join(__dirname, 'cookies.json');

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

const TEST_FILTER = {
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
  dateFetchedPastNDays: 2,
  searchQuery: '',
};

async function testAPI() {
  console.log('=== Testing hiring.cafe API (direct fetch, no browser) ===\n');

  const cookies = loadCookies();
  const headers = buildHeaders(cookies);
  const encoded = encodeFilter(TEST_FILTER);

  // Test 1: Total count
  console.log('--- Test 1: Get total count ---');
  const countUrl = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encoded)}&sv=control`;
  const countResp = await fetch(countUrl, { headers });

  if (!countResp.ok) {
    console.log(`FAILED: HTTP ${countResp.status}`);
    if (countResp.status === 403) {
      console.log('The cf_clearance cookie has expired. Refresh it:');
      console.log('  1. Visit hiring.cafe in Chrome');
      console.log('  2. Open DevTools > Application > Cookies');
      console.log('  3. Copy the cf_clearance value into cookies.json');
    }
    return;
  }

  const countData = await countResp.json();
  console.log(`Total jobs: ${countData.total?.toLocaleString()}`);
  console.log(`Collapsed total: ${countData.collapsedTotal?.toLocaleString()}\n`);

  // Test 2: Fetch first page of jobs
  console.log('--- Test 2: Fetch page 0 (40 jobs) ---');
  const searchUrl = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encoded)}&size=40&page=0&sv=control`;
  const searchResp = await fetch(searchUrl, { headers });

  if (!searchResp.ok) {
    console.log(`FAILED: HTTP ${searchResp.status}`);
    return;
  }

  const searchData = await searchResp.json();
  const results = searchData.results || [];
  console.log(`Got ${results.length} jobs on page 0.\n`);

  if (results.length > 0) {
    const job = results[0];
    const info = job.job_information || {};
    const company = job.enriched_company_data || {};
    const processed = job.v5_processed_job_data || {};

    console.log('--- First job sample ---');
    console.log(JSON.stringify({
      job_id: job.id,
      title: info.title || processed.core_job_title || '(no title)',
      company_name: company.name || '(no company)',
      workplace_type: processed.workplace_type || null,
      locations: processed.workplace_cities || null,
      salary_min: processed.yearly_min_compensation || null,
      salary_max: processed.yearly_max_compensation || null,
      source: job.source,
      apply_url: job.apply_url,
    }, null, 2));
  }

  console.log('\n=== All tests passed ===');
}

testAPI().catch(console.error);
