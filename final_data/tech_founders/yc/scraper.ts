#!/usr/bin/env npx tsx
/**
 * Y Combinator Founder Directory Scraper
 *
 * Scrapes all company/founder data from https://www.ycombinator.com/companies
 * Outputs founders as person entities in JSONL format.
 *
 * Usage:
 *   npx tsx scraper.ts          # Full scrape (resumes from checkpoint)
 *   npx tsx scraper.ts --test   # Test mode (10 companies only)
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_ID = "tech_founders/yc";
const BASE_URL = 'https://www.ycombinator.com';
const COMPANIES_URL = `${BASE_URL}/companies`;
const OUTPUT_DIR = path.join(__dirname, 'output');
const LEADS_FILE = path.join(OUTPUT_DIR, 'leads.jsonl');
const RUN_FILE = path.join(OUTPUT_DIR, 'run.json');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

const DELAY_BETWEEN_SCROLLS = 2000;
const DELAY_BETWEEN_PROFILES = 2500;

interface Founder {
  name: string;
  title: string | null;
  linkedIn: string | null;
  twitter: string | null;
}

interface Company {
  name: string;
  slug: string;
  profileUrl: string;
  logoUrl: string | null;
  batch: string;
  status: string | null;
  oneLiner: string;
  longDescription: string | null;
  industries: string[];
  tags: string[];
  teamSize: string | null;
  founders: Founder[];
  location: string | null;
  regions: string[];
  website: string | null;
  linkedIn: string | null;
  twitter: string | null;
  scrapedAt: string;
}

interface Progress {
  lastBatch: string | null;
  companiesScraped: number;
  companies: Company[];
  failedUrls: string[];
  processedSlugs: string[];
}

interface LeadRecord {
  core: {
    source_id: string;
    entity_type: "person";
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  person: {
    full_name: string;
    title?: string;
    company_name?: string;
    profile_url?: string;
  };
  contact: {
    website?: string;
    socials?: { platform: string; url: string }[];
    location?: {
      city?: string;
      state?: string;
      country?: string;
    };
  };
  context: {
    yc_batch?: string;
    company_status?: string;
    company_one_liner?: string;
    company_industries?: string[];
    company_team_size?: string;
    company_website?: string;
    company_linkedin?: string;
    company_twitter?: string;
    founder_role?: string;
  };
}

const TEST_MODE = process.argv.includes('--test');

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

function parseLocation(location: string | null): { city?: string; state?: string; country?: string } {
  if (!location) return {};

  const parts = location.split(',').map(p => p.trim());
  if (parts.length === 1) {
    return { city: parts[0] };
  } else if (parts.length === 2) {
    // Could be "City, State" or "City, Country"
    const second = parts[1];
    if (second.length === 2 && second === second.toUpperCase()) {
      return { city: parts[0], state: second, country: 'USA' };
    }
    return { city: parts[0], country: second };
  } else if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] };
  }
  return { city: location };
}

function normalizeFounderName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function convertToLeadRecord(company: Company, founder: Founder): LeadRecord {
  const location = parseLocation(company.location);
  const socials: { platform: string; url: string }[] = [];

  if (founder.linkedIn) {
    socials.push({ platform: 'linkedin', url: founder.linkedIn });
  }
  if (founder.twitter) {
    socials.push({ platform: 'twitter', url: founder.twitter });
  }

  return {
    core: {
      source_id: SOURCE_ID,
      entity_type: "person",
      scraped_at: company.scrapedAt,
      raw_url: company.profileUrl,
      primary_key: `${SOURCE_ID}:founder:${company.slug}:${normalizeFounderName(founder.name)}`,
    },
    person: {
      full_name: founder.name,
      title: founder.title || undefined,
      company_name: company.name,
      profile_url: company.profileUrl,
    },
    contact: {
      website: company.website || undefined,
      socials: socials.length > 0 ? socials : undefined,
      location: Object.keys(location).length > 0 ? location : undefined,
    },
    context: {
      yc_batch: company.batch || undefined,
      company_status: company.status || undefined,
      company_one_liner: company.oneLiner || undefined,
      company_industries: company.industries.length > 0 ? company.industries : undefined,
      company_team_size: company.teamSize || undefined,
      company_website: company.website || undefined,
      company_linkedin: company.linkedIn || undefined,
      company_twitter: company.twitter || undefined,
      founder_role: founder.title || undefined,
    },
  };
}

async function extractCompaniesFromPage(page: Page): Promise<{ slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }[]> {
  return await page.evaluate(() => {
    const companies: { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }[] = [];
    const seen = new Set<string>();

    const companyLinks = document.querySelectorAll('a[class*="_company_"][href^="/companies/"]');

    companyLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href === '/companies' || href === '/companies/' || href.includes('?')) return;

      const slugMatch = href.match(/\/companies\/([^/?]+)$/);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      const card = link;
      const nameEl = card.querySelector('[class*="_coName_"]') as HTMLElement;
      const name = nameEl?.textContent?.trim() || '';

      if (!name || name.length < 2) return;

      const locationEl = card.querySelector('[class*="_coLocation_"]') as HTMLElement;
      const location = locationEl?.textContent?.trim() || '';

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

      const industries: string[] = [];
      const pillEls = card.querySelectorAll('[class*="_pill_"]');
      pillEls.forEach(pill => {
        const text = pill.textContent?.trim();
        if (text && text.length > 1 && text.length < 50 && !text.match(/^[WS]\d{2}$/)) {
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
  const batches: string[] = [];
  const currentYear = new Date().getFullYear();

  for (let year = currentYear; year >= 2005; year--) {
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

  while (scrollAttempts < 50) {
    scrollAttempts++;

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
        break;
      }
    } else {
      noNewCompaniesCount = 0;
    }

    previousCount = currentCount;

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

    await delay(1000);

    if (TEST_MODE && allCompanies.size >= 10) {
      console.log('  [TEST MODE] Stopping after 10 companies');
      break;
    }
  }

  console.log(`\nTotal companies found across all batches: ${allCompanies.size}`);
  return Array.from(allCompanies.values());
}

async function scrapeCompanyPage(page: Page, company: { slug: string; name: string; location: string; oneLiner: string; industries: string[]; profileUrl: string }): Promise<Company | null> {
  try {
    await page.goto(company.profileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(1500);

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

      const batchMatch = pageText.match(/Batch:?\s*(Winter|Summer|Spring|Fall)\s*(\d{4})/i);
      if (batchMatch) {
        const season = batchMatch[1].toLowerCase();
        const year = batchMatch[2].slice(-2);
        const seasonCode = season.startsWith('s') ? 'S' : 'W';
        result.batch = `${seasonCode}${year}`;
      }

      if (!result.batch) {
        const shortBatchMatch = pageText.match(/\b([WS]\d{2})\b/);
        if (shortBatchMatch) {
          result.batch = shortBatchMatch[1];
        }
      }

      const statusMatch = pageText.match(/Status:?\s*(Active|Acquired|Public|Inactive|Exited)/i);
      if (statusMatch) {
        result.status = statusMatch[1];
      }

      const teamSizeMatch = pageText.match(/Team Size:?\s*(\d[\d,]*)/i);
      if (teamSizeMatch) {
        result.teamSize = teamSizeMatch[1].replace(/,/g, '');
      }

      const locationMatch = pageText.match(/Location:?\s*([A-Za-z\s,]+?)(?:\n|Founders)/i);
      if (locationMatch) {
        result.location = locationMatch[1].trim();
      }

      const descMatch = pageText.match(/(?:http[s]?:\/\/[^\s]+)\s*\n([^]+?)(?:\nLatest News|\nJobs at|\nFounded:|\nActive Founders)/i);
      if (descMatch) {
        const desc = descMatch[1].trim();
        if (desc.length > 50 && !desc.startsWith('Founded:')) {
          result.longDescription = desc;
        }
      }

      const websiteMatch = pageText.match(/(?:News|Company|Jobs)\s*(?:\d+)?\s*(?:News)?\s*(https?:\/\/(?!www\.ycombinator\.com)[^\s]+)/i);
      if (websiteMatch) {
        result.website = websiteMatch[1];
      }

      const foundersMatch = pageText.match(/(?:Active\s+)?Founders\s*\n([\s\S]*?)(?:\nFooter|\nY Combinator|$)/i);
      if (foundersMatch) {
        const foundersSection = foundersMatch[1];
        const lines = foundersSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const nameMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
          if (nameMatch) {
            const name = nameMatch[1];

            if (name.toLowerCase().includes('footer') ||
                name.toLowerCase().includes('combinator') ||
                name.toLowerCase().includes('latest') ||
                name.toLowerCase().includes('news') ||
                name.toLowerCase().includes('jobs')) {
              continue;
            }

            let title = 'Founder';
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              if (nextLine.match(/^(Co-?)?Founder|^CEO|^CTO|^COO/i)) {
                title = nextLine;
                i++;
              }
            }

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

      const linkedInLinks = document.querySelectorAll('a[href*="linkedin.com/in"]');
      const linkedInUrls: string[] = [];
      linkedInLinks.forEach(link => {
        const href = (link as HTMLAnchorElement).href;
        if (!linkedInUrls.includes(href)) {
          linkedInUrls.push(href);
        }
      });

      result.founders.forEach((founder, i) => {
        if (i < linkedInUrls.length) {
          founder.linkedIn = linkedInUrls[i];
        }
      });

      const companyLinkedIn = document.querySelector('a[href*="linkedin.com/company"]');
      if (companyLinkedIn) {
        result.linkedIn = (companyLinkedIn as HTMLAnchorElement).href;
      }

      const twitterLink = document.querySelector('a[href*="twitter.com"]:not([href*="/intent/"]), a[href*="x.com"]:not([href*="/intent/"])');
      if (twitterLink) {
        result.twitter = (twitterLink as HTMLAnchorElement).href;
      }

      const logo = document.querySelector('img[src*="bookface-images"], img[src*="logo"]') as HTMLImageElement;
      if (logo) {
        result.logoUrl = logo.src;
      }

      return result;
    });

    return {
      name: company.name,
      slug: company.slug,
      profileUrl: company.profileUrl,
      logoUrl: details.logoUrl,
      batch: details.batch,
      status: details.status,
      oneLiner: company.oneLiner,
      longDescription: details.longDescription,
      industries: company.industries,
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

async function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log('='.repeat(60));
  console.log('Y Combinator Founder Scraper');
  console.log(TEST_MODE ? '[TEST MODE - 10 companies only]' : '[FULL SCRAPE]');
  console.log('='.repeat(60));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

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

  let recordsWritten = 0;
  let errorCount = 0;

  try {
    const companiesFromList = await scrollAndCollectCompanies(page);
    console.log(`\nFound ${companiesFromList.length} companies in directory`);

    const processedSet = new Set(progress.processedSlugs);
    let toProcess = companiesFromList.filter(c => !processedSet.has(c.slug));

    if (TEST_MODE) {
      toProcess = toProcess.slice(0, 10);
    }

    console.log(`${toProcess.length} companies to process (${processedSet.size} already done)`);

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
        progress.processedSlugs.push(company.slug);
        errorCount++;
        console.log(`  Failed to scrape`);
      }

      progress.companiesScraped = progress.companies.length;

      if (processed % 10 === 0) {
        saveProgress(progress);
        console.log(`\n  [Progress saved: ${progress.companies.length} total companies]`);
      }

      await delay(DELAY_BETWEEN_PROFILES);
    }

    saveProgress(progress);

    // Convert to JSONL and write
    console.log('\nWriting leads.jsonl...');
    const records: string[] = [];

    for (const company of progress.companies) {
      for (const founder of company.founders) {
        const record = convertToLeadRecord(company, founder);
        records.push(JSON.stringify(record));
        recordsWritten++;
      }
    }

    fs.writeFileSync(LEADS_FILE, records.join('\n') + '\n');

    const endTime = new Date().toISOString();
    const runJson = {
      source_id: SOURCE_ID,
      run_id: runId,
      started_at: startTime,
      ended_at: endTime,
      records_found: progress.companies.reduce((sum, c) => sum + c.founders.length, 0),
      records_valid: recordsWritten,
      records_written: recordsWritten,
      error_count: errorCount,
    };
    fs.writeFileSync(RUN_FILE, JSON.stringify(runJson, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Scraping complete!');
    console.log(`Total companies scraped: ${progress.companies.length}`);
    console.log(`Total founders written: ${recordsWritten}`);
    console.log(`Failed URLs: ${progress.failedUrls.length}`);
    console.log(`Output: ${LEADS_FILE}`);
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error('Fatal error:', error);
    errorCount++;
    saveProgress(progress);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
