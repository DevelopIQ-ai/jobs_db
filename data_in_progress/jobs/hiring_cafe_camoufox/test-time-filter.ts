import { Camoufox } from 'camoufox-js';
import { encodeFilter, daysToSiteValue, PAGE_SIZE } from './helpers';

const US_LOCATION = {
  id: 'FxY1yZQBoEtHp_8UEq7V',
  types: ['country'],
  address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }],
  formatted_address: 'United States',
  population: 327167434,
  workplace_types: ['Remote', 'Hybrid', 'Onsite'],
  options: { flexible_regions: [] },
};

function buildRawFilter(siteValue: number) {
  return {
    locations: [US_LOCATION],
    workplaceTypes: ['Remote', 'Hybrid', 'Onsite'],
    dateFetchedPastNDays: siteValue,
    searchQuery: '',
  };
}

async function fetchInPage(page: any, url: string) {
  const result = await page.evaluate(async (u: string) => {
    const r = await fetch(u, { credentials: 'include', headers: { accept: '*/*' } });
    return { ok: r.ok, status: r.status, body: await r.text() };
  }, url);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return JSON.parse(result.body);
}

async function main() {
  console.log('=== Time Filter Verification (headed, no client-side filter) ===\n');

  const browser = await Camoufox({ headless: false, humanize: true, locale: 'en-US' });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Clear CF first
    console.log('Clearing Cloudflare...');
    await page.goto('https://hiring.cafe', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(4000);

    // Click widget
    const widgetBox = await page.evaluate(() => {
      const gridEl = document.querySelector('[style*="display: grid"]') ||
                     document.querySelector('[style*="display:grid"]');
      if (!gridEl) return null;
      const r = gridEl.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (widgetBox) {
      const cx = widgetBox.x + Math.min(35, widgetBox.width * 0.1);
      const cy = widgetBox.y + widgetBox.height / 2;
      await page.mouse.move(cx, cy, { steps: 10 });
      await page.waitForTimeout(150);
      await page.mouse.click(cx, cy);
    }

    // Wait for CF clearance
    const cfStart = Date.now();
    while (Date.now() - cfStart < 60000) {
      const cookies = await page.context().cookies('https://hiring.cafe');
      if (cookies.some((c: any) => c.name === 'cf_clearance')) {
        console.log('CF cleared!');
        break;
      }
      await page.waitForTimeout(2000);
    }

    // Wait for any CF redirect to finish, then navigate to a stable page
    await page.waitForTimeout(5000);
    console.log('Navigating to stable page...');
    await page.goto('https://hiring.cafe', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log('Ready for API calls\n');

    // Test each time window
    const tests: [string, number, number][] = [
      // [label, siteValue, humanDays]
      ['Past 24 hours', 2,   1],
      ['Past 3 days',   4,   3],
      ['Past week',     14,  7],
      ['Past 2 weeks',  21,  14],
    ];

    const results: any[] = [];

    for (const [label, siteValue, humanDays] of tests) {
      const filter = buildRawFilter(siteValue);
      const encoded = encodeFilter(filter);

      // Get count
      const countUrl = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encoded)}&sv=control`;
      const count = await fetchInPage(page, countUrl);

      // Get first page of jobs (no client-side filtering, raw API results)
      const searchUrl = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encoded)}&size=${PAGE_SIZE}&page=0&sv=control`;
      const searchData = await fetchInPage(page, searchUrl);
      const jobs = searchData.results || [];

      // Check publish dates of the returned jobs
      let oldest = Infinity, newest = 0;
      let withDate = 0;
      for (const job of jobs) {
        const p = job.v5_processed_job_data || {};
        const ms = p.estimated_publish_date_millis ?? Date.parse(p.estimated_publish_date || '');
        if (ms && Number.isFinite(ms)) {
          withDate++;
          if (ms < oldest) oldest = ms;
          if (ms > newest) newest = ms;
        }
      }

      const now = Date.now();
      const oldestAgeHours = oldest < Infinity ? ((now - oldest) / 3600000).toFixed(1) : '?';
      const newestAgeHours = newest > 0 ? ((now - newest) / 3600000).toFixed(1) : '?';

      console.log(`--- ${label} (site value=${siteValue}, human=${humanDays}d) ---`);
      console.log(`  Count: total=${count.total?.toLocaleString()}, collapsed=${count.collapsedTotal?.toLocaleString()}`);
      console.log(`  Page 0: ${jobs.length} jobs returned (${withDate} have dates)`);
      console.log(`  Newest job: ${newestAgeHours}h ago`);
      console.log(`  Oldest job on page: ${oldestAgeHours}h ago`);
      console.log('');

      results.push({ label, siteValue, humanDays, total: count.total, collapsed: count.collapsedTotal, pageSize: jobs.length });

      await page.waitForTimeout(300);
    }

    // Also test what we WERE sending (value=1)
    console.log('--- CONTROL: dateFetchedPastNDays=1 (our old wrong value) ---');
    const oldFilter = { ...buildRawFilter(1), dateFetchedPastNDays: 1 };
    const oldEncoded = encodeFilter(oldFilter);
    const oldCountUrl = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(oldEncoded)}&sv=control`;
    const oldCount = await fetchInPage(page, oldCountUrl);
    console.log(`  Count: total=${oldCount.total?.toLocaleString()}, collapsed=${oldCount.collapsedTotal?.toLocaleString()}\n`);

    // Summary
    console.log('=== Summary ===');
    console.log('Filter'.padEnd(20) + 'SiteVal'.padStart(8) + 'Total'.padStart(14) + 'Collapsed'.padStart(12));
    console.log('-'.repeat(54));
    for (const r of results) {
      console.log(r.label.padEnd(20) + String(r.siteValue).padStart(8) + r.total.toLocaleString().padStart(14) + r.collapsed.toLocaleString().padStart(12));
    }
    console.log('Old value=1'.padEnd(20) + '1'.padStart(8) + oldCount.total.toLocaleString().padStart(14) + oldCount.collapsedTotal.toLocaleString().padStart(12));

    console.log('\nDone! Browser stays open 10s...');
    await page.waitForTimeout(10000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
