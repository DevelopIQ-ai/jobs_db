export const DEFAULT_PAGE_SIZE = 250;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

const US_LOCATION = {
  id: 'FxY1yZQBoEtHp_8UEq7V',
  types: ['country'],
  address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }],
  formatted_address: 'United States',
  population: 327167434,
  workplace_types: ['Remote', 'Hybrid', 'Onsite'],
  options: { flexible_regions: [] },
};

/* ------------------------------------------------------------------ */
/*  Filter encoding                                                    */
/* ------------------------------------------------------------------ */

export function encodeFilter(filter: object): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(filter))).toString('base64');
}

/**
 * hiring.cafe uses internal values for dateFetchedPastNDays, NOT literal day counts.
 */
export const TIME_FILTER_MAP: Record<string, number> = {
  '24h': 2, '3d': 4, '1w': 14, '2w': 21,
  '3w': 29, '1m': 61, '2m': 91, '4m': 151, 'all': -1,
};

export function resolveTimeFilter(window: string | number): number {
  if (typeof window === 'string' && window in TIME_FILTER_MAP) {
    return TIME_FILTER_MAP[window];
  }
  return typeof window === 'number' ? window : 2;
}

export function daysToSiteValue(days: number): number {
  if (days <= 1)  return 2;
  if (days <= 3)  return 4;
  if (days <= 7)  return 14;
  if (days <= 14) return 21;
  if (days <= 21) return 29;
  if (days <= 30) return 61;
  if (days <= 60) return 91;
  if (days <= 120) return 151;
  return -1;
}

export function buildSearchState(windowDays: number) {
  return {
    locations: [US_LOCATION],
    workplaceTypes: ['Remote', 'Hybrid', 'Onsite'],
    dateFetchedPastNDays: daysToSiteValue(windowDays),
    searchQuery: '',
  };
}

/* ------------------------------------------------------------------ */
/*  BrightData Web Unlocker (with retry + safe JSON parsing)           */
/* ------------------------------------------------------------------ */

const BD_API_URL = 'https://api.brightdata.com/request';
const BD_ZONE = 'web_unlocker1';

async function bdRequest(targetUrl: string, apiKey: string): Promise<{ text: string; status: number }> {
  const res = await fetch(BD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ zone: BD_ZONE, url: targetUrl, format: 'raw' }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`BrightData HTTP ${res.status}: ${text.substring(0, 300)}`);
  }

  return { text, status: res.status };
}

export async function fetchViaBrightData(targetUrl: string, apiKey: string): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text } = await bdRequest(targetUrl, apiKey);

      if (!text || text.length === 0) {
        throw new Error('BrightData returned empty response body');
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err as Error;
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) break;

      const label = lastError.message.includes('JSON')
        ? 'JSON parse failed'
        : lastError.message.substring(0, 80);
      console.log(`  [retry ${attempt + 1}/${MAX_RETRIES}] ${label}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  throw lastError!;
}

/* ------------------------------------------------------------------ */
/*  High-level API helpers                                             */
/* ------------------------------------------------------------------ */

export function buildCountUrl(encodedFilter: string): string {
  return `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encodedFilter)}&sv=control`;
}

export function buildSearchUrl(encodedFilter: string, page: number, size: number = DEFAULT_PAGE_SIZE): string {
  return `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encodedFilter)}&size=${size}&page=${page}&sv=control`;
}

export async function fetchFilteredCount(apiKey: string, encodedFilter: string) {
  return fetchViaBrightData(buildCountUrl(encodedFilter), apiKey);
}

export async function fetchFilteredPage(apiKey: string, encodedFilter: string, pageNum: number, size: number = DEFAULT_PAGE_SIZE) {
  const data = await fetchViaBrightData(buildSearchUrl(encodedFilter, pageNum, size), apiKey);
  return data.results || [];
}
