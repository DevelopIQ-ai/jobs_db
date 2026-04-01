import { Camoufox } from 'camoufox-js';
import { fetchFilteredCount, fetchFilteredPage, openFilteredSearch, waitForCloudflare } from './helpers';

const ALLOWED_WORKPLACE_TYPES = new Set(['Remote', 'Hybrid', 'Onsite']);

function isUsJob(job: any): boolean {
  const processed = job.v5_processed_job_data || {};
  const workplaceCountries = processed.workplace_countries || [];

  if (Array.isArray(workplaceCountries) && workplaceCountries.includes('US')) {
    return true;
  }

  const fallbackValues = [
    processed.formatted_workplace_location,
    ...(processed.workplace_cities || []),
    ...(processed.workplace_states || []),
  ].filter(Boolean);

  return fallbackValues.some((value: string) => /United States|\bUS\b/.test(value));
}

function isWithinWindow(job: any, windowDays: number): boolean {
  const processed = job.v5_processed_job_data || {};
  const publishMillis = processed.estimated_publish_date_millis
    ?? Date.parse(processed.estimated_publish_date || 0);

  if (typeof publishMillis !== 'number' || !Number.isFinite(publishMillis)) {
    return false;
  }

  return publishMillis >= Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

function hasAllowedWorkplaceType(job: any): boolean {
  const processed = job.v5_processed_job_data || {};
  return ALLOWED_WORKPLACE_TYPES.has(processed.workplace_type);
}

async function main() {
  const windowDays = Number(process.argv[2] ?? process.env.WINDOW_DAYS ?? '1');
  const headless = process.env.CAMOUFOX_HEADLESS !== '0';

  console.log('=== Testing hiring.cafe API with Camoufox ===\n');
  console.log(`windowDays=${windowDays}`);
  console.log(`headless=${headless}\n`);

  const browser = await Camoufox({ headless });

  try {
    const page = await browser.newPage();
    await waitForCloudflare(page);
    const { encodedFilter, initialResults, countData: capturedCountData } = await openFilteredSearch(page, windowDays);

    console.log('\n--- Captured filtered request info ---');
    console.log(`Encoded filter length: ${encodedFilter.length}`);
    console.log(`Initial page results from site: ${initialResults.length}`);
    if (capturedCountData) {
      console.log(`Initial count total: ${capturedCountData.total?.toLocaleString()}`);
      console.log(`Initial count collapsedTotal: ${capturedCountData.collapsedTotal?.toLocaleString()}`);
    }

    console.log('\n--- Explicit filtered count request ---');
    const countData = await fetchFilteredCount(page, encodedFilter);
    console.log(`Total jobs: ${countData.total?.toLocaleString()}`);
    console.log(`Collapsed total: ${countData.collapsedTotal?.toLocaleString()}`);

    console.log('\n--- Explicit filtered page 0 request ---');
    const results = await fetchFilteredPage(page, encodedFilter, 0);
    console.log(`Fetched ${results.length} jobs.`);

    const strictMatches = results.filter((job: any) => {
      return hasAllowedWorkplaceType(job) && isUsJob(job) && isWithinWindow(job, windowDays);
    });
    console.log(`Strict local matches on page 0: ${strictMatches.length}/${results.length}`);

    if (results.length > 0) {
      const job = results[0];
      const info = job.job_information || {};
      const company = job.enriched_company_data || {};
      const processed = job.v5_processed_job_data || {};

      console.log('\n--- First job sample ---');
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

    console.log('\n=== Camoufox API test complete ===');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
