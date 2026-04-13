import * as fs from 'fs';
import * as path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_PAGE_SIZE,
  encodeFilter,
  buildSearchState,
  fetchFilteredCount,
  fetchFilteredPage,
} from './helpers';

const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'output');
const DELAY_BETWEEN_BATCHES_MS = 1000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_EMPTY_BATCHES = 2;
const MAX_CONSECUTIVE_FAILED_BATCHES = 3;
const SUPABASE_BATCH_SIZE = 500;
const SUPABASE_TABLE = 'ds_hiring_cafe';
const SUPABASE_MAX_RETRIES = 3;
const SUPABASE_RETRY_BASE_MS = 2000;
const PROBE_MAX_RETRIES = 3;
const PROBE_RETRY_BASE_MS = 10_000;
const MAX_ELAPSED_MS = 50 * 60 * 1000;

export type ScrapeOptions = {
  windowDays?: number;
  maxPages?: number;
  outputDir?: string;
  freshStart?: boolean;
  apiKey?: string;
  pageSize?: number;
  maxElapsedMs?: number;
};

export type ScrapeRunResult = {
  totalWritten: number;
  totalUpserted: number;
  pagesScraped: number;
  elapsedSec: number;
  outputFile: string;
  outputDir: string;
  windowDays: number;
  totalErrors: number;
  exitReason: string;
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

function transformJob(job: any): Record<string, any> {
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

function toSupabaseRecord(job: Record<string, any>): Record<string, any> {
  return {
    primary_key: job.job_id,
    scraped_at: job.scraped_at,
    collapse_key: job.collapse_key,
    source: job.source,
    apply_url: job.apply_url,
    title: job.title,
    description_md: job.description_md,
    workplace_type: job.workplace_type,
    locations: job.locations,
    commitment: job.commitment,
    seniority_level: job.seniority_level,
    salary_min_yearly: job.salary_min_yearly,
    salary_max_yearly: job.salary_max_yearly,
    company_domain: job.company_domain,
    company_name: job.company_name,
    company_industry: job.company_industry,
    company_hq_country: job.company_hq_country,
    company_employee_count: job.company_employee_count,
    company_year_founded: job.company_year_founded,
    company_organization_type: job.company_organization_type,
    funding_type: job.funding_type,
    funding_year: job.funding_year,
    funding_amount: job.funding_amount,
    funding_investors: job.funding_investors,
    stock_exchange: job.stock_exchange,
    stock_symbol: job.stock_symbol,
  };
}

function deduplicateByKey(rows: Record<string, any>[], key: string): Record<string, any>[] {
  const map = new Map<string, Record<string, any>>();
  for (const row of rows) {
    if (row[key] != null) map.set(row[key], row);
  }
  return [...map.values()];
}

async function flushToSupabase(supabase: SupabaseClient, batch: Record<string, any>[]): Promise<number> {
  if (batch.length === 0) return 0;

  const rows = deduplicateByKey(batch.map(toSupabaseRecord), 'primary_key');

  for (let attempt = 0; attempt < SUPABASE_MAX_RETRIES; attempt++) {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .upsert(rows, { onConflict: 'primary_key', ignoreDuplicates: false })
      .select('primary_key');

    if (!error) return rows.length;

    const isLast = attempt === SUPABASE_MAX_RETRIES - 1;
    const delay = SUPABASE_RETRY_BASE_MS * Math.pow(2, attempt);
    if (isLast) {
      console.error(`Supabase upsert failed after ${SUPABASE_MAX_RETRIES} attempts: ${error.message}`);
      return 0;
    }
    console.warn(`Supabase upsert error (attempt ${attempt + 1}/${SUPABASE_MAX_RETRIES}): ${error.message} — retrying in ${delay / 1000}s`);
    await new Promise(r => setTimeout(r, delay));
  }

  return 0;
}

type PageResult = { page: number; jobs: any[]; error?: string };

async function fetchPageSafe(
  apiKey: string, encodedFilter: string, page: number, size: number
): Promise<PageResult> {
  try {
    const jobs = await fetchFilteredPage(apiKey, encodedFilter, page, size);
    return { page, jobs };
  } catch (err) {
    return { page, jobs: [], error: (err as Error).message };
  }
}

export async function runHiringCafeFullScrape(options: ScrapeOptions = {}): Promise<ScrapeRunResult> {
  const windowDays = options.windowDays ?? Number(process.env.WINDOW_DAYS ?? '1');
  const maxPages = options.maxPages ?? Number(process.env.MAX_PAGES ?? '0');
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const apiKey = options.apiKey ?? process.env.BRIGHTDATA_API_KEY;
  const envSize = Number(process.env.HIRING_CAFE_PAGE_SIZE || '0');
  const requestedSize = options.pageSize ?? (envSize > 0 ? envSize : DEFAULT_PAGE_SIZE);
  const maxElapsedMs = options.maxElapsedMs ?? MAX_ELAPSED_MS;
  const { outputFile, progressFile } = getOutputPaths(outputDir);

  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY is required (set env var or pass options.apiKey)');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        db: { schema: 'public' },
        global: {
          headers: { 'x-statement-timeout': '30000' },
        },
      })
    : null;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (options.freshStart) {
    if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  }

  const searchState = buildSearchState(windowDays);
  const encodedFilter = encodeFilter(searchState);

  let concurrency = DEFAULT_CONCURRENCY;

  console.log('=== hiring.cafe scrape via BrightData Web Unlocker ===\n');
  console.log(`windowDays=${windowDays}  (site dateFetchedPastNDays=${searchState.dateFetchedPastNDays})`);
  console.log(`pageSize=${requestedSize}  concurrency=${concurrency} (adaptive ${MIN_CONCURRENCY}-${MAX_CONCURRENCY})`);
  console.log(`supabase=${supabase ? 'connected' : 'skipped (no env vars)'}`);
  console.log(`timeLimit=${Math.round(maxElapsedMs / 60_000)}min`);
  if (maxPages > 0) console.log(`maxPages=${maxPages}`);
  console.log('');

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
  let consecutiveEmptyBatches = 0;
  let consecutiveFailedBatches = 0;
  let totalErrors = 0;
  let totalUpserted = 0;
  let supabaseBatch: Record<string, any>[] = [];
  let effectiveSize = requestedSize;
  let exitReason = 'natural';

  // --- Probe with retries ---
  let probeSucceeded = false;
  for (let probeAttempt = 0; probeAttempt < PROBE_MAX_RETRIES; probeAttempt++) {
    if (probeAttempt > 0) {
      const probeDelay = PROBE_RETRY_BASE_MS * Math.pow(2, probeAttempt - 1);
      console.log(`Probe retry ${probeAttempt}/${PROBE_MAX_RETRIES - 1} — waiting ${probeDelay / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, probeDelay));
    }

    console.log(`Probing page 0 to detect API size cap (requested ${requestedSize})...`);
    const probe = await fetchPageSafe(apiKey, encodedFilter, startPage, requestedSize);

    if (probe.error) {
      console.log(`Probe attempt ${probeAttempt + 1} failed: ${probe.error}`);
      continue;
    }

    probeSucceeded = true;
    const actual = probe.jobs.length;
    console.log(`Page 0 returned ${actual} jobs`);
    if (actual > 0 && actual < requestedSize) {
      effectiveSize = actual;
      console.log(`API caps at ~${actual} jobs/page, adjusting effective size`);
    }

    const transformed = probe.jobs.map(transformJob);
    const deduped = deduplicateByKey(transformed, 'job_id');
    for (const job of deduped) outputStream.write(JSON.stringify(job) + '\n');

    if (supabase) {
      supabaseBatch.push(...deduped);
      if (supabaseBatch.length >= SUPABASE_BATCH_SIZE) {
        totalUpserted += await flushToSupabase(supabase, supabaseBatch);
        supabaseBatch = [];
      }
    }

    totalWritten += deduped.length;
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(`Page ${pageNum}: ${deduped.length} jobs | Total: ${totalWritten.toLocaleString()} | ${elapsed}s\n`);
    break;
  }

  if (!probeSucceeded) {
    console.warn(`All ${PROBE_MAX_RETRIES} probe attempts failed — proceeding to main loop with default page size`);
  }
  pageNum++;

  console.log(`Fetching remaining pages in batches of ${concurrency} (size=${effectiveSize})...\n`);

  while (
    consecutiveEmptyBatches < MAX_EMPTY_BATCHES &&
    consecutiveFailedBatches < MAX_CONSECUTIVE_FAILED_BATCHES
  ) {
    // --- Time guard ---
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxElapsedMs) {
      exitReason = `time_limit_${Math.round(maxElapsedMs / 60_000)}min`;
      console.log(`\nTime limit reached (${Math.round(elapsedMs / 60_000)}min elapsed, limit ${Math.round(maxElapsedMs / 60_000)}min). Flushing and exiting gracefully.`);
      break;
    }

    if (maxPages > 0 && pageNum - startPage >= maxPages) {
      exitReason = 'max_pages';
      console.log(`Reached MAX_PAGES=${maxPages}, stopping.`);
      break;
    }

    const batchPages: number[] = [];
    for (let i = 0; i < concurrency; i++) {
      const p = pageNum + i;
      if (maxPages > 0 && p - startPage >= maxPages) break;
      batchPages.push(p);
    }
    if (batchPages.length === 0) break;

    const results = await Promise.all(
      batchPages.map(p => fetchPageSafe(apiKey, encodedFilter, p, effectiveSize))
    );

    let batchJobCount = 0;
    let batchErrorCount = 0;

    for (const res of results) {
      if (res.error) {
        totalErrors++;
        batchErrorCount++;
        console.error(`Page ${res.page}: ERROR - ${res.error} (total errors: ${totalErrors})`);
        continue;
      }

      if (res.jobs.length === 0) continue;

      const transformed = res.jobs.map(transformJob);
      const deduped = deduplicateByKey(transformed, 'job_id');

      for (const job of deduped) outputStream.write(JSON.stringify(job) + '\n');

      if (supabase) supabaseBatch.push(...deduped);

      totalWritten += deduped.length;
      batchJobCount += deduped.length;
    }

    // --- Flush Supabase after every batch that got data ---
    if (supabase && supabaseBatch.length > 0) {
      totalUpserted += await flushToSupabase(supabase, supabaseBatch);
      supabaseBatch = [];
    }

    const allFailed = batchErrorCount === batchPages.length;
    const majorityFailed = batchErrorCount > batchPages.length / 2;

    if (allFailed) {
      consecutiveFailedBatches++;
      consecutiveEmptyBatches = 0;
      const backoffMs = DELAY_BETWEEN_BATCHES_MS * 5 * consecutiveFailedBatches;
      console.log(`Batch pages ${batchPages[0]}-${batchPages[batchPages.length - 1]}: ALL FAILED (${consecutiveFailedBatches}/${MAX_CONSECUTIVE_FAILED_BATCHES} consecutive) — backing off ${Math.round(backoffMs / 1000)}s`);

      // Drop concurrency to minimum under pressure
      concurrency = MIN_CONCURRENCY;
      console.log(`  Concurrency reduced to ${concurrency}`);

      pageNum += batchPages.length;
      fs.writeFileSync(progressFile, JSON.stringify({ lastPage: batchPages[batchPages.length - 1], totalWritten, timestamp: new Date().toISOString() }));
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    // Reset consecutive failed batches on any success
    consecutiveFailedBatches = 0;

    if (majorityFailed) {
      // Reduce concurrency but don't reset the fail streak
      concurrency = Math.max(MIN_CONCURRENCY, concurrency - 1);
      console.log(`  Majority of batch failed, concurrency reduced to ${concurrency}`);
    } else if (batchErrorCount === 0 && concurrency < MAX_CONCURRENCY) {
      // Gradually restore concurrency on clean batches
      concurrency = Math.min(MAX_CONCURRENCY, concurrency + 1);
    }

    if (batchJobCount === 0 && batchErrorCount === 0) {
      consecutiveEmptyBatches++;
      console.log(`Batch pages ${batchPages[0]}-${batchPages[batchPages.length - 1]}: 0 jobs (${consecutiveEmptyBatches}/${MAX_EMPTY_BATCHES} empty)`);
    } else {
      consecutiveEmptyBatches = 0;
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const dbInfo = supabase ? ` | DB: ${totalUpserted.toLocaleString()}` : '';
      const errInfo = batchErrorCount > 0 ? ` | ${batchErrorCount} errors` : '';
      console.log(`Batch pages ${batchPages[0]}-${batchPages[batchPages.length - 1]}: ${batchJobCount} jobs | Total: ${totalWritten.toLocaleString()}${dbInfo}${errInfo} | conc=${concurrency} | ${elapsed}s`);
    }

    fs.writeFileSync(progressFile, JSON.stringify({
      lastPage: batchPages[batchPages.length - 1],
      totalWritten,
      timestamp: new Date().toISOString(),
    }));

    pageNum += batchPages.length;
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
  }

  if (consecutiveFailedBatches >= MAX_CONSECUTIVE_FAILED_BATCHES) {
    exitReason = 'consecutive_failed_batches';
  } else if (consecutiveEmptyBatches >= MAX_EMPTY_BATCHES && exitReason === 'natural') {
    exitReason = 'empty_batches_complete';
  }

  // Final Supabase flush
  if (supabase && supabaseBatch.length > 0) {
    console.log(`Flushing final ${supabaseBatch.length} records to Supabase...`);
    totalUpserted += await flushToSupabase(supabase, supabaseBatch);
  }

  outputStream.close();

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n=== Complete ===');
  console.log(`Total jobs written: ${totalWritten.toLocaleString()}`);
  if (supabase) console.log(`Total upserted to Supabase: ${totalUpserted.toLocaleString()}`);
  console.log(`Pages scraped: ${pageNum - startPage}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Exit reason: ${exitReason}`);
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Output: ${outputFile}`);

  if (exitReason === 'empty_batches_complete' && fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
    console.log('Reached consecutive empty batches, scrape complete.');
  }

  return {
    totalWritten,
    totalUpserted,
    pagesScraped: pageNum - startPage,
    elapsedSec,
    outputFile,
    outputDir,
    windowDays,
    totalErrors,
    exitReason,
  };
}
