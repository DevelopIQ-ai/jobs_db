import * as fs from 'fs';
import * as path from 'path';
import {
  PAGE_SIZE,
  encodeFilter,
  buildSearchState,
  fetchFilteredCount,
  fetchFilteredPage,
} from './helpers';

const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'output');
const DELAY_MS = 300;
const MAX_EMPTY_PAGES = 3;
const MAX_ERRORS = 10;

export type ScrapeOptions = {
  windowDays?: number;
  maxPages?: number;
  outputDir?: string;
  freshStart?: boolean;
  apiKey?: string;
};

export type ScrapeRunResult = {
  totalWritten: number;
  pagesScraped: number;
  elapsedSec: number;
  outputFile: string;
  outputDir: string;
  windowDays: number;
};

function getOutputPaths(outputDir: string) {
  return {
    outputFile: path.join(outputDir, 'us-jobs-full.jsonl'),
    progressFile: path.join(outputDir, 'progress.json'),
  };
}

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

export async function runHiringCafeFullScrape(options: ScrapeOptions = {}): Promise<ScrapeRunResult> {
  const windowDays = options.windowDays ?? Number(process.env.WINDOW_DAYS ?? '1');
  const maxPages = options.maxPages ?? Number(process.env.MAX_PAGES ?? '0');
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const apiKey = options.apiKey ?? process.env.BRIGHTDATA_API_KEY;
  const { outputFile, progressFile } = getOutputPaths(outputDir);

  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY is required (set env var or pass options.apiKey)');
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (options.freshStart) {
    if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  }

  const searchState = buildSearchState(windowDays);
  const encodedFilter = encodeFilter(searchState);

  console.log('=== hiring.cafe scrape via BrightData Web Unlocker ===\n');
  console.log(`windowDays=${windowDays}  (site dateFetchedPastNDays=${searchState.dateFetchedPastNDays})`);
  if (maxPages > 0) console.log(`maxPages=${maxPages}`);
  console.log('');

  // Fetch total count first
  try {
    const countData = await fetchFilteredCount(apiKey, encodedFilter);
    console.log(`Total jobs: ${countData.total?.toLocaleString()}`);
    console.log(`Collapsed total: ${countData.collapsedTotal?.toLocaleString()}\n`);
  } catch (err) {
    console.log(`Count request failed: ${(err as Error).message}\n`);
  }

  let startPage = 0;
  let totalWritten = 0;
  if (fs.existsSync(progressFile)) {
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    startPage = progress.lastPage + 1;
    totalWritten = progress.totalWritten;
    console.log(`Resuming from page ${startPage} (${totalWritten} jobs already written)\n`);
  } else {
    fs.writeFileSync(outputFile, '');
  }

  const outputStream = fs.createWriteStream(outputFile, { flags: 'a' });
  const startedAt = Date.now();
  let pageNum = startPage;
  let emptyPages = 0;
  let errors = 0;

  while (emptyPages < MAX_EMPTY_PAGES && errors < MAX_ERRORS) {
    if (maxPages > 0 && pageNum - startPage >= maxPages) {
      console.log(`Reached MAX_PAGES=${maxPages}, stopping.`);
      break;
    }

    try {
      const jobs = await fetchFilteredPage(apiKey, encodedFilter, pageNum);

      if (jobs.length === 0) {
        emptyPages++;
        console.log(`Page ${pageNum}: 0 jobs (${emptyPages}/${MAX_EMPTY_PAGES} empty)`);
      } else {
        emptyPages = 0;
        const transformed = jobs.map(transformJob);

        for (const job of transformed) {
          outputStream.write(JSON.stringify(job) + '\n');
        }

        totalWritten += transformed.length;

        if (pageNum % 10 === 0 || pageNum < 5) {
          const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          console.log(`Page ${pageNum}: ${transformed.length} jobs | Total: ${totalWritten.toLocaleString()} | ${elapsed}s`);
        }

        fs.writeFileSync(progressFile, JSON.stringify({
          lastPage: pageNum,
          totalWritten,
          timestamp: new Date().toISOString(),
        }));
      }

      pageNum++;
      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      errors++;
      console.error(`Page ${pageNum}: ERROR - ${(err as Error).message} (${errors}/${MAX_ERRORS})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  outputStream.close();

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n=== Complete ===');
  console.log(`Total jobs written: ${totalWritten.toLocaleString()}`);
  console.log(`Pages scraped: ${pageNum - startPage}`);
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Output: ${outputFile}`);

  if (emptyPages >= MAX_EMPTY_PAGES && fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
    console.log('Reached consecutive empty pages, scrape complete.');
  }

  return {
    totalWritten,
    pagesScraped: pageNum - startPage,
    elapsedSec,
    outputFile,
    outputDir,
    windowDays,
  };
}
