/**
 * Skadden Law Firm Professionals Directory Scraper
 *
 * Scrapes all lawyer profiles from https://www.skadden.com/professionals
 * Extracts comprehensive profile data including contact info, practice areas,
 * education, bar admissions, and biography.
 *
 * Usage:
 *   npx tsx skadden-scraper.ts          # Full scrape
 *   npx tsx skadden-scraper.ts --test   # Test mode (3 profiles only)
 *
 * Output:
 *   output/leads.jsonl    - One JSON record per line (ScrappyPuffle format)
 *   output/run.json       - Run metadata
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface RawProfile {
  name: string;
  profileUrl: string;
  photoUrl: string | null;
  title: string;
  position: string;
  offices: string[];
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  practiceAreas: string[];
  industries: string[];
  education: {
    degree: string;
    school: string;
    year: string | null;
    honors: string | null;
  }[];
  barAdmissions: string[];
  courtAdmissions: string[];
  affiliations: string[];
  languages: string[];
  clerkships: string[];
  biography: string | null;
  rankings: string[];
  scrapedAt: string;
}

interface LawyerListItem {
  name: string;
  profileUrl: string;
  position: string;
  office: string;
  email: string | null;
  phone: string | null;
}

// ScrappyPuffle data contract types
interface LeadRecord {
  core: {
    source_id: string;
    entity_type: "person" | "company";
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  person: {
    full_name: string;
    title?: string;
    company_name: string;
    profile_url: string;
  };
  contact: {
    email?: string;
    phone?: string;
    website?: string;
    location?: {
      city?: string;
      country?: string;
    };
  };
  context: Record<string, unknown>;
}

interface RunJson {
  source_id: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  records_found: number;
  records_valid: number;
  records_written: number;
  error_count: number;
}

// ============================================================================
// Constants
// ============================================================================

const SOURCE_ID = "law/skadden";
const BASE_URL = 'https://www.skadden.com';
const PROFESSIONALS_URL = `${BASE_URL}/professionals`;
const OUTPUT_DIR = path.join(__dirname, 'output');
const LEADS_FILE = path.join(OUTPUT_DIR, 'leads.jsonl');
const RUN_FILE = path.join(OUTPUT_DIR, 'run.json');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

// Check for test mode
const TEST_MODE = process.argv.includes('--test');
const TEST_LIMIT = 3;

// Rate limiting config
const DELAY_BETWEEN_PROFILES = 1000; // 1 second between profile requests
const DELAY_BETWEEN_LETTERS = 2000; // 2 seconds between letter pages

// Known international offices for location mapping
const INTERNATIONAL_OFFICES: Record<string, string> = {
  "London": "UK",
  "Paris": "France",
  "Frankfurt": "Germany",
  "Munich": "Germany",
  "Brussels": "Belgium",
  "Tokyo": "Japan",
  "Hong Kong": "China",
  "Singapore": "Singapore",
  "Beijing": "China",
  "Shanghai": "China",
  "Seoul": "South Korea",
  "São Paulo": "Brazil",
  "Toronto": "Canada",
};

// ============================================================================
// Utility Functions
// ============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractPrimaryKey(profileUrl: string): string {
  const match = profileUrl.match(/\/professionals\/(.+)$/);
  const urlPath = match ? match[1] : profileUrl;
  return `${SOURCE_ID}:url:${urlPath}`;
}

function parseLocation(offices: string[]): { city?: string; country?: string } | undefined {
  if (offices.length === 0) return undefined;
  const office = offices[0];
  if (INTERNATIONAL_OFFICES[office]) {
    return { city: office, country: INTERNATIONAL_OFFICES[office] };
  }
  return { city: office, country: "USA" };
}

function cleanTitle(title: string): string | undefined {
  if (!title || title === "Home" || title.length < 3) return undefined;
  return title;
}

function convertToLeadRecord(profile: RawProfile): LeadRecord {
  const location = parseLocation(profile.offices);

  return {
    core: {
      source_id: SOURCE_ID,
      entity_type: "person",
      scraped_at: profile.scrapedAt,
      raw_url: profile.profileUrl,
      primary_key: extractPrimaryKey(profile.profileUrl),
    },
    person: {
      full_name: profile.name,
      title: cleanTitle(profile.title),
      company_name: "Skadden, Arps, Slate, Meagher & Flom LLP",
      profile_url: profile.profileUrl,
    },
    contact: {
      email: profile.email || undefined,
      phone: profile.phone || undefined,
      website: "https://www.skadden.com",
      location,
    },
    context: {
      photo_url: profile.photoUrl,
      offices: profile.offices,
      practice_areas: profile.practiceAreas,
      industries: profile.industries,
      education: profile.education,
      bar_admissions: profile.barAdmissions,
      court_admissions: profile.courtAdmissions,
      affiliations: profile.affiliations,
      languages: profile.languages,
      clerkships: profile.clerkships,
      biography: profile.biography,
      rankings: profile.rankings,
      secondary_phone: profile.secondaryPhone,
    },
  };
}

async function dismissCookieDialog(page: Page): Promise<void> {
  try {
    // Try multiple methods to dismiss the cookie dialog
    const selectors = [
      'button:has-text("Accept All Cookies")',
      '#onetrust-accept-btn-handler',
      '.onetrust-close-btn-handler',
      'button:has-text("Accept")'
    ];

    for (const selector of selectors) {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        await button.click({ force: true });
        await delay(500);
        return;
      }
    }

    // Force remove the overlay if buttons don't work
    await page.evaluate(() => {
      const overlay = document.querySelector('#onetrust-consent-sdk');
      if (overlay) overlay.remove();
    });
  } catch {
    // Cookie dialog not present or already dismissed
  }
}

async function collectLawyersForLetter(page: Page, letter: string): Promise<LawyerListItem[]> {
  const seenUrls = new Set<string>();
  const lawyers: LawyerListItem[] = [];
  let skip = 0;
  const pageSize = 5;
  let consecutiveEmpty = 0;

  console.log(`\n--- Collecting lawyers for letter: ${letter} ---`);

  while (consecutiveEmpty < 3) { // Try a few more pages before giving up
    const url = `${PROFESSIONALS_URL}?skip=${skip}&letter=${letter.toLowerCase()}&hassearched=true`;
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await dismissCookieDialog(page);
    await delay(1000);

    // Wait for results
    try {
      await page.waitForSelector(`a[href*="/professionals/${letter.toLowerCase()}/"]`, { timeout: 10000 });
    } catch {
      consecutiveEmpty++;
      skip += pageSize;
      continue;
    }

    // Get ALL links on the page matching the pattern
    const profileLinks = await page.locator(`a[href*="/professionals/${letter.toLowerCase()}/"]`).all();
    let newLinksFound = 0;

    for (const link of profileLinks) {
      try {
        const href = await link.getAttribute('href');
        if (!href || !href.match(/\/professionals\/[a-z]\/[\w-]+$/)) continue;
        if (seenUrls.has(href)) continue;

        // Get just the name (first non-empty line of text content)
        const fullText = await link.textContent() || '';
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const name = lines[0] || '';

        // Validate name
        if (name.length < 3) continue;
        if (['Home', 'Professionals', 'Skip to main content'].includes(name)) continue;

        seenUrls.add(href);
        lawyers.push({
          name: name,
          profileUrl: `${BASE_URL}${href}`,
          position: '',
          office: '',
          email: null,
          phone: null
        });
        newLinksFound++;
      } catch {
        // Skip problematic links
      }
    }

    console.log(`  Skip ${skip}: found ${newLinksFound} new (total: ${lawyers.length})`);

    if (newLinksFound === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
    }

    skip += pageSize;
    await delay(300);

    // Safety limit
    if (skip > 2000) break;
  }

  console.log(`  Total for letter ${letter}: ${lawyers.length} lawyers`);
  return lawyers;
}

async function scrapeProfilePage(page: Page, profileUrl: string): Promise<RawProfile | null> {
  try {
    await page.goto(profileUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await dismissCookieDialog(page);
    await delay(500);

    const profile: RawProfile = {
      name: '',
      profileUrl,
      photoUrl: null,
      title: '',
      position: '',
      offices: [],
      email: null,
      phone: null,
      secondaryPhone: null,
      practiceAreas: [],
      industries: [],
      education: [],
      barAdmissions: [],
      courtAdmissions: [],
      affiliations: [],
      languages: [],
      clerkships: [],
      biography: null,
      rankings: [],
      scrapedAt: new Date().toISOString()
    };

    // Name - from h1 or main heading
    const nameEl = page.locator('h1').first();
    profile.name = (await nameEl.textContent())?.trim() || '';

    // Photo URL
    const photoImg = page.locator('img[src*="professionals"], img[class*="profile"], img[alt*="professional"]').first();
    const photoSrc = await photoImg.getAttribute('src').catch(() => null);
    if (photoSrc) {
      profile.photoUrl = photoSrc.startsWith('http') ? photoSrc : `${BASE_URL}${photoSrc}`;
    }

    // Title/Position - usually in a subtitle or under the name
    const titleEl = page.locator('[class*="subtitle"], [class*="position"], [class*="title"]').first();
    profile.title = (await titleEl.textContent())?.trim() || '';
    profile.position = profile.title;

    // Email
    const emailLink = page.locator('a[href^="mailto:"]').first();
    const emailHref = await emailLink.getAttribute('href').catch(() => null);
    if (emailHref) {
      profile.email = emailHref.replace('mailto:', '');
    }

    // Phone numbers
    const phoneLinks = await page.locator('a[href^="tel:"]').all();
    for (let i = 0; i < phoneLinks.length; i++) {
      const phoneHref = await phoneLinks[i].getAttribute('href');
      if (phoneHref) {
        const phoneNumber = phoneHref.replace('tel:', '').replace(/^\+/, '');
        if (i === 0) {
          profile.phone = phoneNumber;
        } else if (i === 1) {
          profile.secondaryPhone = phoneNumber;
        }
      }
    }

    // Offices
    const officeLinks = await page.locator('a[href*="/locations/"]').all();
    for (const link of officeLinks) {
      const officeName = await link.textContent();
      if (officeName && !profile.offices.includes(officeName.trim())) {
        profile.offices.push(officeName.trim());
      }
    }

    // Practice Areas - look for sections or lists
    const practiceSection = page.locator('text=Practice Areas').locator('..').locator('ul, div').first();
    if (await practiceSection.isVisible().catch(() => false)) {
      const practiceItems = await practiceSection.locator('li, a').all();
      for (const item of practiceItems) {
        const text = await item.textContent();
        if (text && text.trim()) {
          profile.practiceAreas.push(text.trim());
        }
      }
    }

    // Alternative: Extract practice areas from links
    if (profile.practiceAreas.length === 0) {
      const practiceLinks = await page.locator('a[href*="/practices/"]').all();
      for (const link of practiceLinks) {
        const text = await link.textContent();
        if (text && !profile.practiceAreas.includes(text.trim())) {
          profile.practiceAreas.push(text.trim());
        }
      }
    }

    // Education - look for education section
    const pageContent = await page.content();
    const educationMatch = pageContent.match(/Education[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (educationMatch) {
      const eduHtml = educationMatch[1];
      const eduItems = eduHtml.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/li>/gi) || [];
      for (const item of eduItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          // Parse education entry: "J.D., Harvard Law School, 2000 (cum laude)"
          const eduMatch = text.match(/^([^,]+),\s*([^,]+)(?:,\s*(\d{4}))?\s*(?:\(([^)]+)\))?/);
          if (eduMatch) {
            profile.education.push({
              degree: eduMatch[1].trim(),
              school: eduMatch[2].trim(),
              year: eduMatch[3] || null,
              honors: eduMatch[4] || null
            });
          } else {
            profile.education.push({
              degree: text,
              school: '',
              year: null,
              honors: null
            });
          }
        }
      }
    }

    // Bar Admissions
    const barMatch = pageContent.match(/Bar Admissions?[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (barMatch) {
      const barHtml = barMatch[1];
      const barItems = barHtml.match(/<li[^>]*>([^<]+)<\/li>/gi) || [];
      for (const item of barItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          profile.barAdmissions.push(text);
        }
      }
    }

    // Court Admissions
    const courtMatch = pageContent.match(/Court Admissions?[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (courtMatch) {
      const courtHtml = courtMatch[1];
      const courtItems = courtHtml.match(/<li[^>]*>([^<]+)<\/li>/gi) || [];
      for (const item of courtItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          profile.courtAdmissions.push(text);
        }
      }
    }

    // Professional Affiliations
    const affiliationMatch = pageContent.match(/(?:Professional\s+)?Affiliations?[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (affiliationMatch) {
      const affHtml = affiliationMatch[1];
      const affItems = affHtml.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/li>/gi) || [];
      for (const item of affItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          profile.affiliations.push(text);
        }
      }
    }

    // Languages
    const langMatch = pageContent.match(/Languages?[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (langMatch) {
      const langHtml = langMatch[1];
      const langItems = langHtml.match(/<li[^>]*>([^<]+)<\/li>/gi) || [];
      for (const item of langItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          profile.languages.push(text);
        }
      }
    }

    // Clerkships
    const clerkMatch = pageContent.match(/Clerkships?[^<]*<[^>]*>([^]*?)<\/(?:ul|div|section)/i);
    if (clerkMatch) {
      const clerkHtml = clerkMatch[1];
      const clerkItems = clerkHtml.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/li>/gi) || [];
      for (const item of clerkItems) {
        const text = item.replace(/<[^>]+>/g, '').trim();
        if (text) {
          profile.clerkships.push(text);
        }
      }
    }

    // Biography - get main content paragraph
    const bioSection = page.locator('[class*="biography"], [class*="bio"], [class*="overview"], article p').first();
    if (await bioSection.isVisible().catch(() => false)) {
      profile.biography = (await bioSection.textContent())?.trim() || null;
    }

    // If bio not found, try to get the first substantial paragraph
    if (!profile.biography) {
      const paragraphs = await page.locator('main p, article p').all();
      for (const p of paragraphs) {
        const text = await p.textContent();
        if (text && text.length > 100) {
          profile.biography = text.trim();
          break;
        }
      }
    }

    return profile;
  } catch (error) {
    console.error(`  Error scraping ${profileUrl}: ${error}`);
    return null;
  }
}

interface Progress {
  completedLetters: string[];
  allLawyers: LawyerListItem[];
  scrapedProfiles: RawProfile[];
  failedUrls: string[];
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    completedLetters: [],
    allLawyers: [],
    scrapedProfiles: [],
    failedUrls: []
  };
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log('='.repeat(60));
  console.log('Skadden Professionals Directory Scraper');
  if (TEST_MODE) {
    console.log(`TEST MODE: Will scrape only ${TEST_LIMIT} profiles`);
  }
  console.log('='.repeat(60));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // In test mode, start fresh
  let progress: Progress;
  if (TEST_MODE) {
    progress = {
      completedLetters: [],
      allLawyers: [],
      scrapedProfiles: [],
      failedUrls: []
    };
    // Clear existing leads file in test mode
    if (fs.existsSync(LEADS_FILE)) {
      fs.unlinkSync(LEADS_FILE);
    }
  } else {
    progress = loadProgress();
    console.log(`\nLoaded progress: ${progress.completedLetters.length} letters done, ${progress.scrapedProfiles.length} profiles scraped`);
  }

  const browser: Browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page: Page = await context.newPage();

  let recordsWritten = 0;
  let errorCount = 0;

  try {
    // Step 1: Collect all lawyer URLs from A-Z
    const letters = TEST_MODE ? ['A'] : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    for (const letter of letters) {
      if (progress.completedLetters.includes(letter)) {
        console.log(`\nSkipping letter ${letter} (already completed)`);
        continue;
      }

      const lawyers = await collectLawyersForLetter(page, letter);
      progress.allLawyers.push(...lawyers);
      progress.completedLetters.push(letter);
      if (!TEST_MODE) saveProgress(progress);

      await delay(DELAY_BETWEEN_LETTERS);
    }

    // Deduplicate lawyers
    const uniqueLawyers = Array.from(
      new Map(progress.allLawyers.map(l => [l.profileUrl, l])).values()
    );
    progress.allLawyers = uniqueLawyers;
    if (!TEST_MODE) saveProgress(progress);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total unique lawyers found: ${uniqueLawyers.length}`);
    console.log(`${'='.repeat(60)}`);

    // Step 2: Scrape each profile page
    const alreadyScraped = new Set(progress.scrapedProfiles.map(p => p.profileUrl));
    let toScrape = uniqueLawyers.filter(l => !alreadyScraped.has(l.profileUrl));

    // Limit in test mode
    if (TEST_MODE) {
      toScrape = toScrape.slice(0, TEST_LIMIT);
    }

    console.log(`\nProfiles to scrape: ${toScrape.length}`);

    // Open leads file for appending
    const leadsStream = fs.createWriteStream(LEADS_FILE, { flags: 'a' });

    let scraped = 0;
    for (const lawyer of toScrape) {
      scraped++;
      console.log(`\n[${scraped}/${toScrape.length}] Scraping: ${lawyer.name}`);

      const profile = await scrapeProfilePage(page, lawyer.profileUrl);

      if (profile) {
        progress.scrapedProfiles.push(profile);

        // Convert to lead record and write to JSONL
        const leadRecord = convertToLeadRecord(profile);
        leadsStream.write(JSON.stringify(leadRecord) + '\n');
        recordsWritten++;

        console.log(`  Success: ${profile.name} - ${profile.offices.join(', ')}`);
      } else {
        progress.failedUrls.push(lawyer.profileUrl);
        errorCount++;
        console.log(`  Failed: ${lawyer.profileUrl}`);
      }

      // Save progress every 10 profiles (not in test mode)
      if (!TEST_MODE && scraped % 10 === 0) {
        saveProgress(progress);
        console.log(`\n  [Progress saved: ${progress.scrapedProfiles.length} profiles]`);
      }

      await delay(DELAY_BETWEEN_PROFILES);
    }

    leadsStream.end();

    // Final save
    if (!TEST_MODE) saveProgress(progress);

    // Write run.json
    const endTime = new Date().toISOString();
    const runJson: RunJson = {
      source_id: SOURCE_ID,
      run_id: runId,
      started_at: startTime,
      ended_at: endTime,
      records_found: progress.allLawyers.length,
      records_valid: recordsWritten,
      records_written: recordsWritten,
      error_count: errorCount + progress.failedUrls.length,
    };
    fs.writeFileSync(RUN_FILE, JSON.stringify(runJson, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Scraping complete!');
    console.log(`Total profiles scraped: ${recordsWritten}`);
    console.log(`Failed URLs: ${errorCount}`);
    console.log(`Output saved to: ${LEADS_FILE}`);
    console.log(`Run metadata saved to: ${RUN_FILE}`);
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error('Fatal error:', error);
    if (!TEST_MODE) saveProgress(progress);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the scraper
main().catch(console.error);
