/**
 * Debug script to find the correct ICSC filter parameters
 */

import { chromium, Page } from 'playwright';

const CREDENTIALS = {
  email: 'kush@developiq.ai',
  password: '***REMOVED***',
};

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Login
  console.log('Logging in...');
  await page.goto('https://www.icsc.com/login');
  await page.waitForTimeout(3000);

  // Dismiss privacy banner
  try {
    const confirmBtn = await page.$('button:has-text("Confirm")');
    if (confirmBtn) await confirmBtn.click();
  } catch {}

  await page.fill('input[name="username"]', CREDENTIALS.email);
  await page.fill('input[name="password"]', CREDENTIALS.password);
  await page.click('button:text-is("Sign In")');
  await page.waitForTimeout(5000);

  console.log('Logged in. Navigating to search...');

  // Go to member search
  await page.goto('https://www.icsc.com/search?type=members&perPage=24&view=list&refinementList%5Bbusiness_type%5D%5B0%5D=Owner%2FDeveloper%20%3E%20OWN01-Owner&refinementList%5Bbusiness_type%5D%5B1%5D=Owner%2FDeveloper%20%3E%20OWN03-Traditional%20Developer&refinementList%5Bbusiness_type%5D%5B2%5D=Owner%2FDeveloper%20%3E%20OWN02-Outlet%20Developer&page=1');
  await page.waitForTimeout(5000);

  // Look for state/location filter options
  console.log('\nLooking for filter elements...');

  const filters = await page.evaluate(() => {
    const results: string[] = [];

    // Look for filter labels and values
    const filterLabels = document.querySelectorAll('[class*="filter"], [class*="facet"], [class*="refinement"]');
    filterLabels.forEach(el => {
      const text = el.textContent?.trim().substring(0, 200);
      if (text) results.push('Filter element: ' + text);
    });

    // Look for state/province in any element
    const allText = document.body.innerText;
    if (allText.includes('State/Province')) {
      results.push('Found "State/Province" text on page');
    }
    if (allText.includes('Country')) {
      results.push('Found "Country" text on page');
    }
    if (allText.includes('Global Region')) {
      results.push('Found "Global Region" text on page');
    }

    // Look for filter links with state info
    const links = document.querySelectorAll('a[href*="state"], a[href*="province"], a[href*="region"], a[href*="country"]');
    links.forEach(l => {
      results.push('State-related link: ' + l.getAttribute('href')?.substring(0, 200));
    });

    // Get current URL
    results.push('Current URL: ' + window.location.href);

    return results;
  });

  console.log('\nFilter info:');
  filters.forEach(f => console.log('  ' + f));

  // Try clicking on a filter to see URL change
  console.log('\nLooking for State/Province filter...');

  // Take a screenshot of the sidebar
  await page.screenshot({ path: 'output/filters-debug.png', fullPage: true });
  console.log('Screenshot saved to output/filters-debug.png');

  // Look for and click state filter
  const stateFilter = await page.$('text=State/Province');
  if (stateFilter) {
    console.log('Found State/Province filter, clicking...');
    await stateFilter.click();
    await page.waitForTimeout(2000);

    // Look for California option
    const californiaOption = await page.$('text=California');
    if (californiaOption) {
      console.log('Found California option, clicking...');
      await californiaOption.click();
      await page.waitForTimeout(3000);

      // Get the new URL
      const newUrl = page.url();
      console.log('\nURL after selecting California:');
      console.log(newUrl);

      // Decode and print
      console.log('\nDecoded URL parameters:');
      const url = new URL(newUrl);
      url.searchParams.forEach((value, key) => {
        console.log(`  ${key} = ${value}`);
      });
    }
  }

  await browser.close();
}

main().catch(console.error);
