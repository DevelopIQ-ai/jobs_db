/**
 * Y Combinator Founder Directory Scraper
 *
 * Scrapes all company/founder data from https://www.ycombinator.com/companies
 * Extracts: company name, founders, batch, industry, description, and more.
 *
 * Usage:
 *   npx tsx yc-scraper.ts
 *
 * Output:
 *   output/yc-founders.json
 *   output/yc-founders.csv
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface Founder {
  name: string;
  title: string | null;
  linkedIn: string | null;
  twitter: string | null;
}

interface Company {
  // Basic Info
  name: string;
  slug: string;
  profileUrl: string;
  logoUrl: string | null;

  // Batch & Status
  batch: string;
  status: string | null; // Active, Acquired, Inactive, Public

  // Description
  oneLiner: string;
  longDescription: string | null;

  // Industry & Tags
  industries: string[];
  tags: string[];

  // Team
  teamSize: string | null;
  founders: Founder[];

  // Location
  location: string | null;
  regions: string[];

  // Links
  website: string | null;
  linkedIn: string | null;
  twitter: string | null;

  // Metadata
  scrapedAt: string;
}

interface Progress {
  lastBatch: string | null;
  companiesScraped: number;
  companies: Company[];
  failedUrls: string[];
  processedSlugs: string[];
}

const BASE_URL = 'https://www.ycombinator.com';
const COMPANIES_URL = `${BASE_URL}/companies`;
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'yc-founders.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'yc-founders.csv');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

// Rate limiting config - be respectful
const DELAY_BETWEEN_SCROLLS = 2000; // 2 seconds between scroll actions
const DELAY_BETWEEN_PROFILES = 2500; // 2.5 seconds between company page visits
const MAX_SCROLL_ATTEMPTS = 150; // Max scrolls

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    lastBatch: null,
    companiesScraped: 0,
    companies: [],
    failedUrls: [],
    processedSlugs: []
  };
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function extractCompaniesFromPage(page: Page): Promise<{ slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }[]> {
  return await page.evaluate(() => {
    const companies: { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }[] = [];
    const seen = new Set<string>();

    // The company "card" is actually the <a> link with _company_ class
    // Structure: <a class="_company_..." href="/companies/slug">...content...</a>
    const companyLinks = document.querySelectorAll('a[class*="_company_"][href^="/companies/"]');

    companyLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href === '/companies' || href === '/companies/' || href.includes('?')) return;

      const slugMatch = href.match(/\/companies\/([^/?]+)$/);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      // The link element IS the card - extract data from within it
      const card = link;

      // Extract company name
      const nameEl = card.querySelector('[class*="_coName_"]') as HTMLElement;
      const name = nameEl?.textContent?.trim() || '';

      if (!name || name.length < 2) return;

      // Extract location
      const locationEl = card.querySelector('[class*="_coLocation_"]') as HTMLElement;
      const location = locationEl?.textContent?.trim() || '';

      // Extract one-liner description
      let oneLiner = '';
      const descDivs = card.querySelectorAll('div.text-sm, [class*="text-sm"]');
      for (const div of descDivs) {
        const span = div.querySelector('span');
        if (span) {
          const text = span.textContent?.trim();
          if (text && text.length > 5 && text.length < 300 && !text.match(/^[WS]\d{2}$/)) {
            oneLiner = text;
            break;
          }
        }
      }

      // Extract industries from pills within this link/card
      const industries: string[] = [];
      const pillEls = card.querySelectorAll('[class*="_pill_"]');
      pillEls.forEach(pill => {
        const text = pill.textContent?.trim();
        if (text && text.length > 1 && text.length < 50 && !text.match(/^[WS]\d{2}$/)) {
          // Skip if it contains SVG (YC logo)
          if (!pill.querySelector('svg') && !text.includes('Y Combinator')) {
            industries.push(text);
          }
        }
      });

      companies.push({
        slug,
        name,
        location,
        oneLiner,
        industries,
        profileUrl: `https://www.ycombinator.com${href}`
      });
    });

    return companies;
  });
}

function generateBatchList(): string[] {
  // Generate all YC batches from current year back to 2005
  // Format: "Summer 2024", "Winter 2024", etc. (URL encoded with space as %20)
  const batches: string[] = [];
  const currentYear = new Date().getFullYear(); // e.g., 2026

  for (let year = currentYear; year >= 2005; year--) {
    // Summer batch (June), then Winter batch (January)
    batches.push(`Summer ${year}`);
    batches.push(`Winter ${year}`);
  }

  return batches;
}

async function scrollAndCollectFromBatch(
  page: Page,
  batch: string,
  allCompanies: Map<string, { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }>
): Promise<number> {
  const url = `${COMPANIES_URL}?batch=${encodeURIComponent(batch)}`;
  console.log(`  Loading batch ${batch}...`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await delay(2000);

  let previousCount = allCompanies.size;
  let scrollAttempts = 0;
  let noNewCompaniesCount = 0;
  const startCount = allCompanies.size;

  while (scrollAttempts < 50) { // Max 50 scrolls per batch
    scrollAttempts++;

    // Extract companies currently visible
    const companies = await extractCompaniesFromPage(page);

    for (const company of companies) {
      if (!allCompanies.has(company.slug)) {
        allCompanies.set(company.slug, company);
      }
    }

    const currentCount = allCompanies.size;

    if (currentCount === previousCount) {
      noNewCompaniesCount++;
      if (noNewCompaniesCount >= 3) {
        break; // No more companies in this batch
      }
    } else {
      noNewCompaniesCount = 0;
    }

    previousCount = currentCount;

    // Scroll down to load more
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 2);
    });

    await delay(DELAY_BETWEEN_SCROLLS);
  }

  const batchCount = allCompanies.size - startCount;
  return batchCount;
}

async function scrollAndCollectCompanies(page: Page): Promise<{ slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }[]> {
  console.log('\nCollecting companies from all YC batches...');

  const batches = generateBatchList();
  console.log(`Will check ${batches.length} batches (${batches[0]} to ${batches[batches.length - 1]})`);

  const allCompanies = new Map<string, { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }>();

  for (const batch of batches) {
    const batchCount = await scrollAndCollectFromBatch(page, batch, allCompanies);
    console.log(`    Batch ${batch}: ${batchCount} companies (total: ${allCompanies.size})`);

    // Small delay between batches
    await delay(1000);
  }

  console.log(`\nTotal companies found across all batches: ${allCompanies.size}`);
  return Array.from(allCompanies.values());
}

async function scrapeCompanyPage(page: Page, company: { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }): Promise<Company | null> {
  try {
    await page.goto(company.profileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(1500);

    // Extract detailed information from company page
    const details = await page.evaluate(() => {
      const result = {
        name: '',
        batch: '',
        status: null as string | null,
        oneLiner: '',
        longDescription: null as string | null,
        industries: [] as string[],
        tags: [] as string[],
        teamSize: null as string | null,
        location: null as string | null,
        website: null as string | null,
        linkedIn: null as string | null,
        twitter: null as string | null,
        logoUrl: null as string | null,
        founders: [] as { name: string; title: string | null; linkedIn: string | null; twitter: string | null }[]
      };

      const pageText = document.body.innerText || '';

      // Extract batch - look for "Batch: Summer 2013" or "SUMMER 2013" pattern
      const batchMatch = pageText.match(/Batch:?\s*(Winter|Summer|Spring|Fall)\s*(\d{4})/i);
      if (batchMatch) {
        const season = batchMatch[1].toLowerCase();
        const year = batchMatch[2].slice(-2); // Get last 2 digits
        const seasonCode = season.startsWith('s') ? 'S' : 'W'; // Summer/Spring = S, Winter = W
        result.batch = `${seasonCode}${year}`;
      }

      // Also check for abbreviated batch in page text
      if (!result.batch) {
        const shortBatchMatch = pageText.match(/\b([WS]\d{2})\b/);
        if (shortBatchMatch) {
          result.batch = shortBatchMatch[1];
        }
      }

      // Extract status from structured text: "Status: Public"
      const statusMatch = pageText.match(/Status:?\s*(Active|Acquired|Public|Inactive|Exited)/i);
      if (statusMatch) {
        result.status = statusMatch[1];
      }

      // Extract team size: "Team Size: 8600"
      const teamSizeMatch = pageText.match(/Team Size:?\s*(\d[\d,]*)/i);
      if (teamSizeMatch) {
        result.teamSize = teamSizeMatch[1].replace(/,/g, '');
      }

      // Extract location: "Location: San Francisco"
      const locationMatch = pageText.match(/Location:?\s*([A-Za-z\s,]+?)(?:\n|Founders)/i);
      if (locationMatch) {
        result.location = locationMatch[1].trim();
      }

      // Long description - find the main paragraph after website URL
      const descMatch = pageText.match(/(?:http[s]?:\/\/[^\s]+)\s*\n([^]+?)(?:\nLatest News|\nJobs at|\nFounded:|\nActive Founders)/i);
      if (descMatch) {
        const desc = descMatch[1].trim();
        if (desc.length > 50 && !desc.startsWith('Founded:')) {
          result.longDescription = desc;
        }
      }

      // Extract website link - look for http link displayed after company info header
      const websiteMatch = pageText.match(/(?:News|Company|Jobs)\s*(?:\d+)?\s*(?:News)?\s*(https?:\/\/(?!www\.ycombinator\.com)[^\s]+)/i);
      if (websiteMatch) {
        result.website = websiteMatch[1];
      }

      // Extract founders from the "Founders" section
      // Look for section that starts with "Founders" and extract name/title pairs
      const foundersMatch = pageText.match(/(?:Active\s+)?Founders\s*\n([\s\S]*?)(?:\nFooter|\nY Combinator|$)/i);
      if (foundersMatch) {
        const foundersSection = foundersMatch[1];

        // Better pattern: Look for names followed by Founder/CEO titles
        // Names are typically "First Last" format followed by title on next line or same line
        const lines = foundersSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Check if this line looks like a name (2-4 capitalized words)
          const nameMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
          if (nameMatch) {
            const name = nameMatch[1];

            // Skip if name contains common non-name words
            if (name.toLowerCase().includes('footer') ||
                name.toLowerCase().includes('combinator') ||
                name.toLowerCase().includes('latest') ||
                name.toLowerCase().includes('news') ||
                name.toLowerCase().includes('jobs')) {
              continue;
            }

            // Look for title in next line
            let title = 'Founder';
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              if (nextLine.match(/^(Co-?)?Founder|^CEO|^CTO|^COO/i)) {
                title = nextLine;
                i++; // Skip the title line
              }
            }

            // Check if we already have this founder
            if (!result.founders.some(f => f.name === name)) {
              result.founders.push({
                name,
                title,
                linkedIn: null,
                twitter: null
              });
            }
          }
        }
      }

      // Get LinkedIn profile URLs for founders
      const linkedInLinks = document.querySelectorAll('a[href*="linkedin.com/in"]');
      const linkedInUrls: string[] = [];
      linkedInLinks.forEach(link => {
        const href = (link as HTMLAnchorElement).href;
        if (!linkedInUrls.includes(href)) {
          linkedInUrls.push(href);
        }
      });

      // Try to match LinkedIn URLs to founders by position (they appear in same order)
      result.founders.forEach((founder, i) => {
        if (i < linkedInUrls.length) {
          founder.linkedIn = linkedInUrls[i];
        }
      });

      // Get company LinkedIn
      const companyLinkedIn = document.querySelector('a[href*="linkedin.com/company"]');
      if (companyLinkedIn) {
        result.linkedIn = (companyLinkedIn as HTMLAnchorElement).href;
      }

      // Get Twitter
      const twitterLink = document.querySelector('a[href*="twitter.com"]:not([href*="/intent/"]), a[href*="x.com"]:not([href*="/intent/"])');
      if (twitterLink) {
        result.twitter = (twitterLink as HTMLAnchorElement).href;
      }

      // Get logo
      const logo = document.querySelector('img[src*="bookface-images"], img[src*="logo"]') as HTMLImageElement;
      if (logo) {
        result.logoUrl = logo.src;
      }

      return result;
    });

    // Build full company object - use name from list (it's cleaner)
    return {
      name: company.name,
      slug: company.slug,
      profileUrl: company.profileUrl,
      logoUrl: details.logoUrl,
      batch: details.batch,
      status: details.status,
      oneLiner: company.oneLiner, // Use from list - it's the short tagline
      longDescription: details.longDescription,
      industries: company.industries, // Use from list - it's properly extracted there
      tags: [],
      teamSize: details.teamSize,
      founders: details.founders,
      location: details.location || company.location,
      regions: [],
      website: details.website,
      linkedIn: details.linkedIn,
      twitter: details.twitter,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`  Error scraping ${company.profileUrl}: ${error}`);
    return null;
  }
}

function convertToCSV(companies: Company[]): string {
  const headers = [
    'Company Name',
    'Batch',
    'Status',
    'One Liner',
    'Industries',
    'Location',
    'Team Size',
    'Founders',
    'Website',
    'LinkedIn',
    'Twitter',
    'Profile URL'
  ];

  const escapeCSV = (str: string): string => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = companies.map(c => [
    escapeCSV(c.name),
    escapeCSV(c.batch),
    escapeCSV(c.status || ''),
    escapeCSV(c.oneLiner),
    escapeCSV(c.industries.join('; ')),
    escapeCSV(c.location || ''),
    escapeCSV(c.teamSize || ''),
    escapeCSV(c.founders.map(f => f.name).join('; ')),
    escapeCSV(c.website || ''),
    escapeCSV(c.linkedIn || ''),
    escapeCSV(c.twitter || ''),
    escapeCSV(c.profileUrl)
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

async function main() {
  console.log('='.repeat(60));
  console.log('Y Combinator Company & Founder Scraper');
  console.log('='.repeat(60));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load progress
  let progress = loadProgress();
  console.log(`\nLoaded progress: ${progress.companies.length} companies previously scraped`);

  const browser: Browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // Step 1: Scroll through directory and collect all company slugs
    const companiesFromList = await scrollAndCollectCompanies(page);
    console.log(`\nFound ${companiesFromList.length} companies in directory`);

    // Filter out already processed
    const processedSet = new Set(progress.processedSlugs);
    const toProcess = companiesFromList.filter(c => !processedSet.has(c.slug));
    console.log(`${toProcess.length} companies to process (${processedSet.size} already done)`);

    // Step 2: Scrape each company page for detailed info
    let processed = 0;
    for (const company of toProcess) {
      processed++;
      console.log(`\n[${processed}/${toProcess.length}] Scraping: ${company.name}`);

      const fullCompany = await scrapeCompanyPage(page, company);

      if (fullCompany) {
        progress.companies.push(fullCompany);
        progress.processedSlugs.push(company.slug);

        const founderNames = fullCompany.founders.map(f => f.name).join(', ') || 'No founders found';
        console.log(`  Batch: ${fullCompany.batch || 'Unknown'} | Founders: ${founderNames}`);
      } else {
        progress.failedUrls.push(company.profileUrl);
        progress.processedSlugs.push(company.slug); // Mark as processed even if failed
        console.log(`  Failed to scrape`);
      }

      progress.companiesScraped = progress.companies.length;

      // Save progress every 10 companies
      if (processed % 10 === 0) {
        saveProgress(progress);
        console.log(`\n  [Progress saved: ${progress.companies.length} total companies]`);
      }

      // Rate limiting
      await delay(DELAY_BETWEEN_PROFILES);
    }

    // Final save
    saveProgress(progress);

    // Sort companies by batch (newest first) then by name
    progress.companies.sort((a, b) => {
      // Sort by batch year (newest first)
      const batchA = a.batch || 'A00';
      const batchB = b.batch || 'A00';
      const yearA = parseInt(batchA.slice(1)) || 0;
      const yearB = parseInt(batchB.slice(1)) || 0;

      if (yearA !== yearB) return yearB - yearA;

      // Same year - S comes after W (Summer is later in year)
      if (batchA[0] !== batchB[0]) return batchA[0] === 'S' ? -1 : 1;

      // Same batch - sort by name
      return a.name.localeCompare(b.name);
    });

    // Write final JSON output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalCompanies: progress.companies.length,
      failedUrls: progress.failedUrls,
      companies: progress.companies
    }, null, 2));

    // Write CSV output
    fs.writeFileSync(CSV_FILE, convertToCSV(progress.companies));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Scraping complete!');
    console.log(`Total companies scraped: ${progress.companies.length}`);
    console.log(`Failed URLs: ${progress.failedUrls.length}`);
    console.log(`Output saved to:`);
    console.log(`  JSON: ${OUTPUT_FILE}`);
    console.log(`  CSV: ${CSV_FILE}`);
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error('Fatal error:', error);
    saveProgress(progress);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the scraper
main().catch(console.error);
