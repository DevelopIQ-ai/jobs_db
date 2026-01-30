/**
 * Test BIS site with evaluate-based polling
 */
import { chromium } from 'playwright';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to BIS...');
    await page.goto('https://a810-bisweb.nyc.gov/bisweb/bispi00.jsp', { waitUntil: 'networkidle' });
    console.log('Page loaded!');

    console.log('Filling form...');
    await page.selectOption('select[name="alljobtype"]', 'NB');
    await new Promise(r => setTimeout(r, 500));
    await page.selectOption('select[name="allcommbd"]', 'Manhattan -- ALL');
    await new Promise(r => setTimeout(r, 500));
    await page.selectOption('#allstartdate_month2', 'Jan');
    await page.fill('#allstartdate_day2', '1');
    await page.fill('#allstartdate_year2', '2024');
    await new Promise(r => setTimeout(r, 500));

    console.log('Triggering form submit via JavaScript...');
    await page.evaluate(() => {
      const btn = document.querySelector('input[name="go19"]') as HTMLInputElement;
      if (btn) btn.click();
    });

    console.log('Polling using evaluate...');
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));

      // Use evaluate to check content - this should not block on navigation
      const info = await page.evaluate(() => {
        return {
          url: window.location.href,
          bodyLength: document.body?.innerHTML?.length || 0,
          hasJobLinks: document.body?.innerHTML?.includes('JobsQueryByNumberServlet') || false,
          title: document.title
        };
      }).catch(e => ({ url: 'error', bodyLength: 0, hasJobLinks: false, title: String(e) }));

      console.log(`[${i}s] URL: ${info.url.substring(0, 50)}... Body: ${info.bodyLength}, Jobs: ${info.hasJobLinks}`);

      if (info.hasJobLinks) {
        console.log('SUCCESS! Job links found!');
        break;
      }
    }

  } catch (error) {
    console.log('ERROR:', error);
  }

  console.log('\nBrowser stays open for 30s...');
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
}

main();
