/**
 * Test script to debug page text extraction
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Test job number we know has owner info
  const jobNumber = '140998375';
  const url = `https://a810-bisweb.nyc.gov/bisweb/JobsQueryByNumberServlet?passjobnumber=${jobNumber}&passdocnumber=01&requestid=0`;

  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Get page text
  const pageText = await page.evaluate(function() {
    return document.body.innerText;
  });

  // Save to file for inspection
  fs.writeFileSync('output/debug-page-text.txt', pageText);
  console.log('Page text saved to output/debug-page-text.txt');
  console.log('\nPage text length:', pageText.length);

  // Try to find Section 26
  const section26Match = pageText.match(/26\s+Owner's Information[\s\S]*?(?=27|Metes and Bounds|$)/i);
  if (section26Match) {
    console.log('\n=== Section 26 Found ===');
    console.log(section26Match[0].substring(0, 500));
  } else {
    console.log('\nSection 26 NOT found');
    console.log('Searching for "Owner" in page...');
    const ownerIndex = pageText.indexOf('Owner');
    if (ownerIndex > -1) {
      console.log('Found "Owner" at index', ownerIndex);
      console.log('Context:', pageText.substring(ownerIndex - 50, ownerIndex + 200));
    }
  }

  await browser.close();
}

main().catch(console.error);
