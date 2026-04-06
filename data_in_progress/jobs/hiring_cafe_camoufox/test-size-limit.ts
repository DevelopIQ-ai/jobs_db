import 'dotenv/config';
import { encodeFilter, buildSearchState } from './helpers';

const API_KEY = process.env.BRIGHTDATA_API_KEY!;
const BD_API_URL = 'https://api.brightdata.com/request';
const BD_ZONE = 'web_unlocker1';
const SEARCH_STATE = buildSearchState(1);
const ENCODED = encodeFilter(SEARCH_STATE);

function buildUrl(page: number, size: number) {
  return `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(ENCODED)}&size=${size}&page=${page}&sv=control`;
}

async function testSize(size: number): Promise<{ size: number; jobs: number; ok: boolean; elapsed: number; bodyLen: number }> {
  const url = buildUrl(0, size);
  console.log(`Testing size=${size}...`);
  const start = Date.now();

  try {
    const res = await fetch(BD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ zone: BD_ZONE, url, format: 'raw' }),
    });

    const text = await res.text();
    const elapsed = (Date.now() - start) / 1000;

    if (!text || text.length === 0) {
      console.log(`  EMPTY body (${elapsed.toFixed(1)}s)`);
      return { size, jobs: 0, ok: false, elapsed, bodyLen: 0 };
    }

    try {
      const data = JSON.parse(text);
      const count = data.results?.length ?? 0;
      console.log(`  OK: ${count} jobs, ${(text.length / 1024).toFixed(0)}KB, ${elapsed.toFixed(1)}s`);
      return { size, jobs: count, ok: true, elapsed, bodyLen: text.length };
    } catch {
      console.log(`  JSON PARSE FAIL: ${(text.length / 1024).toFixed(0)}KB, ${elapsed.toFixed(1)}s`);
      return { size, jobs: 0, ok: false, elapsed, bodyLen: text.length };
    }
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    console.log(`  FETCH ERROR: ${(err as Error).message.substring(0, 80)} (${elapsed.toFixed(1)}s)`);
    return { size, jobs: 0, ok: false, elapsed, bodyLen: 0 };
  }
}

async function main() {
  console.log('=== Precise Size Limit Discovery (200-500 range) ===\n');

  const sizes = [200, 250, 300, 350, 400, 450, 500];
  const results: any[] = [];

  for (const size of sizes) {
    const r = await testSize(size);
    results.push(r);
  }

  console.log('\n=== RESULTS ===');
  console.log('Size'.padStart(6) + 'Jobs'.padStart(8) + 'OK?'.padStart(6) + 'Body(KB)'.padStart(10) + 'Time(s)'.padStart(10));
  console.log('-'.repeat(40));
  for (const r of results) {
    console.log(
      String(r.size).padStart(6) +
      String(r.jobs).padStart(8) +
      (r.ok ? 'YES' : 'NO').padStart(6) +
      (r.bodyLen / 1024).toFixed(0).padStart(10) +
      r.elapsed.toFixed(1).padStart(10)
    );
  }

  const safe = results.filter(r => r.ok && r.jobs > 0);
  if (safe.length > 0) {
    const best = safe[safe.length - 1];
    console.log(`\nLargest safe size: ${best.size} (returned ${best.jobs} jobs)`);
  }
}

main().catch(console.error);
