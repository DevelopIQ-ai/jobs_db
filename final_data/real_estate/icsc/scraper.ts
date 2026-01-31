/**
 * ICSC Member Directory Scraper - FULL VERSION
 *
 * Scrapes ALL Owner/Developer members by filtering by state to bypass 1000 result limit.
 *
 * Usage:
 *   npx tsx scraper-full.ts
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
  lastUpdated: string;
}

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = 'https://www.icsc.com';
const OUTPUT_DIR = path.join(__dirname, 'output');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'full-scrape-progress.json');
const SOURCE_ID = 'real_estate/icsc';
const LEADS_FILE = path.join(OUTPUT_DIR, 'leads.jsonl');
const RUN_FILE = path.join(OUTPUT_DIR, 'run.json');

// All US States + DC + some international
const REGIONS = [
  // US States
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

// Build search URL with state filter
function buildSearchUrl(state: string, page: number = 1): string {
  const baseParams = 'type=members&perPage=24&view=list';
  const businessTypes = [
    'refinementList%5Bbusiness_type%5D%5B0%5D=Owner%2FDeveloper%20%3E%20OWN01-Owner',
    'refinementList%5Bbusiness_type%5D%5B1%5D=Owner%2FDeveloper%20%3E%20OWN03-Traditional%20Developer',
    'refinementList%5Bbusiness_type%5D%5B2%5D=Owner%2FDeveloper%20%3E%20OWN02-Outlet%20Developer'
  ].join('&');

  // Correct filter: location.state (not just state)
  const stateParam = `refinementList%5Blocation.state%5D%5B0%5D=${encodeURIComponent(state)}`;

  const configParams = 'configure%5BclickAnalytics%5D=true&configure%5BmaxValuesPerFacet%5D=100&configure%5Bfilters%5D=NOT%20status%3AInactive';

  return `${BASE_URL}/search?${baseParams}&${businessTypes}&${stateParam}&page=${page}&${configParams}`;
}

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min: number = 500, max: number = 1500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

async function randomMouseMove(page: Page): Promise<void> {
  const x = 100 + Math.random() * 800;
  const y = 100 + Math.random() * 500;
  await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
}

function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
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
    await humanDelay(500, 1000);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await humanDelay(500, 1000);

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

async function getTotalPagesForState(page: Page): Promise<number> {
  const totalPages = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // Look for "X of Y" pagination
    const pageOfMatch = bodyText.match(/\b(\d{1,3})\s+of\s+(\d{1,3})\b/g);
    if (pageOfMatch) {
      for (const match of pageOfMatch) {
        const parts = match.match(/(\d+)\s+of\s+(\d+)/);
        if (parts) {
          const total = parseInt(parts[2], 10);
          if (total > 0 && total < 500) {
            return total;
          }
        }
      }
    }

    // Look for "Filter Results (X)"
    const filterMatch = bodyText.match(/Filter Results\s*\(([\d,]+)\+?\)/i);
    if (filterMatch) {
      const total = parseInt(filterMatch[1].replace(/,/g, ''), 10);
      return Math.ceil(total / 24);
    }

    // Check if there are any results at all
    const noResults = bodyText.includes('No results found') || bodyText.includes('0 results');
    if (noResults) return 0;

    return 1;
  });

  return totalPages;
}

async function scrapeMembersFromPage(page: Page, state: string): Promise<ICSCMember[]> {
  await delay(2000);

  const members = await page.evaluate((currentState: string) => {
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

    return results;
  }, state);

  return members.map(m => ({
    ...m,
    scrapedAt: new Date().toISOString(),
  }));
}

async function scrapeProfileDetails(page: Page, member: ICSCMember): Promise<ICSCMember> {
  try {
    await page.goto(member.profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1000, 1500);

    const details = await page.evaluate(() => {
      const data: { phone?: string; email?: string; title?: string; location?: string } = {};

      // Phone
      const phoneLink = document.querySelector('a[href^="tel:"]');
      if (phoneLink) {
        data.phone = phoneLink.getAttribute('href')?.replace('tel:', '').replace(/^\+1/, '').trim() || '';
      }

      // Email
      const emailLink = document.querySelector('a[href^="mailto:"]');
      if (emailLink) {
        data.email = emailLink.getAttribute('href')?.replace('mailto:', '').trim() || '';
      }

      // Title from page text
      const pageText = document.body.innerText;
      const titleMatch = pageText.match(/(?:^|\n)((?:President|CEO|CFO|COO|Founder|Co-Founder|Owner|Principal|Partner|Managing Director|Director|Vice President|VP|Chairman|Manager|Developer)[^\n]*)/i);
      if (titleMatch) {
        data.title = titleMatch[1].trim().substring(0, 100);
      }

      // Location
      const locationMatch = pageText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/i);
      if (locationMatch) {
        data.location = `${locationMatch[1]}, ${locationMatch[2]}`;
      }

      return data;
    });

    return {
      ...member,
      phone: details.phone || member.phone,
      email: details.email || member.email,
      title: details.title || member.title,
      location: details.location || member.location,
    };
  } catch {
    return member;
  }
}

async function goToPage(page: Page, state: string, pageNum: number): Promise<void> {
  const url = buildSearchUrl(state, pageNum);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(2000, 3000);
      return;
    } catch (error) {
      if (attempt < 3) {
        console.log(`    Retry ${attempt}/3...`);
        await delay(5000 * attempt);
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
    filter: 'Owner/Developer (all states)',
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

function convertToLeadRecord(member: ICSCMember) {
  const profileId = member.profileUrl.match(/\/profile\/(\d+)/)?.[1] || 'unknown';
  return {
    core: {
      source_id: SOURCE_ID,
      entity_type: "person" as const,
      scraped_at: member.scrapedAt,
      raw_url: member.profileUrl,
      primary_key: `${SOURCE_ID}:profile:${profileId}`,
    },
    person: {
      full_name: member.name,
      title: member.title || undefined,
      company_name: member.company || undefined,
      profile_url: member.profileUrl,
    },
    contact: {
      email: member.email || undefined,
      phone: member.phone || undefined,
      location: member.state ? { state: member.state, country: "USA" } : undefined,
    },
    context: {
      business_type: member.businessType || undefined,
      state: member.state || undefined,
    },
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const startTime = new Date();

  console.log('\n' + '='.repeat(60));
  console.log('ICSC Member Directory Scraper - FULL VERSION');
  console.log('='.repeat(60));
  console.log('Strategy: Scrape by state to bypass 1000 result limit');
  console.log(`States to scrape: ${REGIONS.length}`);
  console.log();

  ensureOutputDir();

  // Load progress
  let progress = loadProgress();
  let allMembers: ICSCMember[] = progress?.members || [];
  const completedStates = new Set(progress?.completedStates || []);

  if (completedStates.size > 0) {
    console.log(`Resuming: ${completedStates.size} states completed, ${allMembers.length} members so far\n`);
  }

  // Launch browser
  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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

      console.log(`\n[${'='.repeat(50)}]`);
      console.log(`Scraping: ${state}`);
      console.log(`[${'='.repeat(50)}]`);

      progress = {
        completedStates: Array.from(completedStates),
        currentState: state,
        members: allMembers,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);

      // Navigate to first page for this state
      await goToPage(page, state, 1);

      // Scrape all pages for this state (stop when no more results)
      let stateMembers: ICSCMember[] = [];
      let pageNum = 1;
      let consecutiveEmpty = 0;

      while (consecutiveEmpty < 2) {  // Stop after 2 consecutive empty pages
        if (pageNum > 1) {
          await goToPage(page, state, pageNum);
        }

        const pageMembers = await scrapeMembersFromPage(page, state);
        console.log(`  Page ${pageNum}: ${pageMembers.length} members`);

        if (pageMembers.length === 0) {
          consecutiveEmpty++;
          pageNum++;
          continue;
        }

        consecutiveEmpty = 0;

        // Don't scrape individual profiles (too slow and causes blocks)
        // Just collect from list view
        stateMembers.push(...pageMembers);

        pageNum++;
        // Longer delay between pages to avoid rate limiting
        await humanDelay(2000, 4000);

        // Safety limit per state
        if (pageNum > 100) {
          console.log(`  Warning: Hit 100 page limit for ${state}`);
          break;
        }
      }

      console.log(`  Total for ${state}: ${stateMembers.length} members`);
      allMembers.push(...stateMembers);
      completedStates.add(state);

      // Save progress after each state
      progress = {
        completedStates: Array.from(completedStates),
        currentState: '',
        members: allMembers,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);

      // Longer break between states to avoid rate limiting
      if (REGIONS.indexOf(state) < REGIONS.length - 1) {
        const breakTime = 5000 + Math.random() * 5000;
        console.log(`  Taking a break (${(breakTime / 1000).toFixed(1)}s)...`);
        await delay(breakTime);
      }

      // Extra long break every 5 states
      if ((REGIONS.indexOf(state) + 1) % 5 === 0) {
        const longBreak = 15000 + Math.random() * 10000;
        console.log(`  Taking a longer break (${(longBreak / 1000).toFixed(1)}s)...`);
        await delay(longBreak);
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueMembers = allMembers.filter(m => {
      const key = m.profileUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Save final output as JSONL
    const records = uniqueMembers.map(m => JSON.stringify(convertToLeadRecord(m)));
    fs.writeFileSync(LEADS_FILE, records.join('\n') + '\n');

    // Save run.json
    const endTime = new Date();
    const runData = {
      source_id: SOURCE_ID,
      run_id: `${SOURCE_ID}:${startTime.toISOString()}`,
      started_at: startTime.toISOString(),
      ended_at: endTime.toISOString(),
      records_found: allMembers.length,
      records_valid: uniqueMembers.length,
      records_written: uniqueMembers.length,
      error_count: 0,
    };
    fs.writeFileSync(RUN_FILE, JSON.stringify(runData, null, 2));

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SCRAPE COMPLETE');
    console.log('='.repeat(60));
    console.log(`States scraped: ${completedStates.size}`);
    console.log(`Total members (raw): ${allMembers.length}`);
    console.log(`Unique members: ${uniqueMembers.length}`);

    // Stats
    const withPhone = uniqueMembers.filter(m => m.phone).length;
    const withEmail = uniqueMembers.filter(m => m.email).length;
    console.log(`With phone: ${withPhone} (${(withPhone / uniqueMembers.length * 100).toFixed(1)}%)`);
    console.log(`With email: ${withEmail} (${(withEmail / uniqueMembers.length * 100).toFixed(1)}%)`);

    // By state breakdown
    const byState: Record<string, number> = {};
    for (const m of uniqueMembers) {
      byState[m.state] = (byState[m.state] || 0) + 1;
    }
    console.log('\nTop 10 states:');
    const sortedStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [st, count] of sortedStates) {
      console.log(`  ${st}: ${count}`);
    }

    console.log(`\nOutput saved:`);
    console.log(`  JSONL: ${LEADS_FILE}`);
    console.log(`  Run: ${RUN_FILE}`);

  } catch (error) {
    console.error('\nError:', error);

    // Save whatever we have
    if (allMembers.length > 0) {
      const timestamp = new Date().toISOString().split('T')[0];
      const jsonPath = path.join(OUTPUT_DIR, `icsc-members-full-partial-${timestamp}.json`);
      saveJson(allMembers, jsonPath);
      console.log(`\nPartial results saved to: ${jsonPath}`);
    }
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }
}

main().catch(console.error);
