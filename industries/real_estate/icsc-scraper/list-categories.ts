/**
 * List all available member categories on ICSC
 */

import { chromium } from 'playwright';

const CREDENTIALS = {
  email: 'kush@developiq.ai',
  password: '***REMOVED***',
};

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  console.log('Logging in...');
  await page.goto('https://www.icsc.com/login');
  await page.waitForTimeout(3000);

  try {
    const confirmBtn = await page.$('button:has-text("Confirm")');
    if (confirmBtn) await confirmBtn.click();
  } catch {}

  await page.fill('input[name="username"]', CREDENTIALS.email);
  await page.fill('input[name="password"]', CREDENTIALS.password);
  await page.click('button:text-is("Sign In")');
  await page.waitForTimeout(5000);

  // Go to member search without filters
  console.log('Loading member search...');
  await page.goto('https://www.icsc.com/search?type=members&perPage=24&view=list');
  await page.waitForTimeout(5000);

  // Expand Business Type filter and get all options
  console.log('\nLooking for Business Type filter...\n');

  // Click to expand Business Type
  const businessTypeFilter = await page.$('text=Business Type');
  if (businessTypeFilter) {
    await businessTypeFilter.click();
    await page.waitForTimeout(2000);
  }

  // Get all business type options
  const categories = await page.evaluate(() => {
    const results: { name: string; count: string }[] = [];

    // Look for filter checkboxes/options
    const filterItems = document.querySelectorAll('[class*="refinement"], [class*="facet"], [class*="filter"] label, [class*="filter"] li');

    filterItems.forEach(item => {
      const text = item.textContent?.trim() || '';
      // Parse "Category Name 123" format
      const match = text.match(/^(.+?)\s+(\d+)$/);
      if (match) {
        results.push({ name: match[1].trim(), count: match[2] });
      } else if (text.length > 2 && text.length < 100) {
        results.push({ name: text, count: '?' });
      }
    });

    // Also get from the page text
    const bodyText = document.body.innerText;

    // Look for the Business Type section
    const businessTypeMatch = bodyText.match(/Business Type\+?([\s\S]*?)(?=Country|State\/Province|Global Region|$)/i);
    if (businessTypeMatch) {
      const section = businessTypeMatch[1];
      // Parse lines with numbers
      const lines = section.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const match = line.match(/^(.+?)\s+(\d+)$/);
        if (match && !results.find(r => r.name === match[1].trim())) {
          results.push({ name: match[1].trim(), count: match[2] });
        }
      });
    }

    return results;
  });

  console.log('='.repeat(60));
  console.log('ICSC MEMBER CATEGORIES');
  console.log('='.repeat(60));
  console.log('\nBusiness Types found:\n');

  // Dedupe and sort
  const seen = new Set<string>();
  const unique = categories.filter(c => {
    if (seen.has(c.name) || c.name.length < 3) return false;
    seen.add(c.name);
    return true;
  });

  // Sort by count descending
  unique.sort((a, b) => {
    const countA = parseInt(a.count) || 0;
    const countB = parseInt(b.count) || 0;
    return countB - countA;
  });

  unique.forEach(c => {
    console.log(`  ${c.name}: ${c.count} members`);
  });

  // Take screenshot
  await page.screenshot({ path: 'output/categories.png', fullPage: true });
  console.log('\nScreenshot saved to output/categories.png');

  await browser.close();
}

main().catch(console.error);
