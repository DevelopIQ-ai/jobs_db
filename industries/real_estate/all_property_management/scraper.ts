/**
 * AllPropertyManagement.com Scraper
 *
 * Scrapes all property managers from https://www.allpropertymanagement.com
 * via their public API.
 *
 * Usage:
 *   # Scrape all managers
 *   npx tsx scraper.ts
 *
 *   # Filter by property type
 *   npx tsx scraper.ts --type multifamily
 *   npx tsx scraper.ts --type commercial
 *   npx tsx scraper.ts --type hoa
 *   npx tsx scraper.ts --type single-family
 *
 *   # Test mode (first 10 managers only)
 *   npx tsx scraper.ts --test
 *
 * Output:
 *   output/property-managers-{filter}-{date}.json
 *   output/property-managers-{filter}-{date}.csv
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

interface PropertyManager {
  id: number;
  name: string;

  // Address
  street: string;
  city: string;
  state: string;
  zip: string;
  additionalOffices: {
    street: string;
    city: string;
    state: string;
    zip: string;
  }[];

  // Contact
  email: string;

  // Profile
  tagline: string;
  htmlProfile: string;
  logoUrl: string | null;
  smallLogoUrl: string | null;

  // Property Types
  propertyTypes: {
    id: number;
    name: string;
    category: string;
  }[];

  // Flags
  isFeatured: boolean;

  // Metadata
  scrapedAt: string;
}

interface PropertyTypeCategory {
  ids: number[];
  names: string[];
}

// =============================================================================
// Property Type Definitions
// =============================================================================

const PROPERTY_TYPE_CATEGORIES: Record<string, PropertyTypeCategory> = {
  'multifamily': {
    ids: [50, 51, 52, 53],
    names: [
      'Multi-Family (2-4 units)',
      'Multi-Family (5-19 units)',
      'Multi-Family (20-99 units)',
      'Multi-Family (100+ units)',
    ],
  },
  'single-family': {
    ids: [35, 36, 37, 38],
    names: [
      'Single Home or Condo (Valued up to $300K)',
      'Single Home or Condo ($300 to $500K)',
      'Single Home or Condo ($500K to $1 Million)',
      'Single Home or Condo (Over $1 Million)',
    ],
  },
  'commercial': {
    ids: [54, 55, 56, 57, 58, 59, 60, 61, 62, 63],
    names: [
      'Office (Up to 9,999 sqft)',
      'Office (10,000 - 100,000 sqft)',
      'Office (100,000+ sqft)',
      'Retail (Up to 9,999 sqft)',
      'Retail (10,000 - 100,000 sqft)',
      'Retail (100,000+ sqft)',
      'Light Manufacturing (Up to 100,000 sqft)',
      'Light Manufacturing (100,000+ sqft)',
      'Warehouse/Distribution (Up to 100,000 sqft)',
      'Warehouse/Distribution (100,000+ sqft)',
    ],
  },
  'hoa': {
    ids: [72, 73, 74, 75, 76, 77],
    names: [
      'Homeowners Association (Up to 49 units)',
      'Homeowners Association (50-99 units)',
      'Condominium Association (Up to 49 units)',
      'Condominium Association (50-99 units)',
      'Homeowners Association (100+ units)',
      'Condominium Association (100+ units)',
    ],
  },
  'vacation': {
    ids: [80, 81],
    names: [
      'Vacation Rentals (1-9 units)',
      'Vacation Rentals (10+ units)',
    ],
  },
};

// =============================================================================
// API Client
// =============================================================================

const API_BASE = 'https://api.allpropertymanagement.com/public/v1';

async function fetchWithRetry<T>(url: string, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - wait longer
          const waitTime = 5000 * (i + 1);
          console.log(`  Rate limited, waiting ${waitTime / 1000}s...`);
          await delay(waitTime);
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
  throw new Error('Max retries exceeded');
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Scraping Functions
// =============================================================================

async function getAllManagerIds(): Promise<number[]> {
  console.log('Fetching all manager IDs...');
  const data = await fetchWithRetry<{ Id: number }[]>(`${API_BASE}/propertyManagers`);
  const ids = data.map(m => m.Id);
  console.log(`  Found ${ids.length} managers`);
  return ids;
}

function categorizePropertyType(id: number, name: string): string {
  for (const [category, def] of Object.entries(PROPERTY_TYPE_CATEGORIES)) {
    if (def.ids.includes(id)) {
      return category;
    }
  }
  return 'other';
}

async function getManagerProfile(id: number): Promise<PropertyManager | null> {
  try {
    const data = await fetchWithRetry<any>(`${API_BASE}/propertyManagers/${id}`);

    const propertyTypes = (data.PropertyTypes || []).map((pt: any) => ({
      id: pt.Id,
      name: pt.Name,
      category: categorizePropertyType(pt.Id, pt.Name),
    }));

    const links = data.Links || [];
    const logoLink = links.find((l: any) => l.Rel === 'logo');
    const smallLogoLink = links.find((l: any) => l.Rel === 'smallLogo');

    const additionalOffices = (data.AdditionalOfficeAddresses || []).map((addr: any) => ({
      street: addr.Street || '',
      city: addr.City || '',
      state: addr.State || '',
      zip: addr.Zipcode || '',
    }));

    return {
      id: data.Id,
      name: data.Name || '',
      street: data.Address?.Street || '',
      city: data.Address?.City || '',
      state: data.Address?.State || '',
      zip: data.Address?.Zipcode || '',
      additionalOffices,
      email: data.Email || '',
      tagline: data.TagLine || '',
      htmlProfile: data.HtmlProfile || '',
      logoUrl: logoLink?.Href || null,
      smallLogoUrl: smallLogoLink?.Href || null,
      propertyTypes,
      isFeatured: data.IsFeatured || false,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`  Failed to fetch manager ${id}:`, error);
    return null;
  }
}

async function scrapeAllManagers(
  ids: number[],
  batchSize: number = 20,
  onProgress?: (completed: number, total: number) => void
): Promise<PropertyManager[]> {
  const managers: PropertyManager[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id => getManagerProfile(id)));

    for (const result of results) {
      if (result) {
        managers.push(result);
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, ids.length), ids.length);
    }

    // Small delay between batches
    if (i + batchSize < ids.length) {
      await delay(100);
    }
  }

  return managers;
}

// =============================================================================
// Filtering
// =============================================================================

function filterByType(managers: PropertyManager[], typeFilter: string): PropertyManager[] {
  if (typeFilter === 'all') {
    return managers;
  }

  const category = PROPERTY_TYPE_CATEGORIES[typeFilter];
  if (!category) {
    console.error(`Unknown type filter: ${typeFilter}`);
    console.error(`Available filters: ${Object.keys(PROPERTY_TYPE_CATEGORIES).join(', ')}, all`);
    process.exit(1);
  }

  return managers.filter(m =>
    m.propertyTypes.some(pt => category.ids.includes(pt.id))
  );
}

// =============================================================================
// Output
// =============================================================================

function saveJson(managers: PropertyManager[], outputPath: string, metadata: Record<string, any>): void {
  const output = {
    ...metadata,
    managers,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
}

function saveCsv(managers: PropertyManager[], outputPath: string): void {
  const headers = [
    'ID',
    'Name',
    'Street',
    'City',
    'State',
    'Zip',
    'Email',
    'Tagline',
    'Property Types',
    'Property Type Categories',
    'Is Featured',
    'Logo URL',
    'Additional Offices',
    'Scraped At',
  ];

  const rows = managers.map(m => [
    m.id,
    escapeCsv(m.name),
    escapeCsv(m.street),
    escapeCsv(m.city),
    escapeCsv(m.state),
    escapeCsv(m.zip),
    escapeCsv(m.email),
    escapeCsv(m.tagline),
    escapeCsv(m.propertyTypes.map(pt => pt.name).join('; ')),
    escapeCsv([...new Set(m.propertyTypes.map(pt => pt.category))].join('; ')),
    m.isFeatured ? 'Yes' : 'No',
    escapeCsv(m.logoUrl || ''),
    escapeCsv(m.additionalOffices.map(o => `${o.city}, ${o.state}`).join('; ')),
    m.scrapedAt,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
}

function escapeCsv(value: string): string {
  if (!value) return '""';
  const escaped = value.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');
  const typeIndex = args.indexOf('--type');
  const typeFilter = typeIndex !== -1 ? args[typeIndex + 1] : 'all';

  console.log('\n' + '='.repeat(60));
  console.log('AllPropertyManagement.com Scraper');
  console.log('='.repeat(60));
  console.log(`Mode: ${testMode ? 'TEST (10 managers)' : 'FULL SCRAPE'}`);
  console.log(`Filter: ${typeFilter}`);
  console.log();

  // Get all manager IDs
  let ids = await getAllManagerIds();

  if (testMode) {
    ids = ids.slice(0, 10);
    console.log(`Test mode: limiting to ${ids.length} managers`);
  }

  // Scrape all profiles
  console.log('\nScraping profiles...');
  const startTime = Date.now();

  const allManagers = await scrapeAllManagers(ids, 20, (completed, total) => {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = completed / elapsed;
    const remaining = (total - completed) / rate;
    process.stdout.write(`\r  Progress: ${completed}/${total} (${Math.round(rate)}/s, ETA: ${Math.round(remaining)}s)    `);
  });

  console.log('\n');

  // Filter by type
  const filteredManagers = filterByType(allManagers, typeFilter);

  // Stats
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total scraped: ${allManagers.length}`);
  console.log(`After filter (${typeFilter}): ${filteredManagers.length}`);
  console.log(`Time elapsed: ${Math.round(elapsed)}s`);

  // Category breakdown
  const byCategoryAll: Record<string, number> = {};
  for (const m of allManagers) {
    const cats = [...new Set(m.propertyTypes.map(pt => pt.category))];
    for (const cat of cats) {
      byCategoryAll[cat] = (byCategoryAll[cat] || 0) + 1;
    }
  }

  console.log('\nManagers by category:');
  for (const [cat, count] of Object.entries(byCategoryAll).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // State breakdown
  const byState: Record<string, number> = {};
  for (const m of filteredManagers) {
    byState[m.state] = (byState[m.state] || 0) + 1;
  }

  console.log('\nTop 10 states:');
  const sortedStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [state, count] of sortedStates) {
    console.log(`  ${state}: ${count}`);
  }

  // Save output
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const filterSuffix = typeFilter === 'all' ? 'all' : typeFilter;

  const jsonPath = path.join(outputDir, `property-managers-${filterSuffix}-${timestamp}.json`);
  const csvPath = path.join(outputDir, `property-managers-${filterSuffix}-${timestamp}.csv`);

  const metadata = {
    scrapedAt: new Date().toISOString(),
    source: 'https://www.allpropertymanagement.com',
    totalScraped: allManagers.length,
    filter: typeFilter,
    filteredCount: filteredManagers.length,
    availableFilters: Object.keys(PROPERTY_TYPE_CATEGORIES),
  };

  saveJson(filteredManagers, jsonPath, metadata);
  saveCsv(filteredManagers, csvPath);

  console.log('\nOutput saved:');
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV: ${csvPath}`);

  // Sample output
  console.log('\n' + '='.repeat(60));
  console.log('Sample Results (first 3)');
  console.log('='.repeat(60));
  for (const m of filteredManagers.slice(0, 3)) {
    console.log(`\n${m.name}`);
    console.log(`  ${m.street}, ${m.city}, ${m.state} ${m.zip}`);
    console.log(`  Email: ${m.email || 'N/A'}`);
    console.log(`  Types: ${m.propertyTypes.map(pt => pt.category).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
  }
}

main().catch(console.error);
