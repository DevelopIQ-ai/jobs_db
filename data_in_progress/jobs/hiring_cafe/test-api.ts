import { chromium } from 'playwright';

async function testAPI() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('=== Testing hiring.cafe API ===\n');

  // Intercept API responses
  let searchJobsResponse: any = null;
  let totalCountResponse: any = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/search-jobs') && !url.includes('get-total-count')) {
      try {
        searchJobsResponse = await response.json();
      } catch (e) {}
    }
    if (url.includes('/api/search-jobs/get-total-count')) {
      try {
        totalCountResponse = await response.json();
      } catch (e) {}
    }
  });

  // Load the page and trigger a search
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });

  // Fill search and submit
  const searchInput = page.locator('input').first();
  await searchInput.fill('software engineer');
  await searchInput.press('Enter');

  // Wait for API responses
  await page.waitForTimeout(5000);

  console.log('=== Total Count Response ===');
  console.log(JSON.stringify(totalCountResponse, null, 2));

  console.log('\n=== Search Jobs Response Structure ===');
  if (searchJobsResponse) {
    console.log('Type:', typeof searchJobsResponse);
    console.log('Keys:', Object.keys(searchJobsResponse));

    if (Array.isArray(searchJobsResponse)) {
      console.log('Array length:', searchJobsResponse.length);
      if (searchJobsResponse.length > 0) {
        console.log('\n=== First Job Sample ===');
        console.log(JSON.stringify(searchJobsResponse[0], null, 2));
      }
    } else if (searchJobsResponse.jobs) {
      console.log('Jobs array length:', searchJobsResponse.jobs.length);
      console.log('\n=== First Job Sample ===');
      console.log(JSON.stringify(searchJobsResponse.jobs[0], null, 2));
    } else {
      console.log('\n=== Full Response (truncated) ===');
      const str = JSON.stringify(searchJobsResponse, null, 2);
      console.log(str.substring(0, 3000));
    }
  } else {
    console.log('No search jobs response captured');
  }

  // Now try to get a minimal search filter
  console.log('\n\n=== Testing minimal filter ===');

  // Create a minimal filter and encode it
  const minimalFilter = {
    searchQuery: "software engineer",
    dateFetchedPastNDays: 30
  };

  const encodedFilter = Buffer.from(JSON.stringify(minimalFilter)).toString('base64');
  console.log('Minimal filter (base64):', encodedFilter);

  // Try direct API call
  const apiResponse = await page.evaluate(async (filter: string) => {
    const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(filter)}&size=5&page=0`;
    try {
      const resp = await fetch(url);
      return { status: resp.status, data: await resp.json() };
    } catch (e: any) {
      return { error: e.message };
    }
  }, encodedFilter);

  console.log('\nDirect API test result:', JSON.stringify(apiResponse, null, 2).substring(0, 2000));

  await browser.close();
}

testAPI().catch(console.error);
