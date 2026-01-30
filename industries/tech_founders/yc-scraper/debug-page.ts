/**
 * Debug script to understand YC page structure
 */

import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to YC company directory...');
    await page.goto('https://www.ycombinator.com/companies', { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for JavaScript to render
    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({ path: 'output/yc-page.png', fullPage: false });
    console.log('Screenshot saved to output/yc-page.png');

    // Get page content
    const html = await page.content();
    fs.writeFileSync('output/yc-page.html', html);
    console.log('HTML saved to output/yc-page.html');

    // Analyze structure
    const analysis = await page.evaluate(() => {
      const results: any = {
        allLinks: [],
        divClasses: new Set<string>(),
        companyData: []
      };

      // Find all links
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (href && href.includes('/companies/')) {
          results.allLinks.push({
            href,
            text: a.textContent?.substring(0, 100)?.trim(),
            parentClasses: a.parentElement?.className
          });
        }
      });

      // Get unique class names that might be company-related
      document.querySelectorAll('*').forEach(el => {
        const className = el.className;
        if (typeof className === 'string' && (
          className.toLowerCase().includes('company') ||
          className.toLowerCase().includes('card') ||
          className.toLowerCase().includes('item') ||
          className.toLowerCase().includes('result') ||
          className.toLowerCase().includes('list')
        )) {
          results.divClasses.add(className);
        }
      });

      // Convert Set to Array for JSON
      results.divClasses = Array.from(results.divClasses);

      return results;
    });

    console.log('\n=== COMPANY LINKS FOUND ===');
    console.log(`Total links with /companies/: ${analysis.allLinks.length}`);
    analysis.allLinks.slice(0, 20).forEach((link: any) => {
      console.log(`  ${link.href} - "${link.text?.substring(0, 50)}"`);
    });

    console.log('\n=== RELEVANT CSS CLASSES ===');
    analysis.divClasses.slice(0, 30).forEach((cls: string) => {
      console.log(`  ${cls}`);
    });

    // Try to find the main content area
    const contentInfo = await page.evaluate(() => {
      // Look for main content container
      const main = document.querySelector('main') || document.querySelector('[role="main"]');
      if (main) {
        return {
          mainExists: true,
          mainClasses: main.className,
          childCount: main.children.length,
          firstChildClasses: main.children[0]?.className,
          innerHTML: main.innerHTML.substring(0, 2000)
        };
      }
      return { mainExists: false };
    });

    console.log('\n=== MAIN CONTENT INFO ===');
    console.log(JSON.stringify(contentInfo, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main();
