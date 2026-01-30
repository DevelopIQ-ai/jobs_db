/**
 * Capboard.io Investor Directory Scraper
 *
 * Scrapes all investor data from https://www.capboard.io/en/investors
 * Extracts: investor name, LinkedIn, website, check size, investment stages,
 * operating countries, description, address, and more.
 *
 * Usage:
 *   npx tsx capboard-scraper.ts
 *
 * Output:
 *   output/capboard-investors.json
 *   output/capboard-investors.csv
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface Investor {
  // Basic Info
  name: string;
  slug: string;
  profileUrl: string;
  logoUrl: string | null;

  // Description
  description: string | null;

  // Investment Details
  checkSizeMin: string | null;
  checkSizeMax: string | null;
  checkSizeRaw: string | null;
  investmentStages: string[];
  interests: string[];
  firmType: string | null;

  // Location & Contact
  operatingCountries: string[];
  address: string | null;
  website: string | null;
  linkedIn: string | null;
  twitter: string | null;
  email: string | null;

  // Metadata
  scrapedAt: string;
}

interface InvestorListItem {
  name: string;
  slug: string;
  profileUrl: string;
  checkSizeRaw: string | null;
  investmentStages: string[];
  operatingCountriesPreview: string;
  description: string | null;
}

interface Progress {
  currentPage: number;
  investorsScraped: number;
  investors: Investor[];
  failedUrls: string[];
  processedSlugs: string[];
}

const BASE_URL = 'https://www.capboard.io';
const INVESTORS_URL = `${BASE_URL}/en/investors`;
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'capboard-investors.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'capboard-investors.csv');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

// Rate limiting config - be respectful
const DELAY_BETWEEN_PAGES = 2000; // 2 seconds between list pages
const DELAY_BETWEEN_PROFILES = 2500; // 2.5 seconds between profile page visits
const MAX_PAGES = 100; // Safety limit

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    currentPage: 0,
    investorsScraped: 0,
    investors: [],
    failedUrls: [],
    processedSlugs: []
  };
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function extractInvestorsFromListPage(page: Page): Promise<InvestorListItem[]> {
  return await page.evaluate(() => {
    const investors: InvestorListItem[] = [];

    // Find all investor cards - they're links to /en/investor/[slug]
    const investorLinks = document.querySelectorAll('a[href*="/en/investor/"]');

    investorLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      const slugMatch = href.match(/\/en\/investor\/([^/?]+)/);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      const card = link.closest('div') || link;

      // Extract name - usually in a heading or strong element
      const nameEl = card.querySelector('h2, h3, h4, strong, [class*="name"], [class*="title"]');
      let name = nameEl?.textContent?.trim() || '';

      // Fallback: get text from the link itself if it's short enough
      if (!name || name.length > 100) {
        const linkText = link.textContent?.trim() || '';
        // Take first line or first 50 chars
        name = linkText.split('\n')[0].trim().substring(0, 100);
      }

      if (!name || name.length < 2) return;

      // Extract check size (e.g., "100K - 1M")
      const pageText = card.textContent || '';
      const checkSizeMatch = pageText.match(/(\d+[KMB]?)\s*-\s*(\d+[KMB]?)/i);
      const checkSizeRaw = checkSizeMatch ? checkSizeMatch[0] : null;

      // Extract investment stages
      const stages: string[] = [];
      const stageKeywords = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Pre-IPO', 'Growth', 'Idea'];
      stageKeywords.forEach(stage => {
        if (pageText.includes(stage)) {
          stages.push(stage);
        }
      });

      // Extract operating countries preview
      const countriesMatch = pageText.match(/([A-Z]{2}(?:,\s*[A-Z]{2})*(?:\s+and\s+\d+\s+more)?)/);
      const operatingCountriesPreview = countriesMatch ? countriesMatch[0] : '';

      // Extract description - look for longer text content
      let description: string | null = null;
      const paragraphs = card.querySelectorAll('p, [class*="description"], [class*="desc"]');
      paragraphs.forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 30 && text.length < 500 && !description) {
          description = text;
        }
      });

      investors.push({
        name,
        slug,
        profileUrl: `https://www.capboard.io${href}`,
        checkSizeRaw,
        investmentStages: stages,
        operatingCountriesPreview,
        description
      });
    });

    // Deduplicate by slug
    const seen = new Set<string>();
    return investors.filter(inv => {
      if (seen.has(inv.slug)) return false;
      seen.add(inv.slug);
      return true;
    });
  });
}

async function scrapeInvestorProfile(page: Page, listItem: InvestorListItem): Promise<Investor | null> {
  try {
    await page.goto(listItem.profileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(1500);

    const details = await page.evaluate(() => {
      const result = {
        name: '',
        logoUrl: null as string | null,
        description: null as string | null,
        checkSizeMin: null as string | null,
        checkSizeMax: null as string | null,
        checkSizeRaw: null as string | null,
        investmentStages: [] as string[],
        interests: [] as string[],
        firmType: null as string | null,
        operatingCountries: [] as string[],
        address: null as string | null,
        website: null as string | null,
        linkedIn: null as string | null,
        twitter: null as string | null,
        email: null as string | null
      };

      const pageText = document.body.innerText || '';

      // Extract name from h1 or prominent heading
      const h1 = document.querySelector('h1');
      if (h1) {
        result.name = h1.textContent?.trim() || '';
      }

      // Extract logo - skip data: URLs
      const logo = document.querySelector('img[src*="logo"], img[alt*="logo"], header img, [class*="logo"] img') as HTMLImageElement;
      if (logo && logo.src && !logo.src.startsWith('data:')) {
        result.logoUrl = logo.src;
      }

      // Extract description - look for main paragraph content
      // Skip cookie consent, privacy policy, and other boilerplate text
      const skipPhrases = ['cookie', 'personalization', 'advertising', 'Privacy', 'Terms',
        'Home', 'consent', 'GDPR', 'collected by this provider'];
      const descCandidates = document.querySelectorAll('p, [class*="description"], [class*="about"]');
      descCandidates.forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 50 && text.length < 1000 && !result.description) {
          const hasSkipPhrase = skipPhrases.some(phrase => text.toLowerCase().includes(phrase.toLowerCase()));
          if (!hasSkipPhrase) {
            result.description = text;
          }
        }
      });

      // Extract check size - require K, M, or B suffix to avoid matching postal codes
      const checkSizeMatch = pageText.match(/(\d+[KMB])\s*-\s*(\d+[KMB])/i);
      if (checkSizeMatch) {
        result.checkSizeRaw = checkSizeMatch[0];
        result.checkSizeMin = checkSizeMatch[1];
        result.checkSizeMax = checkSizeMatch[2];
      }

      // Extract investment stages
      const stageKeywords = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Pre-IPO', 'Growth', 'Idea'];
      stageKeywords.forEach(stage => {
        if (pageText.includes(stage)) {
          result.investmentStages.push(stage);
        }
      });

      // Extract interests/sectors
      const interestKeywords = ['SaaS', 'B2B', 'B2C', 'AI', 'FinTech', 'HealthTech', 'EdTech', 'DeepTech',
        'web3', 'Crypto', 'Blockchain', 'IoT', 'Hardware', 'Enterprise', 'Consumer', 'Marketplace',
        'E-commerce', 'Gaming', 'AR', 'VR', 'XR', 'Robotics', 'Climate', 'CleanTech', 'BioTech',
        'FoodTech', 'PropTech', 'InsurTech', 'LegalTech', 'AgriTech', 'Mobility', 'Logistics',
        'Software', 'Machine Learning', 'Data', 'Cybersecurity', 'Security', 'Media', 'Entertainment'];
      interestKeywords.forEach(interest => {
        const regex = new RegExp(`\\b${interest}\\b`, 'i');
        if (regex.test(pageText) && !result.interests.includes(interest)) {
          result.interests.push(interest);
        }
      });

      // Extract firm type
      const firmTypes = ['VC', 'Venture Capital', 'Angel', 'Family Office', 'Corporate VC', 'CVC',
        'Private Equity', 'PE', 'Accelerator', 'Incubator', 'Fund of Funds'];
      firmTypes.forEach(type => {
        if (pageText.includes(type) && !result.firmType) {
          result.firmType = type;
        }
      });

      // Extract operating countries from text
      // Look for country codes or full country names
      const countryMatch = pageText.match(/(?:operates?\s+in|countries?:?\s*)([A-Z]{2}(?:,\s*[A-Z]{2})*)/i);
      if (countryMatch) {
        result.operatingCountries = countryMatch[1].split(/,\s*/).filter(c => c.length === 2);
      }

      // Also look for full country names in a list format
      const countryNames = ['Germany', 'Austria', 'Czech Republic', 'Denmark', 'Estonia', 'Finland',
        'France', 'Hungary', 'Lithuania', 'Latvia', 'Norway', 'Poland', 'Sweden', 'Spain', 'Italy',
        'Netherlands', 'Belgium', 'Portugal', 'Ireland', 'UK', 'United Kingdom', 'United States',
        'USA', 'Canada', 'Israel', 'Singapore', 'India', 'Brazil', 'Mexico', 'Japan', 'South Korea',
        'Australia', 'Switzerland', 'Luxembourg'];
      countryNames.forEach(country => {
        if (pageText.includes(country) && !result.operatingCountries.includes(country)) {
          result.operatingCountries.push(country);
        }
      });

      // Extract address - look for structured address format
      const addressMatch = pageText.match(/([A-Za-z\s]+,\s*(?:entr\.|floor|suite|#)?\s*[\d\w\s]+,\s*[A-Za-z\s]+,\s*[A-Za-z\s]+\s*[\d-]+,\s*[A-Z]{2})/i);
      if (addressMatch) {
        result.address = addressMatch[1].trim();
      }

      // Extract website - exclude common non-investor links
      const excludeDomains = ['linkedin', 'twitter', 'facebook', 'capboard', 'cookiebot', 'x.com', 'instagram', 'youtube'];
      const websiteLinks = document.querySelectorAll('a[href^="http"]') as NodeListOf<HTMLAnchorElement>;
      for (const link of websiteLinks) {
        const href = link.href;
        const isExcluded = excludeDomains.some(domain => href.includes(domain));
        if (!isExcluded && !result.website) {
          result.website = href;
          break;
        }
      }

      // Extract LinkedIn - company page
      const linkedInLink = document.querySelector('a[href*="linkedin.com/company"]') as HTMLAnchorElement;
      if (linkedInLink) {
        result.linkedIn = linkedInLink.href;
      }

      // Extract Twitter/X - exclude capboard's own twitter
      const twitterLinks = document.querySelectorAll('a[href*="twitter.com"], a[href*="x.com"]') as NodeListOf<HTMLAnchorElement>;
      for (const link of twitterLinks) {
        if (!link.href.includes('capboardio') && !link.href.includes('capboard')) {
          result.twitter = link.href;
          break;
        }
      }

      // Extract email
      const emailMatch = pageText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        result.email = emailMatch[1];
      }

      return result;
    });

    return {
      name: details.name || listItem.name,
      slug: listItem.slug,
      profileUrl: listItem.profileUrl,
      logoUrl: details.logoUrl,
      description: details.description || listItem.description,
      checkSizeMin: details.checkSizeMin,
      checkSizeMax: details.checkSizeMax,
      checkSizeRaw: details.checkSizeRaw || listItem.checkSizeRaw,
      investmentStages: details.investmentStages.length > 0 ? details.investmentStages : listItem.investmentStages,
      interests: details.interests,
      firmType: details.firmType,
      operatingCountries: details.operatingCountries,
      address: details.address,
      website: details.website,
      linkedIn: details.linkedIn,
      twitter: details.twitter,
      email: details.email,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`  Error scraping ${listItem.profileUrl}: ${error}`);
    return null;
  }
}

function convertToCSV(investors: Investor[]): string {
  const headers = [
    'Investor Name',
    'Check Size',
    'Check Size Min',
    'Check Size Max',
    'Investment Stages',
    'Interests',
    'Firm Type',
    'Operating Countries',
    'Address',
    'Website',
    'LinkedIn',
    'Twitter',
    'Email',
    'Description',
    'Profile URL'
  ];

  const escapeCSV = (str: string | null): string => {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = investors.map(inv => [
    escapeCSV(inv.name),
    escapeCSV(inv.checkSizeRaw),
    escapeCSV(inv.checkSizeMin),
    escapeCSV(inv.checkSizeMax),
    escapeCSV(inv.investmentStages.join('; ')),
    escapeCSV(inv.interests.join('; ')),
    escapeCSV(inv.firmType),
    escapeCSV(inv.operatingCountries.join('; ')),
    escapeCSV(inv.address),
    escapeCSV(inv.website),
    escapeCSV(inv.linkedIn),
    escapeCSV(inv.twitter),
    escapeCSV(inv.email),
    escapeCSV(inv.description),
    escapeCSV(inv.profileUrl)
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

async function createBrowser() {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  return { browser, context, page };
}

const BROWSER_RESTART_INTERVAL = 100; // Restart browser every 100 investors

async function main() {
  console.log('='.repeat(60));
  console.log('Capboard.io Investor Directory Scraper');
  console.log('='.repeat(60));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load progress
  let progress = loadProgress();
  console.log(`\nLoaded progress: ${progress.investors.length} investors previously scraped`);
  console.log(`Starting from page ${progress.currentPage}`);

  let { browser, context, page } = await createBrowser();
  const processedSet = new Set(progress.processedSlugs);

  try {
    // Step 1: Collect all investor slugs from list pages
    console.log('\nPhase 1: Collecting investor URLs from list pages...');
    const allInvestorItems: InvestorListItem[] = [];

    for (let pageNum = progress.currentPage; pageNum < MAX_PAGES; pageNum++) {
      const url = `${INVESTORS_URL}?page=${pageNum}`;
      console.log(`\nLoading page ${pageNum}...`);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await delay(DELAY_BETWEEN_PAGES);

      // Check if page has content
      const hasContent = await page.evaluate(() => {
        return !document.body.innerText.includes('No investors found');
      });

      if (!hasContent) {
        console.log(`  Page ${pageNum} is empty. Finished collecting.`);
        break;
      }

      const investorsOnPage = await extractInvestorsFromListPage(page);
      console.log(`  Found ${investorsOnPage.length} investors on page ${pageNum}`);

      // Filter out already processed
      const newInvestors = investorsOnPage.filter(inv => !processedSet.has(inv.slug));
      allInvestorItems.push(...newInvestors);

      progress.currentPage = pageNum + 1;
      saveProgress(progress);
    }

    console.log(`\nTotal investors to scrape: ${allInvestorItems.length}`);

    // Step 2: Scrape each investor profile
    console.log('\nPhase 2: Scraping investor profile pages...');
    let processed = 0;
    let consecutiveErrors = 0;

    for (const listItem of allInvestorItems) {
      processed++;
      console.log(`\n[${processed}/${allInvestorItems.length}] Scraping: ${listItem.name}`);

      // Restart browser periodically to avoid memory issues
      if (processed % BROWSER_RESTART_INTERVAL === 0) {
        console.log('\n  [Restarting browser to avoid memory issues...]');
        try {
          await browser.close();
        } catch (e) {
          // Browser may already be closed
        }
        ({ browser, context, page } = await createBrowser());
        consecutiveErrors = 0;
      }

      let investor: Investor | null = null;
      try {
        investor = await scrapeInvestorProfile(page, listItem);
      } catch (error) {
        console.error(`  Error: ${error}`);
        consecutiveErrors++;

        // If too many consecutive errors, restart browser
        if (consecutiveErrors >= 3) {
          console.log('\n  [Too many errors, restarting browser...]');
          try {
            await browser.close();
          } catch (e) {
            // Browser may already be closed
          }
          ({ browser, context, page } = await createBrowser());
          consecutiveErrors = 0;
          await delay(5000); // Extra delay after restart
        }
      }

      if (investor) {
        progress.investors.push(investor);
        progress.processedSlugs.push(listItem.slug);
        processedSet.add(listItem.slug);
        consecutiveErrors = 0;

        console.log(`  Check Size: ${investor.checkSizeRaw || 'N/A'}`);
        console.log(`  Stages: ${investor.investmentStages.join(', ') || 'N/A'}`);
        console.log(`  LinkedIn: ${investor.linkedIn ? 'Yes' : 'No'}`);
      } else {
        // Don't add to processedSlugs on failure - allow retry on next run
        if (!progress.failedUrls.includes(listItem.profileUrl)) {
          progress.failedUrls.push(listItem.profileUrl);
        }
        console.log(`  Failed to scrape`);
      }

      progress.investorsScraped = progress.investors.length;

      // Save progress every 10 investors
      if (processed % 10 === 0) {
        saveProgress(progress);
        console.log(`\n  [Progress saved: ${progress.investors.length} total investors]`);
      }

      // Rate limiting
      await delay(DELAY_BETWEEN_PROFILES);
    }

    // Final save
    saveProgress(progress);

    // Sort investors by name
    progress.investors.sort((a, b) => a.name.localeCompare(b.name));

    // Write final JSON output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalInvestors: progress.investors.length,
      failedUrls: progress.failedUrls,
      investors: progress.investors
    }, null, 2));

    // Write CSV output
    fs.writeFileSync(CSV_FILE, convertToCSV(progress.investors));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Scraping complete!');
    console.log(`Total investors scraped: ${progress.investors.length}`);
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
    try {
      await browser.close();
    } catch (e) {
      // Browser may already be closed
    }
  }
}

// Run the scraper
main().catch(console.error);
