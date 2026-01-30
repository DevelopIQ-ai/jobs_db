/**
 * ICSC Member Directory Scraper - EXPAND VERSION
 *
 * Gets more Owner/Developer members using the broader category filter.
 * Skips members we already have to avoid duplicates.
 *
 * Usage:
 *   npx tsx scraper-expand.ts
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Credentials
// =============================================================================

const CREDENTIALS = {
  email: 'kush@developiq.ai',
  password: '***REMOVED***',
};

// =============================================================================
// Types
// =============================================================================

interface ICSCMember {
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  location: string;
  state: string;
  businessType: string;
  profileUrl: string;
  scrapedAt: string;
}

interface ScrapeProgress {
  completedStates: string[];
  currentState: string;
  members: ICSCMember[];
  existingCount: number;
  newCount: number;
  lastUpdated: string;
}

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = 'https://www.icsc.com';
const OUTPUT_DIR = path.join(__dirname, 'output');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'expand-scrape-progress.json');
const EXISTING_FILE = path.join(OUTPUT_DIR, 'icsc-members-full-2026-01-30.json');

// Target: get ~6000 new members (increased from 3000)
const TARGET_NEW_MEMBERS = 6000;

// All US States + DC + some international
const REGIONS = [
  // US States (alphabetical)
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming', 'District of Columbia',
  // International / Other
  'Puerto Rico', 'Canada', 'International'
];

// Build search URL with BROAD Owner/Developer filter (not specific subcategories)
function buildSearchUrl(state: string, page: number = 1): string {
  const baseParams = 'type=members&perPage=24&view=list';

  // Use the broader Owner/Developer category (gets all subcategories)
  const businessType = 'refinementList%5Bbusiness_type%5D%5B0%5D=Owner%2FDeveloper';

  // State filter
  const stateParam = `refinementList%5Blocation.state%5D%5B0%5D=${encodeURIComponent(state)}`;

  const configParams = 'configure%5BclickAnalytics%5D=true&configure%5BmaxValuesPerFacet%5D=100&configure%5Bfilters%5D=NOT%20status%3AInactive';

  return `${BASE_URL}/search?${baseParams}&${businessType}&${stateParam}&page=${page}&${configParams}`;
}

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min: number = 1000, max: number = 2500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function loadExistingMembers(): Set<string> {
  const existingUrls = new Set<string>();

  // Load from the full scrape file
  if (fs.existsSync(EXISTING_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(EXISTING_FILE, 'utf-8'));
      if (data.members && Array.isArray(data.members)) {
        for (const m of data.members) {
          if (m.profileUrl) {
            existingUrls.add(m.profileUrl);
          }
        }
      }
      console.log(`Loaded ${existingUrls.size} existing member URLs to skip`);
    } catch (e) {
      console.log('Could not load existing members file');
    }
  }

  return existingUrls;
}

function loadProgress(): ScrapeProgress | null {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

function saveProgress(progress: ScrapeProgress): void {
  ensureOutputDir();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// =============================================================================
// Login
// =============================================================================

async function performLogin(page: Page): Promise<boolean> {
  console.log('Logging in...');

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(3000);

    // Dismiss privacy banner
    try {
      const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Reject All")');
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch {}

    // Fill credentials
    await page.fill('input[name="username"]', CREDENTIALS.email);
    await humanDelay(800, 1200);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await humanDelay(800, 1200);

    // Submit
    await page.click('button:text-is("Sign In")');
    await delay(5000);

    // Check if logged in
    const url = page.url();
    if (!url.includes('/login')) {
      console.log('Login successful!\n');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Login error:', error);
    return false;
  }
}

// =============================================================================
// Scraping Functions
// =============================================================================

async function scrapeMembersFromPage(page: Page, state: string, existingUrls: Set<string>): Promise<{ members: ICSCMember[], skipped: number }> {
  await delay(2500);

  const args = { currentState: state, existingUrlsArray: Array.from(existingUrls) };

  const result = await page.evaluate((args) => {
    const { currentState, existingUrlsArray } = args;
    const existingSet = new Set(existingUrlsArray);
    const results: Array<{
      name: string;
      company: string;
      title: string;
      phone: string;
      email: string;
      location: string;
      state: string;
      businessType: string;
      profileUrl: string;
    }> = [];
    let skipped = 0;

    // Find all member profile links
    const memberLinks = Array.from(document.querySelectorAll('a[href*="/member/profile/"]'))
      .filter(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent?.trim() || '';
        return href.includes('/member/profile/') &&
               !text.toLowerCase().includes('sign out') &&
               text.length > 2;
      }) as HTMLAnchorElement[];

    const seenProfiles = new Set<string>();

    memberLinks.forEach(link => {
      const profileUrl = link.href;
      if (seenProfiles.has(profileUrl)) return;
      seenProfiles.add(profileUrl);

      // Skip if we already have this member
      if (existingSet.has(profileUrl)) {
        skipped++;
        return;
      }

      const name = link.textContent?.trim() || '';
      if (!name || name.length < 2) return;

      // Find container
      let container: Element | null = link;
      for (let i = 0; i < 5; i++) {
        const parent = container?.parentElement;
        if (parent && parent.textContent && parent.textContent.length > name.length + 20) {
          container = parent;
        } else {
          break;
        }
      }

      // Company
      let company = '';
      const companyLink = container?.querySelector('a[href*="/company/profile/"]');
      if (companyLink) {
        company = companyLink.textContent?.trim().replace(/\s*\(Owner\/Developer\)/i, '') || '';
      }

      results.push({
        name,
        company,
        title: '',
        phone: '',
        email: '',
        location: '',
        state: currentState,
        businessType: 'Owner/Developer',
        profileUrl,
      });
    });

    return { results, skipped };
  }, args);

  return {
    members: result.results.map(m => ({
      ...m,
      scrapedAt: new Date().toISOString(),
    })),
    skipped: result.skipped,
  };
}

async function goToPage(page: Page, state: string, pageNum: number): Promise<void> {
  const url = buildSearchUrl(state, pageNum);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(2500, 4000);
      return;
    } catch (error) {
      if (attempt < 3) {
        console.log(`    Retry ${attempt}/3...`);
        await delay(8000 * attempt);
      } else {
        throw error;
      }
    }
  }
}

// =============================================================================
// Output
// =============================================================================

function saveJson(members: ICSCMember[], outputPath: string): void {
  const output = {
    scrapedAt: new Date().toISOString(),
    source: 'https://www.icsc.com',
    filter: 'Owner/Developer (expanded)',
    count: members.length,
    members,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
}

function saveCsv(members: ICSCMember[], outputPath: string): void {
  const headers = ['Name', 'Company', 'Title', 'Phone', 'Email', 'Location', 'State', 'Business Type', 'Profile URL'];

  const escapeCsv = (value: string): string => {
    if (!value) return '""';
    const escaped = value.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
    return `"${escaped}"`;
  };

  const rows = members.map(m => [
    escapeCsv(m.name),
    escapeCsv(m.company),
    escapeCsv(m.title),
    escapeCsv(m.phone),
    escapeCsv(m.email),
    escapeCsv(m.location),
    escapeCsv(m.state),
    escapeCsv(m.businessType),
    escapeCsv(m.profileUrl),
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
}

function mergeFinalOutput(newMembers: ICSCMember[]): ICSCMember[] {
  // Load existing members
  let existingMembers: ICSCMember[] = [];
  if (fs.existsSync(EXISTING_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(EXISTING_FILE, 'utf-8'));
      existingMembers = data.members || [];
    } catch {}
  }

  // Combine and dedupe
  const allMembers = [...existingMembers, ...newMembers];
  const seen = new Set<string>();
  return allMembers.filter(m => {
    if (seen.has(m.profileUrl)) return false;
    seen.add(m.profileUrl);
    return true;
  });
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('ICSC Member Directory Scraper - EXPAND VERSION');
  console.log('='.repeat(60));
  console.log('Using BROAD Owner/Developer filter (all subcategories)');
  console.log(`Target: ${TARGET_NEW_MEMBERS} new members`);
  console.log();

  ensureOutputDir();

  // Load existing members to skip
  const existingUrls = loadExistingMembers();

  // Load progress
  let progress = loadProgress();
  let newMembers: ICSCMember[] = progress?.members || [];
  const completedStates = new Set(progress?.completedStates || []);
  let totalNewCount = progress?.newCount || 0;

  if (completedStates.size > 0) {
    console.log(`Resuming: ${completedStates.size} states done, ${totalNewCount} new members so far\n`);
  }

  // Check if we already hit target
  if (totalNewCount >= TARGET_NEW_MEMBERS) {
    console.log(`Already have ${totalNewCount} new members. Target reached!`);
    return;
  }

  // Launch browser with stealth settings
  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 75,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page: Page = await context.newPage();

  try {
    // Login
    const loggedIn = await performLogin(page);
    if (!loggedIn) {
      console.log('Login failed. Exiting.');
      return;
    }

    // Scrape each state
    for (const state of REGIONS) {
      if (completedStates.has(state)) {
        continue;
      }

      // Check if we hit target
      if (totalNewCount >= TARGET_NEW_MEMBERS) {
        console.log(`\nReached target of ${TARGET_NEW_MEMBERS} new members!`);
        break;
      }

      console.log(`\n[${'='.repeat(50)}]`);
      console.log(`Scraping: ${state} (${totalNewCount}/${TARGET_NEW_MEMBERS} new so far)`);
      console.log(`[${'='.repeat(50)}]`);

      // Navigate to first page for this state
      await goToPage(page, state, 1);

      // Scrape all pages for this state
      let stateNewMembers: ICSCMember[] = [];
      let stateSkipped = 0;
      let pageNum = 1;
      let consecutiveEmpty = 0;

      while (consecutiveEmpty < 2) {
        if (pageNum > 1) {
          await goToPage(page, state, pageNum);
        }

        const { members: pageMembers, skipped } = await scrapeMembersFromPage(page, state, existingUrls);
        stateSkipped += skipped;

        const newOnPage = pageMembers.length;
        console.log(`  Page ${pageNum}: ${newOnPage} new, ${skipped} skipped`);

        if (newOnPage === 0 && skipped === 0) {
          consecutiveEmpty++;
          pageNum++;
          continue;
        }

        consecutiveEmpty = 0;
        stateNewMembers.push(...pageMembers);

        // Add to existing URLs so we don't re-scrape within this session
        for (const m of pageMembers) {
          existingUrls.add(m.profileUrl);
        }

        pageNum++;

        // Longer delay between pages (3-5 seconds)
        await humanDelay(3000, 5000);

        // Safety limit per state
        if (pageNum > 100) {
          console.log(`  Warning: Hit 100 page limit for ${state}`);
          break;
        }

        // Check if we hit target mid-state
        if (totalNewCount + stateNewMembers.length >= TARGET_NEW_MEMBERS) {
          console.log(`  Stopping early - hit target`);
          break;
        }
      }

      console.log(`  Total for ${state}: ${stateNewMembers.length} new, ${stateSkipped} skipped`);

      newMembers.push(...stateNewMembers);
      totalNewCount += stateNewMembers.length;
      completedStates.add(state);

      // Save progress after each state
      progress = {
        completedStates: Array.from(completedStates),
        currentState: '',
        members: newMembers,
        existingCount: existingUrls.size,
        newCount: totalNewCount,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);

      // Longer break between states (8-15 seconds)
      if (REGIONS.indexOf(state) < REGIONS.length - 1 && totalNewCount < TARGET_NEW_MEMBERS) {
        const breakTime = 8000 + Math.random() * 7000;
        console.log(`  Taking a break (${(breakTime / 1000).toFixed(1)}s)...`);
        await delay(breakTime);
      }

      // Extra long break every 3 states (20-35 seconds)
      if ((REGIONS.indexOf(state) + 1) % 3 === 0) {
        const longBreak = 20000 + Math.random() * 15000;
        console.log(`  Taking a longer break (${(longBreak / 1000).toFixed(1)}s)...`);
        await delay(longBreak);
      }
    }

    // Save new members
    const timestamp = new Date().toISOString().split('T')[0];
    const newJsonPath = path.join(OUTPUT_DIR, `icsc-members-expand-${timestamp}.json`);
    const newCsvPath = path.join(OUTPUT_DIR, `icsc-members-expand-${timestamp}.csv`);
    saveJson(newMembers, newJsonPath);
    saveCsv(newMembers, newCsvPath);

    // Merge with existing and save combined file
    const allMembers = mergeFinalOutput(newMembers);
    const combinedJsonPath = path.join(OUTPUT_DIR, `icsc-members-combined-${timestamp}.json`);
    const combinedCsvPath = path.join(OUTPUT_DIR, `icsc-members-combined-${timestamp}.csv`);
    saveJson(allMembers, combinedJsonPath);
    saveCsv(allMembers, combinedCsvPath);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SCRAPE COMPLETE');
    console.log('='.repeat(60));
    console.log(`States scraped this run: ${completedStates.size}`);
    console.log(`New members found: ${newMembers.length}`);
    console.log(`Total combined members: ${allMembers.length}`);

    // By state breakdown for new members
    const byState: Record<string, number> = {};
    for (const m of newMembers) {
      byState[m.state] = (byState[m.state] || 0) + 1;
    }
    console.log('\nNew members by state (top 10):');
    const sortedStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [st, count] of sortedStates) {
      console.log(`  ${st}: ${count}`);
    }

    console.log(`\nOutput saved:`);
    console.log(`  New only: ${newCsvPath}`);
    console.log(`  Combined: ${combinedCsvPath}`);

  } catch (error) {
    console.error('\nError:', error);

    // Save whatever we have
    if (newMembers.length > 0) {
      const timestamp = new Date().toISOString().split('T')[0];
      const jsonPath = path.join(OUTPUT_DIR, `icsc-members-expand-partial-${timestamp}.json`);
      saveJson(newMembers, jsonPath);
      console.log(`\nPartial results saved to: ${jsonPath}`);
    }
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }
}

main().catch(console.error);
