import { chromium } from 'playwright';

async function explore() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('=== Exploring hiring.cafe ===\n');

  // Visit homepage
  console.log('1. Loading homepage...');
  await page.goto('https://hiring.cafe', { waitUntil: 'networkidle' });
  console.log('   Title:', await page.title());
  console.log('   URL:', page.url());

  // Look for search/filter elements
  console.log('\n2. Looking for search elements...');
  const searchInputs = await page.locator('input').all();
  console.log(`   Found ${searchInputs.length} input elements`);

  // Look for job listings
  console.log('\n3. Looking for job listings on homepage...');
  const jobCards = await page.locator('[class*="job"], [class*="card"], [class*="listing"]').count();
  console.log(`   Found ${jobCards} potential job card elements`);

  // Check for any visible links/navigation
  console.log('\n4. Main navigation links:');
  const navLinks = await page.locator('nav a, header a').allTextContents();
  navLinks.slice(0, 10).forEach(link => console.log(`   - ${link.trim()}`));

  // Try a search
  console.log('\n5. Attempting a search...');
  const searchInput = page.locator('input[type="text"], input[placeholder*="search" i], input[placeholder*="job" i]').first();
  if (await searchInput.count() > 0) {
    await searchInput.fill('software engineer');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);
    console.log('   After search URL:', page.url());
  } else {
    // Try going to /jobs directly
    await page.goto('https://hiring.cafe/jobs', { waitUntil: 'networkidle' });
    console.log('   Navigated to /jobs');
    console.log('   URL:', page.url());
  }

  // Analyze the jobs page
  console.log('\n6. Analyzing job listings page...');
  await page.waitForTimeout(2000);

  // Take a screenshot for reference
  await page.screenshot({ path: '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/screenshot.png', fullPage: false });
  console.log('   Screenshot saved');

  // Look at the HTML structure
  console.log('\n7. Page structure analysis:');
  const bodyHTML = await page.content();
  console.log(`   Total HTML size: ${bodyHTML.length} characters`);

  // Check for API calls by intercepting network
  console.log('\n8. Looking for data patterns in page...');

  // Look for JSON data or script tags with data
  const scriptData = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    let dataScripts: string[] = [];
    scripts.forEach(s => {
      if (s.textContent && (s.textContent.includes('jobs') || s.textContent.includes('__NEXT_DATA__'))) {
        dataScripts.push(s.textContent.substring(0, 500));
      }
    });
    return dataScripts;
  });

  if (scriptData.length > 0) {
    console.log(`   Found ${scriptData.length} data scripts`);
    scriptData.forEach((data, i) => {
      console.log(`   Script ${i + 1} preview: ${data.substring(0, 200)}...`);
    });
  }

  // Try to find job elements and extract structure
  console.log('\n9. Looking for job listing elements...');
  const allLinks = await page.locator('a[href*="/job/"]').all();
  console.log(`   Found ${allLinks.length} links containing /job/`);

  if (allLinks.length > 0) {
    const firstJobHref = await allLinks[0].getAttribute('href');
    console.log(`   First job link: ${firstJobHref}`);
  }

  // Check for infinite scroll or pagination
  console.log('\n10. Checking for pagination...');
  const pagination = await page.locator('[class*="pagination"], [class*="pager"], button:has-text("Next"), button:has-text("Load more")').count();
  console.log(`   Found ${pagination} pagination elements`);

  // Network analysis - look for API endpoints
  console.log('\n11. Intercepting network requests...');
  const apiCalls: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('.json')) {
      apiCalls.push(url);
    }
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('   API endpoints found:');
  apiCalls.slice(0, 10).forEach(url => console.log(`   - ${url}`));

  await browser.close();
  console.log('\n=== Exploration complete ===');
}

explore().catch(console.error);
