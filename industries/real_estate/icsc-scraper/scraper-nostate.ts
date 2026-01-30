/**
 * ICSC Member Directory Scraper - NO STATE FILTER
 *
 * Gets Owner/Developer members without filtering by state.
 * This catches members who don't have location data set.
 * Limited to 1000 results by ICSC, but we skip existing members.
 *
 * Usage:
 *   npx tsx scraper-nostate.ts
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const CREDENTIALS = {
  email: 'kush@developiq.ai',
  password: '***REMOVED***',
};

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

const BASE_URL = 'https://www.icsc.com';
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMBINED_FILE = path.join(OUTPUT_DIR, 'icsc-members-combined-2026-01-30.json');

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min: number = 1000, max: number = 2500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

function loadExistingMembers(): Set<string> {
  const existingUrls = new Set<string>();
  if (fs.existsSync(COMBINED_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COMBINED_FILE, 'utf-8'));
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

// Build search URL WITHOUT state filter
function buildSearchUrl(page: number = 1): string {
  const baseParams = 'type=members&perPage=24&view=list';
  const businessType = 'refinementList%5Bbusiness_type%5D%5B0%5D=Owner%2FDeveloper';
  const configParams = 'configure%5BclickAnalytics%5D=true&configure%5BmaxValuesPerFacet%5D=100&configure%5Bfilters%5D=NOT%20status%3AInactive';
  return `${BASE_URL}/search?${baseParams}&${businessType}&page=${page}&${configParams}`;
}

async function performLogin(page: Page): Promise<boolean> {
  console.log('Logging in...');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await delay(5000);
    // Wait for the form to be ready
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    try {
      const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Reject All")');
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch {}
    await page.fill('input[name="username"]', CREDENTIALS.email);
    await humanDelay(800, 1200);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await humanDelay(800, 1200);
    await page.click('button:text-is("Sign In")');
    await delay(5000);
    if (!page.url().includes('/login')) {
      console.log('Login successful!\n');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Login error:', error);
    return false;
  }
}

async function scrapeMembersFromPage(page: Page, existingUrls: Set<string>): Promise<{ members: ICSCMember[], skipped: number }> {
  await delay(2500);
  const args = { existingUrlsArray: Array.from(existingUrls) };
  const result = await page.evaluate((args) => {
    const { existingUrlsArray } = args;
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
      if (existingSet.has(profileUrl)) {
        skipped++;
        return;
      }
      const name = link.textContent?.trim() || '';
      if (!name || name.length < 2) return;

      let container: Element | null = link;
      for (let i = 0; i < 5; i++) {
        const parent = container?.parentElement;
        if (parent && parent.textContent && parent.textContent.length > name.length + 20) {
          container = parent;
        } else {
          break;
        }
      }
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
        state: 'Unknown',
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

function saveJson(members: ICSCMember[], outputPath: string): void {
  const output = {
    scrapedAt: new Date().toISOString(),
    source: 'https://www.icsc.com',
    filter: 'Owner/Developer (no state filter)',
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

function mergeWithExisting(newMembers: ICSCMember[]): ICSCMember[] {
  let existingMembers: ICSCMember[] = [];
  if (fs.existsSync(COMBINED_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COMBINED_FILE, 'utf-8'));
      existingMembers = data.members || [];
    } catch {}
  }
  const allMembers = [...existingMembers, ...newMembers];
  const seen = new Set<string>();
  return allMembers.filter(m => {
    if (seen.has(m.profileUrl)) return false;
    seen.add(m.profileUrl);
    return true;
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('ICSC Member Directory Scraper - NO STATE FILTER');
  console.log('='.repeat(60));
  console.log('Getting members without location data\n');

  const existingUrls = loadExistingMembers();
  const newMembers: ICSCMember[] = [];

  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 75,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page: Page = await context.newPage();

  try {
    const loggedIn = await performLogin(page);
    if (!loggedIn) {
      console.log('Login failed. Exiting.');
      return;
    }

    // Scrape up to 42 pages (1000 results / 24 per page)
    let totalNew = 0;
    let totalSkipped = 0;

    for (let pageNum = 1; pageNum <= 45; pageNum++) {
      const url = buildSearchUrl(pageNum);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(2500, 4000);

      const { members, skipped } = await scrapeMembersFromPage(page, existingUrls);

      console.log(`Page ${pageNum}: ${members.length} new, ${skipped} skipped`);

      if (members.length === 0 && skipped === 0) {
        console.log('No more results, stopping.');
        break;
      }

      newMembers.push(...members);
      totalNew += members.length;
      totalSkipped += skipped;

      // Add to existing set to avoid duplicates within this run
      for (const m of members) {
        existingUrls.add(m.profileUrl);
      }

      await humanDelay(3000, 5000);
    }

    // Save results
    const timestamp = new Date().toISOString().split('T')[0];

    if (newMembers.length > 0) {
      const newJsonPath = path.join(OUTPUT_DIR, `icsc-members-nostate-${timestamp}.json`);
      const newCsvPath = path.join(OUTPUT_DIR, `icsc-members-nostate-${timestamp}.csv`);
      saveJson(newMembers, newJsonPath);
      saveCsv(newMembers, newCsvPath);

      // Merge with existing
      const allMembers = mergeWithExisting(newMembers);
      const combinedJsonPath = path.join(OUTPUT_DIR, `icsc-members-combined-${timestamp}.json`);
      const combinedCsvPath = path.join(OUTPUT_DIR, `icsc-members-combined-${timestamp}.csv`);
      saveJson(allMembers, combinedJsonPath);
      saveCsv(allMembers, combinedCsvPath);

      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE COMPLETE');
      console.log('='.repeat(60));
      console.log(`New members found: ${newMembers.length}`);
      console.log(`Skipped (already had): ${totalSkipped}`);
      console.log(`Total combined: ${allMembers.length}`);
      console.log(`\nOutput: ${combinedCsvPath}`);
    } else {
      console.log('\nNo new members found.');
    }

  } catch (error) {
    console.error('\nError:', error);
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }
}

main().catch(console.error);
