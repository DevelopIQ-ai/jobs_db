import { Camoufox } from 'camoufox-js';
import {
  fetchFilteredCount,
  fetchFilteredPage,
  buildSearchState,
  encodeFilter,
  openFilteredSearch,
} from './helpers';

const CF_TIMEOUT_MS = 120_000;

async function dumpPageStructure(page: any, tag: string) {
  try {
    const info = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')].map(f => ({
        src: (f.src || '').substring(0, 200), w: f.offsetWidth, h: f.offsetHeight,
      }));

      const allEls = [...document.querySelectorAll('*')];
      const visible = allEls.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 5 && r.height > 5;
      });

      const interactives = visible
        .filter(el => ['INPUT', 'BUTTON', 'LABEL', 'A'].includes(el.tagName) || el.getAttribute('role'))
        .map(el => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName, type: (el as HTMLInputElement).type || '',
            id: el.id, role: el.getAttribute('role') || '',
            cls: el.className?.toString().substring(0, 80) || '',
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          };
        });

      // Check the known CF widget container
      const widgetEl = document.getElementById('AOzYg6') || document.querySelector('[id^="cf-chl-widget"]')?.parentElement?.parentElement?.parentElement;
      let widgetInfo = null;
      if (widgetEl) {
        const r = widgetEl.getBoundingClientRect();
        widgetInfo = {
          id: widgetEl.id,
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
          childCount: widgetEl.querySelectorAll('*').length,
          innerHTML: widgetEl.innerHTML.substring(0, 500),
        };
      }

      const shadowHosts = allEls.filter(el => el.shadowRoot).map(el => ({
        tag: el.tagName, id: el.id, cls: el.className?.toString().substring(0, 80) || '',
      }));

      return { iframes, interactives, widgetInfo, shadowHosts };
    });

    console.log(`\n[${tag}] iframes=${info.iframes.length} interactives=${info.interactives.length} shadows=${info.shadowHosts.length}`);
    for (const el of info.interactives) {
      console.log(`  <${el.tag} type="${el.type}" id="${el.id}" role="${el.role}"> at (${el.x},${el.y}) ${el.w}x${el.h}`);
    }
    for (const f of info.iframes) {
      console.log(`  iframe: src="${f.src}" ${f.w}x${f.h}`);
    }
    for (const sh of info.shadowHosts) {
      console.log(`  shadow: <${sh.tag} id="${sh.id}" class="${sh.cls}">`);
    }
    if (info.widgetInfo) {
      console.log(`  CF widget: id="${info.widgetInfo.id}" at (${info.widgetInfo.x},${info.widgetInfo.y}) ${info.widgetInfo.w}x${info.widgetInfo.h} children=${info.widgetInfo.childCount}`);
      console.log(`  widget HTML: ${info.widgetInfo.innerHTML}`);
    }
    console.log('');
  } catch (err) {
    console.log(`[${tag}] dump failed: ${(err as Error).message}`);
  }
}

async function tryClickChallenge(page: any): Promise<boolean> {
  // Strategy 1: Click the CF widget container at the checkbox position
  // The widget container is typically id="AOzYg6" or similar random ID
  // We find it via the hidden input inside it
  const widgetBox = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    if (!input) return null;
    // Walk up to the outermost container div
    let container = input.parentElement;
    while (container && container.parentElement && container.parentElement.tagName !== 'BODY' &&
           container.parentElement.classList.length === 0 && !container.parentElement.id.startsWith('Y')) {
      container = container.parentElement;
    }
    // Get the container with the display:grid style (the actual widget wrapper)
    const gridEl = document.querySelector('[style*="display: grid"]') || container;
    if (!gridEl) return null;
    const r = gridEl.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, id: (gridEl as HTMLElement).id };
  });

  if (widgetBox && widgetBox.width > 10 && widgetBox.height > 10) {
    // Checkbox is near the left side of the widget, vertically centered
    const clickX = widgetBox.x + Math.min(35, widgetBox.width * 0.1);
    const clickY = widgetBox.y + widgetBox.height / 2;
    console.log(`CF widget "${widgetBox.id}" at (${Math.round(widgetBox.x)},${Math.round(widgetBox.y)}) ${Math.round(widgetBox.width)}x${Math.round(widgetBox.height)}`);
    console.log(`Clicking checkbox position at (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.move(clickX, clickY, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.click(clickX, clickY);
    return true;
  }

  // Strategy 2: find any iframe that appeared late
  const iframes = page.locator('iframe');
  const iframeCount = await iframes.count();
  for (let i = 0; i < iframeCount; i++) {
    const box = await iframes.nth(i).boundingBox().catch(() => null);
    if (box && box.width >= 20 && box.height >= 15) {
      const cx = box.x + Math.min(33, box.width * 0.12);
      const cy = box.y + box.height / 2;
      console.log(`Late iframe ${box.width}x${box.height}, clicking at (${Math.round(cx)}, ${Math.round(cy)})`);
      await page.mouse.move(cx, cy, { steps: 10 });
      await page.waitForTimeout(150);
      await page.mouse.click(cx, cy);
      return true;
    }
  }

  // Strategy 3: try common interactive selectors
  for (const sel of ['input[type="checkbox"]', '[role="checkbox"]', 'label', 'button:visible']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 5 && box.height > 5) {
        console.log(`Found "${sel}" at (${Math.round(box.x)},${Math.round(box.y)}) ${box.width}x${box.height}`);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
        await page.waitForTimeout(150);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      }
    }
  }

  return false;
}

async function waitForCF(page: any) {
  const start = Date.now();

  console.log('Navigating to hiring.cafe...');
  await page.goto('https://hiring.cafe', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(4000);

  while (Date.now() - start < CF_TIMEOUT_MS) {
    const sec = Math.round((Date.now() - start) / 1000);
    const cookies = await page.context().cookies('https://hiring.cafe');
    const cleared = cookies.some((c: { name: string }) => c.name === 'cf_clearance');
    const title = await page.title().catch(() => '?');

    console.log(`[${sec}s] title="${title}" cf_clearance=${cleared ? 'YES' : 'no'}`);

    if (cleared) {
      console.log('CF CLEARED!');
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);
      return;
    }

    // Dump page every 10 seconds
    if (sec >= 5 && sec % 10 < 3) {
      await dumpPageStructure(page, `${sec}s`);
    }

    // Try clicking every iteration
    const clicked = await tryClickChallenge(page);
    if (clicked) {
      await page.waitForTimeout(5000);
      const post = await page.context().cookies('https://hiring.cafe');
      if (post.some((c: { name: string }) => c.name === 'cf_clearance')) {
        console.log('CF CLEARED after click!');
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(2000);
        return;
      }
    }

    await page.waitForTimeout(2000);
  }

  throw new Error('CF did not clear in time');
}

async function main() {
  const proxyUrl = process.env.PROXY_URL;

  console.log('=== Headed Camoufox + Filtered Search test ===');
  console.log(`proxy: ${proxyUrl ? 'yes' : 'none (local IP)'}\n`);

  const options: Record<string, any> = {
    headless: false,
    humanize: true,
    locale: 'en-US',
  };

  if (proxyUrl) {
    options.proxy = proxyUrl;
    options.geoip = true;
  }

  const browser = await Camoufox(options);

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });

    await waitForCF(page);

    console.log('\n--- Filtered search (US, past 24h) ---');
    const { encodedFilter, initialResults, countData } = await openFilteredSearch(page, 1);

    console.log(`Initial page: ${initialResults.length} jobs`);
    if (countData) {
      console.log(`Total: ${countData.total?.toLocaleString()}, Collapsed: ${countData.collapsedTotal?.toLocaleString()}`);
    }

    const page1 = await fetchFilteredPage(page, encodedFilter, 1);
    console.log(`Page 1: ${page1.length} jobs`);

    if (initialResults.length > 0) {
      const s = initialResults[0];
      console.log(`Sample: "${s.job_information?.title}" at ${s.enriched_company_data?.name || '?'}`);
    }

    console.log('\nBrowser open 15s...');
    await page.waitForTimeout(15000);
  } finally {
    await browser.close();
  }

  console.log('Done!');
}

main().catch(console.error);
