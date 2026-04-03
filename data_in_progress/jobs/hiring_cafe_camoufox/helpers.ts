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
/*  BrightData Web Unlocker                                            */
/* ------------------------------------------------------------------ */

const BD_API_URL = 'https://api.brightdata.com/request';
const BD_ZONE = 'web_unlocker1';

export async function fetchViaBrightData(targetUrl: string, apiKey: string): Promise<any> {
  const res = await fetch(BD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      zone: BD_ZONE,
      url: targetUrl,
      format: 'raw',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BrightData ${res.status}: ${body.substring(0, 300)}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  High-level API helpers                                             */
/* ------------------------------------------------------------------ */

export function buildCountUrl(encodedFilter: string): string {
  return `https://hiring.cafe/api/search-jobs/get-total-count?s=${encodeURIComponent(encodedFilter)}&sv=control`;
}

export function buildSearchUrl(encodedFilter: string, page: number): string {
  return `https://hiring.cafe/api/search-jobs?s=${encodeURIComponent(encodedFilter)}&size=${PAGE_SIZE}&page=${page}&sv=control`;
}

export async function fetchFilteredCount(apiKey: string, encodedFilter: string) {
  return fetchViaBrightData(buildCountUrl(encodedFilter), apiKey);
}

export async function fetchFilteredPage(apiKey: string, encodedFilter: string, pageNum: number) {
  const data = await fetchViaBrightData(buildSearchUrl(encodedFilter, pageNum), apiKey);
  return data.results || [];
}
