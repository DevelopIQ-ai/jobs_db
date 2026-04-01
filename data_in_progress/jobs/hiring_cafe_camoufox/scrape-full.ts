import * as fs from 'fs';
import * as path from 'path';
import { Camoufox } from 'camoufox-js';
import { PAGE_SIZE, fetchFilteredCount, fetchFilteredPage, openFilteredSearch, waitForCloudflare } from './helpers';

const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'us-jobs-full.jsonl');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'progress.json');
const DELAY_MS = 200;
const MAX_EMPTY_PAGES = 3;
const MAX_ERRORS = 10;
const ALLOWED_WORKPLACE_TYPES = new Set(['Remote', 'Hybrid', 'Onsite']);

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
    .replace(/&rdquo;/g, '"').replace(/&ldquo;/g, '"').replace(/&ndash;/g, '-').replace(/&mdash;/g, '--')
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

function matchesRequestedScope(job: any, windowDays: number): boolean {
  return hasAllowedWorkplaceType(job) && isUsJob(job) && isWithinWindow(job, windowDays);
}

async function main() {
  const windowDays = Number(process.argv[2] ?? process.env.WINDOW_DAYS ?? '1');
  const headless = process.env.CAMOUFOX_HEADLESS !== '0';
  const maxPages = Number(process.env.MAX_PAGES ?? '0');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== Full hiring.cafe scrape with Camoufox ===\n');
  console.log(`windowDays=${windowDays}`);
  console.log(`headless=${headless}\n`);
  if (maxPages > 0) {
    console.log(`maxPages=${maxPages}\n`);
  }

  const browser = await Camoufox({ headless });

  try {
    const page = await browser.newPage();

    let startPage = 0;
    let totalWritten = 0;
    if (fs.existsSync(PROGRESS_FILE)) {
      const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      startPage = progress.lastPage + 1;
      totalWritten = progress.totalWritten;
      console.log(`Resuming from page ${startPage} (${totalWritten} jobs already written)\n`);
    } else {
      fs.writeFileSync(OUTPUT_FILE, '');
    }

    await waitForCloudflare(page);
    const { encodedFilter, initialResults, countData: capturedCountData } = await openFilteredSearch(page, windowDays);

    try {
      if (capturedCountData) {
        console.log(`Captured count total: ${capturedCountData.total?.toLocaleString()}`);
        console.log(`Captured count collapsedTotal: ${capturedCountData.collapsedTotal?.toLocaleString()}`);
      }

      const countData = await fetchFilteredCount(page, encodedFilter);
      console.log(`Count endpoint total: ${countData.total?.toLocaleString()}`);
      console.log(`Count endpoint collapsedTotal: ${countData.collapsedTotal?.toLocaleString()}\n`);
    } catch (error) {
      console.log(`Count request failed: ${(error as Error).message}\n`);
    }

    const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
    const startedAt = Date.now();
    let pageNum = startPage;
    let emptyPages = 0;
    let errors = 0;

    while (emptyPages < MAX_EMPTY_PAGES && errors < MAX_ERRORS) {
      if (maxPages > 0 && pageNum - startPage >= maxPages) {
        console.log(`Reached MAX_PAGES=${maxPages}, stopping early.`);
        break;
      }

      try {
        const jobs = pageNum === 0 && startPage === 0
          ? initialResults
          : await fetchFilteredPage(page, encodedFilter, pageNum);
        const matchingJobs = jobs.filter((job: any) => matchesRequestedScope(job, windowDays));

        if (matchingJobs.length === 0) {
          emptyPages++;
          console.log(`Page ${pageNum}: 0 kept out of ${jobs.length} (${emptyPages}/${MAX_EMPTY_PAGES} empty kept pages)`);
        } else {
          emptyPages = 0;
          const transformedJobs = matchingJobs.map(transformJob);

          for (const job of transformedJobs) {
            outputStream.write(JSON.stringify(job) + '\n');
          }

          totalWritten += transformedJobs.length;

          if (pageNum % 10 === 0 || pageNum < 5) {
            const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            const droppedCount = jobs.length - matchingJobs.length;
            console.log(`Page ${pageNum}: kept ${matchingJobs.length}/${jobs.length} jobs | Dropped: ${droppedCount} | Total written: ${totalWritten.toLocaleString()} | Elapsed: ${elapsedSec}s`);
          }

          fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
            lastPage: pageNum,
            totalWritten,
            timestamp: new Date().toISOString(),
          }));
        }

        pageNum++;
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        errors++;
        console.error(`Page ${pageNum}: ERROR - ${(error as Error).message} (${errors}/${MAX_ERRORS})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    outputStream.close();

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log('\n=== Complete ===');
    console.log(`Total jobs written: ${totalWritten.toLocaleString()}`);
    console.log(`Pages scraped this run: ${pageNum - startPage}`);
    console.log(`Elapsed: ${elapsedSec}s`);
    console.log(`Output file: ${OUTPUT_FILE}`);

    if (emptyPages >= MAX_EMPTY_PAGES && fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log('Reached consecutive empty pages, treating scrape as complete.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
