import { chromium } from 'playwright';

// Test if we can get collapsed/unique results only

async function testCollapsed() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture API requests to see what params the site uses
  const apiCalls: string[] = [];
  page.on('request', req => {
    if (req.url().includes('/api/search-jobs')) {
      apiCalls.push(req.url());
    }
  });

  console.log('Loading site and watching API calls...');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  // Do a search
  const searchInput = page.locator('input').first();
  await searchInput.fill('engineer');
  await searchInput.press('Enter');
  await page.waitForTimeout(5000);

  console.log('\nAPI calls captured:');
  apiCalls.forEach(url => {
    console.log(url.substring(0, 200) + '...');
  });

  // Decode the search params
  const searchUrl = apiCalls.find(u => u.includes('/api/search-jobs?'));
  if (searchUrl) {
    const urlObj = new URL(searchUrl);
    const sParam = urlObj.searchParams.get('s');
    if (sParam) {
      const decoded = JSON.parse(Buffer.from(decodeURIComponent(sParam), 'base64').toString());
      console.log('\nDecoded filter params:');
      console.log(JSON.stringify(decoded, null, 2));
    }
    console.log('\nOther params:');
    urlObj.searchParams.forEach((v, k) => {
      if (k !== 's') console.log(`  ${k}: ${v}`);
    });
  }

  // Try adding collapsed=true to see if it works
  console.log('\n\nTesting collapsed parameter...');

  const filter = {
    searchQuery: 'software engineer',
    dateFetchedPastNDays: 30
  };
  const encodedFilter = Buffer.from(JSON.stringify(filter)).toString('base64');

  // Test with different params
  const tests = [
    { name: 'Normal', url: `/api/search-jobs?s=${encodedFilter}&size=10&page=0` },
    { name: 'collapsed=true', url: `/api/search-jobs?s=${encodedFilter}&size=10&page=0&collapsed=true` },
    { name: 'collapse=true', url: `/api/search-jobs?s=${encodedFilter}&size=10&page=0&collapse=true` },
    { name: 'unique=true', url: `/api/search-jobs?s=${encodedFilter}&size=10&page=0&unique=true` },
    { name: 'dedupe=true', url: `/api/search-jobs?s=${encodedFilter}&size=10&page=0&dedupe=true` },
  ];

  for (const test of tests) {
    const result = await page.evaluate(async (url: string) => {
      const resp = await fetch('https://hiring.cafe' + url);
      const data = await resp.json();
      const results = data.results || [];
      const collapseKeys = new Set(results.map((r: any) => r.collapse_key));
      return { count: results.length, uniqueKeys: collapseKeys.size };
    }, test.url);

    console.log(`${test.name}: ${result.count} jobs, ${result.uniqueKeys} unique collapse_keys`);
  }

  await browser.close();
}

testCollapsed().catch(console.error);
