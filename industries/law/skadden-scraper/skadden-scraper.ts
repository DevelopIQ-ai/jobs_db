/**
 * Skadden Law Firm Professionals Directory Scraper
 *
 * Scrapes all lawyer profiles from https://www.skadden.com/professionals
 * Extracts comprehensive profile data including contact info, practice areas,
 * education, bar admissions, and biography.
 *
 * Usage:
 *   npx tsx test-suite/scraper/skadden-scraper.ts
 *
 * Output:
 *   test-suite/scraper/output/skadden-lawyers.json
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface LawyerProfile {
  // Basic Info
  name: string;
  profileUrl: string;
  photoUrl: string | null;

  // Position & Location
  title: string;
  position: string;
  offices: string[];

  // Contact
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;

  // Professional Details
  practiceAreas: string[];
  industries: string[];

  // Education & Credentials
  education: {
    degree: string;
    school: string;
    year: string | null;
    honors: string | null;
  }[];
  barAdmissions: string[];
  courtAdmissions: string[];

  // Professional Affiliations
  affiliations: string[];

  // Additional Info
  languages: string[];
  clerkships: string[];
  biography: string | null;

  // Recognition & Rankings
  rankings: string[];

  // Metadata
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

const BASE_URL = 'https://www.skadden.com';
const PROFESSIONALS_URL = `${BASE_URL}/professionals`;
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'skadden-lawyers.json');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

// Rate limiting config
const DELAY_BETWEEN_PROFILES = 1000; // 1 second between profile requests
const DELAY_BETWEEN_LETTERS = 2000; // 2 seconds between letter pages

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const pageSize = 5; // Each page shows 5 results

  console.log(`\n--- Collecting lawyers for letter: ${letter} ---`);

  while (true) {
    // Navigate to the page with skip parameter
    const url = `${PROFESSIONALS_URL}?skip=${skip}&letter=${letter.toLowerCase()}&hassearched=true`;
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await dismissCookieDialog(page);
    await delay(1500);

    // Wait for results to appear
    try {
      await page.waitForSelector(`a[href*="/professionals/${letter.toLowerCase()}/"]`, { timeout: 15000 });
    } catch {
      if (skip === 0) {
        console.log(`  No results found for letter ${letter}`);
      }
      break; // No more results
    }

    // Extract profile links from this page
    const profileLinks = await page.locator(`a[href*="/professionals/${letter.toLowerCase()}/"]`).all();
    let newLinksFound = 0;

    for (const link of profileLinks) {
      try {
        const href = await link.getAttribute('href');
        // Match pattern like /professionals/a/adams-nicholas
        if (href && href.match(/\/professionals\/[a-z]\/[\w-]+$/)) {
          // Skip if already seen
          if (seenUrls.has(href)) continue;

          const name = await link.textContent() || '';

          // Only add if we have a valid name (skip image links with empty text)
          if (name.trim() && name.trim().length > 1 && !['Home', 'Professionals'].includes(name.trim())) {
            seenUrls.add(href); // Only mark as seen when we have valid data
            lawyers.push({
              name: name.trim(),
              profileUrl: `${BASE_URL}${href}`,
              position: '',
              office: '',
              email: null,
              phone: null
            });
            newLinksFound++;
          }
        }
      } catch {
        // Skip problematic links
      }
    }

    console.log(`  Page ${skip / pageSize + 1}: found ${newLinksFound} new lawyers (total: ${lawyers.length})`);

    // If no new links found, we've reached the end
    if (newLinksFound === 0) {
      break;
    }

    skip += pageSize;
    await delay(500); // Small delay between pages
  }

  console.log(`  Total for letter ${letter}: ${lawyers.length} lawyers`);
  return lawyers;
}

async function scrapeProfilePage(page: Page, profileUrl: string): Promise<LawyerProfile | null> {
  try {
    await page.goto(profileUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await dismissCookieDialog(page);
    await delay(500);

    const profile: LawyerProfile = {
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
  scrapedProfiles: LawyerProfile[];
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
  console.log('='.repeat(60));
  console.log('Skadden Professionals Directory Scraper');
  console.log('='.repeat(60));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load any existing progress
  const progress = loadProgress();
  console.log(`\nLoaded progress: ${progress.completedLetters.length} letters done, ${progress.scrapedProfiles.length} profiles scraped`);

  const browser: Browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page: Page = await context.newPage();

  try {
    // Step 1: Collect all lawyer URLs from A-Z
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    for (const letter of letters) {
      if (progress.completedLetters.includes(letter)) {
        console.log(`\nSkipping letter ${letter} (already completed)`);
        continue;
      }

      const lawyers = await collectLawyersForLetter(page, letter);
      progress.allLawyers.push(...lawyers);
      progress.completedLetters.push(letter);
      saveProgress(progress);

      await delay(DELAY_BETWEEN_LETTERS);
    }

    // Deduplicate lawyers
    const uniqueLawyers = Array.from(
      new Map(progress.allLawyers.map(l => [l.profileUrl, l])).values()
    );
    progress.allLawyers = uniqueLawyers;
    saveProgress(progress);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total unique lawyers found: ${uniqueLawyers.length}`);
    console.log(`${'='.repeat(60)}`);

    // Step 2: Scrape each profile page
    const alreadyScraped = new Set(progress.scrapedProfiles.map(p => p.profileUrl));
    const toScrape = uniqueLawyers.filter(l => !alreadyScraped.has(l.profileUrl));

    console.log(`\nProfiles to scrape: ${toScrape.length}`);

    let scraped = 0;
    for (const lawyer of toScrape) {
      scraped++;
      console.log(`\n[${scraped}/${toScrape.length}] Scraping: ${lawyer.name}`);

      const profile = await scrapeProfilePage(page, lawyer.profileUrl);

      if (profile) {
        progress.scrapedProfiles.push(profile);
        console.log(`  Success: ${profile.name} - ${profile.offices.join(', ')}`);
      } else {
        progress.failedUrls.push(lawyer.profileUrl);
        console.log(`  Failed: ${lawyer.profileUrl}`);
      }

      // Save progress every 10 profiles
      if (scraped % 10 === 0) {
        saveProgress(progress);
        console.log(`\n  [Progress saved: ${progress.scrapedProfiles.length} profiles]`);
      }

      await delay(DELAY_BETWEEN_PROFILES);
    }

    // Final save
    saveProgress(progress);

    // Write final output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalProfiles: progress.scrapedProfiles.length,
      failedUrls: progress.failedUrls,
      profiles: progress.scrapedProfiles
    }, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Scraping complete!');
    console.log(`Total profiles scraped: ${progress.scrapedProfiles.length}`);
    console.log(`Failed URLs: ${progress.failedUrls.length}`);
    console.log(`Output saved to: ${OUTPUT_FILE}`);
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
