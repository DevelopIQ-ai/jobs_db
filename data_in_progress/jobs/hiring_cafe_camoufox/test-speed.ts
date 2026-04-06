import 'dotenv/config';
import { encodeFilter, buildSearchState, fetchViaBrightData } from './helpers';

const API_KEY = process.env.BRIGHTDATA_API_KEY!;
const SEARCH_STATE = buildSearchState(1);
const ENCODED = encodeFilter(SEARCH_STATE);
const PAGES_TO_TEST = 3;

function buildUrl(page: number, size: number) {
  return `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(ENCODED)}&size=${size}&page=${page}&sv=control`;
}

async function safeFetch(url: string): Promise<{ jobs: number; ok: boolean }> {
  try {
    const data = await fetchViaBrightData(url, API_KEY);
    return { jobs: data.results?.length ?? 0, ok: true };
  } catch (err) {
    console.log(`    FAIL: ${(err as Error).message.substring(0, 100)}`);
    return { jobs: 0, ok: false };
  }
}

async function testSequential(label: string, size: number, pages: number) {
  console.log(`\n--- ${label}: size=${size}, ${pages} pages, sequential ---`);
  const start = Date.now();
  let totalJobs = 0;
  let okPages = 0;

  for (let p = 0; p < pages; p++) {
    const t0 = Date.now();
    const { jobs, ok } = await safeFetch(buildUrl(p, size));
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    totalJobs += jobs;
    if (ok) okPages++;
    console.log(`  page ${p}: ${jobs} jobs in ${dt}s ${ok ? '' : '(FAILED)'}`);
  }

  const elapsed = (Date.now() - start) / 1000;
  const perPage = okPages > 0 ? elapsed / okPages : 0;
  console.log(`  TOTAL: ${totalJobs} jobs in ${elapsed.toFixed(1)}s (${perPage.toFixed(1)}s/page avg)`);
  return { label, size, pages, totalJobs, elapsedSec: elapsed, perPageSec: perPage, okPages };
}

async function testParallel(label: string, size: number, pages: number, concurrency: number) {
  console.log(`\n--- ${label}: size=${size}, ${pages} pages, ${concurrency} parallel ---`);
  const start = Date.now();
  let totalJobs = 0;
  let okPages = 0;

  const promises = [];
  for (let p = 0; p < pages; p++) {
    promises.push(safeFetch(buildUrl(p, size)));
  }

  // Fire all at once
  const results = await Promise.all(promises);
  for (const { jobs, ok } of results) {
    totalJobs += jobs;
    if (ok) okPages++;
  }

  const elapsed = (Date.now() - start) / 1000;
  const perPage = okPages > 0 ? elapsed / okPages : 0;
  console.log(`  TOTAL: ${totalJobs} jobs in ${elapsed.toFixed(1)}s (${perPage.toFixed(1)}s effective/page)`);
  return { label, size, pages, totalJobs, elapsedSec: elapsed, perPageSec: perPage, okPages };
}

async function main() {
  console.log('=== BrightData Speed Benchmark ===');
  console.log(`Testing ${PAGES_TO_TEST} pages per test\n`);

  const results: any[] = [];

  // Test 1: Current approach -- size=40 sequential
  results.push(await testSequential('Current (40 seq)', 40, PAGES_TO_TEST));

  // Test 2: Larger page -- size=100
  results.push(await testSequential('Size 100 seq', 100, PAGES_TO_TEST));

  // Test 3: Even larger -- size=200
  results.push(await testSequential('Size 200 seq', 200, PAGES_TO_TEST));

  // Test 4: size=40 all parallel
  results.push(await testParallel('40 x3 parallel', 40, PAGES_TO_TEST, PAGES_TO_TEST));

  // Test 5: size=200 all parallel
  results.push(await testParallel('200 x3 parallel', 200, PAGES_TO_TEST, PAGES_TO_TEST));

  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log('Test'.padEnd(22) + 'Size'.padStart(6) + 'Jobs'.padStart(8) + 'Time'.padStart(8) + '/page'.padStart(8) + 'Jobs/s'.padStart(8));
  console.log('-'.repeat(60));
  for (const r of results) {
    const jps = r.totalJobs > 0 ? (r.totalJobs / r.elapsedSec).toFixed(1) : '-';
    console.log(
      r.label.padEnd(22) +
      String(r.size).padStart(6) +
      String(r.totalJobs).padStart(8) +
      (r.elapsedSec.toFixed(1) + 's').padStart(8) +
      (r.perPageSec.toFixed(1) + 's').padStart(8) +
      String(jps).padStart(8)
    );
  }

  // Extrapolation
  console.log('\n=== Projected time for ~10,000 jobs ===');
  for (const r of results) {
    if (r.totalJobs === 0 || r.okPages === 0) { console.log(`  ${r.label}: N/A (failed)`); continue; }
    const jobsPerPage = r.totalJobs / r.okPages;
    const pagesNeeded = Math.ceil(10000 / jobsPerPage);
    const estSec = pagesNeeded * r.perPageSec;
    console.log(`  ${r.label}: ~${pagesNeeded} pages * ${r.perPageSec.toFixed(1)}s = ~${(estSec / 60).toFixed(1)} min`);
  }
}

main().catch(console.error);
