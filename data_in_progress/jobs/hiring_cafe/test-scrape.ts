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
  dateFetchedPastNDays: 30,  // Last 30 days only for test
  searchQuery: ""  // All jobs, no keyword filter
};

interface Job {
  id: string;
  source: string;
  board_token: string;
  apply_url: string;
  job_information?: {
    title?: string;
    description?: string;
  };
  v5_processed_job_data?: Record<string, any>;
  [key: string]: any;
}

async function testScrape() {
  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('=== Test Scrape: hiring.cafe US Jobs ===\n');

  // First, visit the site to get cookies/session
  console.log('1. Initializing session...');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  // Get total count first
  const encodedFilter = Buffer.from(JSON.stringify(US_FILTER)).toString('base64');

  console.log('2. Getting total count...');
  const countResponse = await page.evaluate(async (filter: string) => {
    const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(filter)}`;
    const resp = await fetch(url);
    return resp.json();
  }, encodedFilter);

  console.log(`   Total jobs: ${countResponse.total?.toLocaleString() || 'unknown'}`);
  console.log(`   Collapsed total: ${countResponse.collapsedTotal?.toLocaleString() || 'unknown'}`);

  // Fetch first few pages as a test
  const PAGE_SIZE = 40;
  const TEST_PAGES = 3;  // Just 3 pages = 120 jobs for test
  const allJobs: Job[] = [];

  console.log(`\n3. Fetching ${TEST_PAGES} pages (${TEST_PAGES * PAGE_SIZE} jobs max)...`);

  for (let pageNum = 0; pageNum < TEST_PAGES; pageNum++) {
    console.log(`   Page ${pageNum + 1}/${TEST_PAGES}...`);

    const jobs = await page.evaluate(async ({ filter, size, pageNum }: { filter: string; size: number; pageNum: number }) => {
      const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(filter)}&size=${size}&page=${pageNum}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return data.results || [];
    }, { filter: encodedFilter, size: PAGE_SIZE, pageNum });

    if (jobs.length === 0) {
      console.log('   No more results');
      break;
    }

    allJobs.push(...jobs);
    console.log(`   Got ${jobs.length} jobs (total: ${allJobs.length})`);

    // Small delay between requests
    await page.waitForTimeout(500);
  }

  await browser.close();

  // Analyze the data
  console.log('\n4. Analyzing data structure...');

  if (allJobs.length > 0) {
    const sample = allJobs[0];
    console.log('   Top-level keys:', Object.keys(sample));

    if (sample.job_information) {
      console.log('   job_information keys:', Object.keys(sample.job_information));
    }

    if (sample.v5_processed_job_data) {
      console.log('   v5_processed_job_data keys:', Object.keys(sample.v5_processed_job_data).slice(0, 20), '...');
    }
  }

  // Write raw output
  const rawOutputPath = `${OUTPUT_DIR}/test-raw.json`;
  fs.writeFileSync(rawOutputPath, JSON.stringify(allJobs, null, 2));
  console.log(`\n5. Wrote raw data to ${rawOutputPath}`);

  // Transform to a cleaner format
  console.log('\n6. Transforming to clean format...');

  const cleanJobs = allJobs.map(job => {
    const processed = job.v5_processed_job_data || {};
    const info = job.job_information || {};

    return {
      // Core identifiers
      id: job.id,
      source: job.source,
      board_token: job.board_token,
      apply_url: job.apply_url,

      // Job details
      title: info.title || processed.job_title || null,
      description: info.description || null,

      // Company
      company_name: processed.company_name || job.company_name || null,
      company_tagline: processed.company_tagline || null,
      company_industry: processed.company_sector_and_industry || null,

      // Location & work type
      workplace_type: processed.workplace_type || null,
      locations: processed.workplace_cities || processed.workplace_states || null,

      // Compensation
      salary_min_yearly: processed.yearly_min_compensation || null,
      salary_max_yearly: processed.yearly_max_compensation || null,
      salary_min_hourly: processed.hourly_min_compensation || null,
      salary_max_hourly: processed.hourly_max_compensation || null,

      // Requirements
      commitment: processed.commitment || null,
      seniority_level: processed.seniority_level || null,
      yoe_min: processed.min_role_yoe || null,
      yoe_max: processed.max_role_yoe || null,
      security_clearance: processed.security_clearance || null,

      // Skills
      technologies: processed.technologies || null,
      language_requirements: processed.language_requirements || null,

      // Benefits
      retirement_plan: processed.retirement_plan || null,
      generous_pto: processed.generous_paid_time_off || null,

      // Meta
      date_fetched: job.date_fetched || null,
      date_posted: info.date_posted || null,
    };
  });

  // Write clean JSONL
  const cleanOutputPath = `${OUTPUT_DIR}/test-clean.jsonl`;
  const jsonlContent = cleanJobs.map(j => JSON.stringify(j)).join('\n');
  fs.writeFileSync(cleanOutputPath, jsonlContent);
  console.log(`   Wrote ${cleanJobs.length} clean records to ${cleanOutputPath}`);

  // Show sample
  console.log('\n7. Sample clean record:');
  console.log(JSON.stringify(cleanJobs[0], null, 2));

  // Stats
  console.log('\n8. Quick stats:');
  const withSalary = cleanJobs.filter(j => j.salary_min_yearly || j.salary_max_yearly).length;
  const remote = cleanJobs.filter(j => j.workplace_type === 'Remote').length;
  const hybrid = cleanJobs.filter(j => j.workplace_type === 'Hybrid').length;
  const onsite = cleanJobs.filter(j => j.workplace_type === 'Onsite').length;

  console.log(`   With salary info: ${withSalary}/${cleanJobs.length} (${Math.round(withSalary/cleanJobs.length*100)}%)`);
  console.log(`   Remote: ${remote}, Hybrid: ${hybrid}, Onsite: ${onsite}`);

  const sources = cleanJobs.reduce((acc, j) => {
    acc[j.source] = (acc[j.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('   Sources:', sources);

  console.log('\n=== Test complete ===');
}

testScrape().catch(console.error);
