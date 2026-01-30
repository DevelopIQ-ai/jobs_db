/**
 * Debug script to analyze a YC company page structure
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
    // Test with DoorDash company page
    console.log('Navigating to DoorDash company page...');
    await page.goto('https://www.ycombinator.com/companies/doordash', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: 'output/doordash-page.png', fullPage: true });
    console.log('Screenshot saved');

    // Save HTML
    const html = await page.content();
    fs.writeFileSync('output/doordash-page.html', html);
    console.log('HTML saved');

    // Analyze page structure
    const analysis = await page.evaluate(() => {
      const result: any = {
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim(),
        h2s: [] as string[],
        pageText: document.body.innerText?.substring(0, 5000),
        pillTexts: [] as string[],
        linkedInLinks: [] as string[],
        founderSections: [] as any[],
        allSections: [] as any[]
      };

      // Get all h2s
      document.querySelectorAll('h2').forEach(h2 => {
        result.h2s.push(h2.textContent?.trim());
      });

      // Get all pill/badge texts
      document.querySelectorAll('[class*="pill"], [class*="badge"], [class*="tag"]').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length < 100) {
          result.pillTexts.push(text);
        }
      });

      // Get LinkedIn profile links (founder profiles)
      document.querySelectorAll('a[href*="linkedin.com/in"]').forEach(link => {
        const href = (link as HTMLAnchorElement).href;
        const text = link.textContent?.trim();
        const parent = link.closest('div, section');
        result.linkedInLinks.push({
          href,
          text,
          parentText: parent?.textContent?.substring(0, 200)
        });
      });

      // Look for sections with "founder" in class or text
      document.querySelectorAll('section, div').forEach(section => {
        const className = section.className;
        const text = section.textContent || '';
        if ((className && className.toLowerCase().includes('founder')) ||
            text.toLowerCase().includes('active founder') ||
            text.toLowerCase().includes('founders')) {
          // Only add if it's a reasonable size
          if (text.length < 2000 && text.length > 20) {
            result.founderSections.push({
              className,
              text: text.substring(0, 500),
              html: section.innerHTML.substring(0, 1000)
            });
          }
        }
      });

      return result;
    });

    console.log('\n=== PAGE ANALYSIS ===');
    console.log('Title:', analysis.title);
    console.log('H1:', analysis.h1);
    console.log('\nH2s:', analysis.h2s);
    console.log('\nPill/Tag texts:', analysis.pillTexts.slice(0, 20));
    console.log('\nLinkedIn profile links:', analysis.linkedInLinks);
    console.log('\nFounder sections found:', analysis.founderSections.length);
    analysis.founderSections.forEach((section: any, i: number) => {
      console.log(`\nFounder Section ${i + 1}:`);
      console.log('  Class:', section.className);
      console.log('  Text:', section.text.substring(0, 300));
    });

    console.log('\n=== PAGE TEXT (first 2000 chars) ===');
    console.log(analysis.pageText.substring(0, 2000));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main();
