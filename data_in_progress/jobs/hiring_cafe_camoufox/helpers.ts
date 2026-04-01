export const PAGE_SIZE = 40;

const US_LOCATION = {
  id: 'FxY1yZQBoEtHp_8UEq7V',
  types: ['country'],
  address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }],
  formatted_address: 'United States',
  population: 327167434,
  workplace_types: ['Remote', 'Hybrid', 'Onsite'],
  options: { flexible_regions: [] },
};

export function encodeFilter(filter: object): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(filter))).toString('base64');
}

export function buildSearchState(windowDays: number) {
  return {
    locations: [US_LOCATION],
    workplaceTypes: ['Remote', 'Hybrid', 'Onsite'],
    dateFetchedPastNDays: windowDays,
    searchQuery: '',
  };
}

export function buildSearchPageUrl(windowDays: number): string {
  return `https://hiring.cafe/?searchState=${encodeURIComponent(JSON.stringify(buildSearchState(windowDays)))}`;
}

async function clickVisibleChallengeIframe(page: any): Promise<boolean> {
  const selectors = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[title*="challenge" i]',
    'iframe[title*="widget" i]',
  ];

  for (const selector of selectors) {
    const frames = page.locator(selector);
    const count = await frames.count();

    for (let index = 0; index < count; index++) {
      const frame = frames.nth(index);
      const box = await frame.boundingBox();

      if (!box || box.width < 20 || box.height < 20) {
        continue;
      }

      // Cloudflare's checkbox is usually near the left-middle of the iframe.
      const clickX = box.x + Math.min(35, box.width / 2);
      const clickY = box.y + box.height / 2;

      await page.mouse.move(clickX, clickY, { steps: 8 });
      await page.mouse.click(clickX, clickY);
      return true;
    }
  }

  const widgetContainer = page.locator('#AOzYg6');
  const widgetCount = await widgetContainer.count();
  if (widgetCount > 0) {
    const box = await widgetContainer.first().boundingBox();
    if (box && box.width > 40 && box.height > 20) {
      const clickX = box.x + Math.min(45, box.width / 6);
      const clickY = box.y + box.height / 2;

      await page.mouse.move(clickX, clickY, { steps: 8 });
      await page.mouse.click(clickX, clickY);
      return true;
    }
  }

  return false;
}

export async function waitForCloudflare(page: any) {
  const timeoutMs = Number(process.env.HC_CF_TIMEOUT_MS ?? '120000');
  const startedAt = Date.now();
  let clickedChallenge = false;

  console.log('Opening hiring.cafe in Camoufox...');
  await page.goto('https://hiring.cafe', { waitUntil: 'domcontentloaded', timeout: 90000 });

  while (Date.now() - startedAt < timeoutMs) {
    const title = await page.title();
    const cookies = await page.context().cookies('https://hiring.cafe');
    const hasClearance = cookies.some((cookie: { name: string }) => cookie.name === 'cf_clearance');
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

    console.log(
      `[${elapsedSec}s] title="${title}" cf_clearance=${hasClearance ? 'yes' : 'no'} url=${page.url()}`
    );

    if (hasClearance) {
      await page.goto('https://hiring.cafe/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(2000);
      return;
    }

    if (!clickedChallenge || elapsedSec % 15 === 0) {
      const didClick = await clickVisibleChallengeIframe(page);
      if (didClick) {
        clickedChallenge = true;
        console.log('Attempted to click the Cloudflare challenge checkbox automatically.');
        await page.waitForTimeout(3000);
        continue;
      }
    }

    await page.waitForTimeout(5000);
  }

  throw new Error('Cloudflare challenge did not clear in time.');
}

export async function fetchJsonInPage(page: any, url: string) {
  const result = await page.evaluate(async (targetUrl: string) => {
    const response = await fetch(targetUrl, {
      credentials: 'include',
      headers: {
        accept: '*/*',
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
      url: response.url,
    };
  }, url);

  if (!result.ok) {
    throw new Error(`HTTP ${result.status} for ${url}`);
  }

  return JSON.parse(result.body);
}

export async function openFilteredSearch(page: any, windowDays: number) {
  const targetUrl = buildSearchPageUrl(windowDays);
  const searchPromise = page.waitForResponse((response: any) => {
    const url = response.url();
    return url.includes('/api/search-jobs?') && !url.includes('get-total-count');
  }, { timeout: 90000 });
  const countPromise = page.waitForResponse((response: any) => {
    return response.url().includes('/api/search-jobs/get-total-count');
  }, { timeout: 90000 }).catch(() => null);

  console.log(`Navigating to filtered search page for past ${windowDays} day(s)...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

  const searchResponse = await searchPromise;
  const searchUrl = new URL(searchResponse.url());
  const encodedFilter = searchUrl.searchParams.get('s') ?? encodeFilter(buildSearchState(windowDays));
  const searchData = await searchResponse.json();

  let countData: any = null;
  const countResponse = await countPromise;
  if (countResponse) {
    try {
      countData = await countResponse.json();
    } catch {
      countData = null;
    }
  }

  return {
    encodedFilter,
    searchPageUrl: targetUrl,
    initialResults: searchData.results || [],
    countData,
  };
}

export async function fetchFilteredPage(page: any, encodedFilter: string, pageNum: number) {
  const url = `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encodedFilter)}&size=${PAGE_SIZE}&page=${pageNum}&sv=control`;
  const data = await fetchJsonInPage(page, url);
  return data.results || [];
}

export async function fetchFilteredCount(page: any, encodedFilter: string) {
  const url = `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encodedFilter)}&sv=control`;
  return fetchJsonInPage(page, url);
}
