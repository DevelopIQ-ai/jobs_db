/**
 * ICSC Member Directory Scraper
 *
 * Scrapes Owner/Developer members from ICSC member directory.
 * Auto-login with credentials, anti-detection measures included.
 *
 * Usage:
 *   # Install dependencies first
 *   npm install
 *
 *   # Run scraper
 *   npx tsx scraper.ts
 *
 *   # Resume from a specific page
 *   npx tsx scraper.ts --start-page 5
 *
 * Output:
 *   output/icsc-members-{date}.json
 *   output/icsc-members-{date}.csv
 *   output/scrape-progress.json (for resuming)
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
  businessType: string;
  profileUrl: string;
  scrapedAt: string;
}

interface ScrapeProgress {
  lastPage: number;
  totalPages: number;
  members: ICSCMember[];
  lastUpdated: string;
}

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = 'https://www.icsc.com';
const SEARCH_URL = 'https://www.icsc.com/search?type=members&perPage=24&view=list&refinementList%5Bbusiness_type%5D%5B0%5D=Owner%2FDeveloper%20%3E%20OWN01-Owner&refinementList%5Bbusiness_type%5D%5B1%5D=Owner%2FDeveloper%20%3E%20OWN03-Traditional%20Developer&refinementList%5Bbusiness_type%5D%5B2%5D=Owner%2FDeveloper%20%3E%20OWN02-Outlet%20Developer&page=1&configure%5BclickAnalytics%5D=true&configure%5BmaxValuesPerFacet%5D=100&configure%5Bfilters%5D=NOT%20status%3AInactive';

const OUTPUT_DIR = path.join(__dirname, 'output');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');

// =============================================================================
// Anti-Detection Utilities
// =============================================================================

// Human-like random delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min: number = 500, max: number = 1500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

// Simulate human typing with random delays between keystrokes
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await humanDelay(200, 400);

  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
  }
}

// Random mouse movements to appear human
async function randomMouseMove(page: Page): Promise<void> {
  const x = 100 + Math.random() * 800;
  const y = 100 + Math.random() * 500;
  await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
}

// Scroll like a human
async function humanScroll(page: Page): Promise<void> {
  const scrollAmount = 100 + Math.random() * 300;
  await page.mouse.wheel(0, scrollAmount);
  await humanDelay(300, 800);
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
// Login Helper
// =============================================================================

async function performLogin(page: Page): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log('AUTOMATED LOGIN');
  console.log('='.repeat(60));

  try {
    // Navigate to login page with human-like timing
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for page to settle
    await delay(5000);

    // Dismiss privacy/cookie consent banner if present
    console.log('Checking for privacy consent banner...');
    try {
      const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Accept"), button:has-text("Reject All")');
      if (confirmBtn && await confirmBtn.isVisible()) {
        console.log('Dismissing privacy banner...');
        await confirmBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch {
      // No banner or already dismissed
    }

    // Move mouse around like a human would
    await randomMouseMove(page);
    await humanDelay(500, 1000);

    // Find and fill email field with expanded selectors
    console.log('Entering credentials...');
    const emailSelectors = [
      'input[name="username"]',  // ICSC uses 'username' for email
      'input[placeholder*="Email Address" i]',
      'input[name="email"]',
      'input[type="email"]',
      '#email',
      'input[placeholder*="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
    ];

    let emailSelector: string | null = null;
    for (const selector of emailSelectors) {
      const el = await page.$(selector);
      if (el) {
        emailSelector = selector;
        console.log(`Found email field with selector: ${selector}`);
        break;
      }
    }

    if (!emailSelector) {
      // Try to find by visible text/label
      const firstInput = await page.$('input:visible');
      if (firstInput) {
        emailSelector = 'input:visible >> nth=0';
        console.log('Using first visible input for email');
      } else {
        console.error('Could not find email field');
        return false;
      }
    }

    await page.fill(emailSelector, CREDENTIALS.email);
    await humanDelay(800, 1500);

    // Move mouse before password field
    await randomMouseMove(page);

    // Find and fill password field with expanded selectors
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password',
      'input[id*="password" i]',
      'input[autocomplete="current-password"]',
    ];

    let passwordSelector: string | null = null;
    for (const selector of passwordSelectors) {
      const el = await page.$(selector);
      if (el) {
        passwordSelector = selector;
        console.log(`Found password field with selector: ${selector}`);
        break;
      }
    }

    if (!passwordSelector) {
      console.error('Could not find password field');
      return false;
    }

    await page.fill(passwordSelector, CREDENTIALS.password);
    await humanDelay(1000, 2000);

    // Move mouse to submit button area
    await randomMouseMove(page);
    await humanDelay(500, 1000);

    // Click login button - expanded selectors
    const submitSelectors = [
      'button:text-is("Sign In")',  // Exact match for ICSC
      'button:has-text("Sign In")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Submit")',
      '.login-button',
      '#login-submit',
      'form button',
    ];

    let clicked = false;
    for (const selector of submitSelectors) {
      try {
        const button = await page.$(selector);
        if (button && await button.isVisible()) {
          console.log(`Clicking submit button with selector: ${selector}`);
          await button.click();
          clicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!clicked) {
      // Try pressing Enter
      console.log('No submit button found, pressing Enter');
      await page.keyboard.press('Enter');
    }

    console.log('Submitted login, waiting for response...');
    await humanDelay(3000, 5000);

    // Wait for login to complete
    const maxWait = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check URL change or logged-in indicators
      const currentUrl = page.url();
      const isLoggedIn = await page.evaluate(() => {
        const logoutLink = document.querySelector('a[href*="logout"]');
        const userMenu = document.querySelector('[class*="user-menu"], [class*="account"], [class*="profile"]');
        const dashboardEl = document.querySelector('[class*="dashboard"], [class*="member"]');
        const loginError = document.querySelector('[class*="error"], .alert-danger');

        if (loginError && loginError.textContent?.toLowerCase().includes('invalid')) {
          return 'error';
        }

        return !!(logoutLink || userMenu || dashboardEl);
      });

      if (isLoggedIn === 'error') {
        console.error('Login failed - invalid credentials');
        return false;
      }

      if (isLoggedIn === true || !currentUrl.includes('/login')) {
        console.log('Login successful!\n');
        return true;
      }

      await delay(1000);
    }

    // Check if we're still on login page
    if (page.url().includes('/login')) {
      console.error('Login may have failed - still on login page');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Login error:', error);
    return false;
  }
}

// =============================================================================
// Scraping Functions
// =============================================================================

async function getTotalPages(page: Page): Promise<number> {
  // Look for pagination info
  const totalPages = await page.evaluate(() => {
    // Look for pagination text - visible at bottom of results
    // The ICSC site shows "1 of 47" style pagination
    const allText = document.body.innerText;

    // Pattern: exact "X of Y" in pagination area (exclude things like "1 of 1000" which is results count)
    // Look specifically for the pagination text pattern
    const paginationMatches = allText.match(/\b(\d{1,3})\s+of\s+(\d{1,3})\b/g);
    if (paginationMatches) {
      // The page count should be in a reasonable range (1-500 pages)
      for (const match of paginationMatches) {
        const parts = match.match(/(\d+)\s+of\s+(\d+)/);
        if (parts) {
          const total = parseInt(parts[2], 10);
          if (total > 1 && total < 500) {
            return total;
          }
        }
      }
    }

    // Pattern: "Displaying 1-24 of 1,000" or "1-24 of 1000"
    const displayingMatch = allText.match(/(\d+)[-–](\d+)\s+of\s+([\d,]+)/);
    if (displayingMatch) {
      const perPage = parseInt(displayingMatch[2], 10) - parseInt(displayingMatch[1], 10) + 1;
      const total = parseInt(displayingMatch[3].replace(/,/g, ''), 10);
      return Math.ceil(total / perPage);
    }

    // Pattern: "Filter Results (1,000+)"
    const filterMatch = allText.match(/Filter Results\s*\(([\d,]+)\+?\)/i);
    if (filterMatch) {
      const total = parseInt(filterMatch[1].replace(/,/g, ''), 10);
      return Math.ceil(total / 24);
    }

    // Look for numbered pagination links
    const allLinks = document.querySelectorAll('a');
    let maxPage = 1;
    allLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const pageMatch = href.match(/page=(\d+)/);
      if (pageMatch) {
        const pageNum = parseInt(pageMatch[1], 10);
        if (pageNum > maxPage && pageNum < 500) maxPage = pageNum;
      }
    });

    return maxPage > 1 ? maxPage : 47; // Default to 47 as seen in screenshot
  });

  return totalPages || 47; // Default based on what we saw
}

async function scrapeMembersFromPage(page: Page): Promise<ICSCMember[]> {
  await delay(2000); // Wait for content to load

  const members = await page.evaluate(() => {
    const results: Array<{
      name: string;
      company: string;
      title: string;
      phone: string;
      email: string;
      location: string;
      businessType: string;
      profileUrl: string;
    }> = [];

    // Find all member profile links (exclude company profiles and utility links)
    const memberLinks = Array.from(document.querySelectorAll('a[href*="/member/profile/"]'))
      .filter(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent?.trim() || '';
        // Filter out non-member links
        return href.includes('/member/profile/') &&
               !text.toLowerCase().includes('sign out') &&
               !text.toLowerCase().includes('logout') &&
               !text.toLowerCase().includes('sign in') &&
               text.length > 2;
      }) as HTMLAnchorElement[];

    // Process each member link
    const seenProfiles = new Set<string>();

    memberLinks.forEach(link => {
      const profileUrl = link.href;

      // Skip duplicates
      if (seenProfiles.has(profileUrl)) return;
      seenProfiles.add(profileUrl);

      // Get name from the link text
      const name = link.textContent?.trim() || '';
      if (!name || name.length < 2) return;

      // Find the parent container that holds all member info
      // Walk up to find a reasonable container
      let container: Element | null = link;
      for (let i = 0; i < 5; i++) {
        const parent = container?.parentElement;
        if (parent && parent.textContent && parent.textContent.length > name.length + 20) {
          container = parent;
        } else {
          break;
        }
      }

      // Get all text lines in the container
      const containerText = container?.textContent || '';
      const lines = containerText.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l !== name);

      // Try to find company link nearby
      let company = '';
      const companyLink = container?.querySelector('a[href*="/company/profile/"]');
      if (companyLink) {
        company = companyLink.textContent?.trim().replace(/\s*\(Owner\/Developer\)/i, '') || '';
      }

      // Title is usually right after the name
      let title = '';
      const nameIndex = lines.indexOf(name);
      if (nameIndex >= 0 && nameIndex + 1 < lines.length) {
        const nextLine = lines[nameIndex + 1];
        // Title is usually short, like "CEO", "President", "Developer"
        if (nextLine.length < 50 && !nextLine.includes(',')) {
          title = nextLine;
        }
      }
      // If no title found, look for common titles
      if (!title) {
        for (const line of lines) {
          if (/^(CEO|President|Vice President|VP|Director|Manager|Developer|Owner|Partner|Principal|Chairman|Founder)/i.test(line)) {
            title = line;
            break;
          }
        }
      }

      // Location - look for "City, STATE, USA" pattern and extract clean version
      let location = '';
      const containerTextFull = container?.textContent || '';
      const locationMatch = containerTextFull.match(/([A-Z][a-zA-Z\s]+),\s*([A-Z][a-z]+|\b[A-Z]{2}\b),?\s*(?:USA?|US)?/);
      if (locationMatch) {
        location = `${locationMatch[1].trim()}, ${locationMatch[2].trim()}`;
      }

      // Business type
      let businessType = 'Owner/Developer';
      if (containerText.includes('Owner/Developer')) {
        businessType = 'Owner/Developer';
      }

      results.push({
        name,
        company,
        title,
        phone: '', // Will get from profile page
        email: '', // Will get from profile page
        location,
        businessType,
        profileUrl,
      });
    });

    return results;
  });

  // Add timestamp
  return members.map(m => ({
    ...m,
    scrapedAt: new Date().toISOString(),
  }));
}

async function scrapeProfilePage(page: Page, profileUrl: string, retries: number = 2): Promise<Partial<ICSCMember>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(1000, 2000);

      const details = await page.evaluate(() => {
        const data: { phone?: string; email?: string; company?: string; title?: string; location?: string } = {};

        // Phone - look for tel: links
        const phoneLink = document.querySelector('a[href^="tel:"]');
        if (phoneLink) {
          data.phone = phoneLink.getAttribute('href')?.replace('tel:', '').replace(/^\+1/, '').trim() || '';
        }

        // Email - look for mailto: links
        const emailLink = document.querySelector('a[href^="mailto:"]');
        if (emailLink) {
          data.email = emailLink.getAttribute('href')?.replace('mailto:', '').trim() || '';
        }

        // If no mailto link, look for email pattern in page text
        if (!data.email) {
          const pageText = document.body.innerText;
          // More specific email pattern
          const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch && !emailMatch[0].includes('icsc.com')) {
            data.email = emailMatch[0];
          }
        }

        // If no tel link, look for phone pattern
        if (!data.phone) {
          const pageText = document.body.innerText;
          // US phone patterns - be more specific
          const phoneMatch = pageText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
          if (phoneMatch) {
            data.phone = phoneMatch[0];
          }
        }

        // Company - look for company link
        const companyLink = document.querySelector('a[href*="/company/profile/"]');
        if (companyLink) {
          data.company = companyLink.textContent?.trim().replace(/\s*\(Owner\/Developer\)/i, '') || '';
        }

        // Title - look for the title/role text
        // Usually appears after the name in the profile header
        const headerText = document.body.innerText;
        const titlePatterns = [
          /(?:President|CEO|Founder|Owner|Principal|Partner|Director|Manager|VP|Vice President|Developer|Chairman|Managing|Executive)[^,\n]*/i
        ];
        for (const pattern of titlePatterns) {
          const match = headerText.match(pattern);
          if (match) {
            data.title = match[0].trim();
            break;
          }
        }

        // Location - extract clean city, state
        const locationMatch = headerText.match(/([A-Z][a-zA-Z\s]+),\s*([A-Z][a-z]+|\b[A-Z]{2}\b),?\s*(?:USA?|United States)?/);
        if (locationMatch) {
          data.location = `${locationMatch[1].trim()}, ${locationMatch[2].trim()}`;
        }

        return data;
      });

      return details;
    } catch (error) {
      if (attempt < retries) {
        await delay(2000 * attempt);
        continue;
      }
      console.error(`    Error scraping profile: ${error}`);
      return {};
    }
  }
  return {};
}

async function goToPage(page: Page, pageNum: number, retries: number = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Try clicking pagination if available (more human-like)
      try {
        const nextButton = await page.$(`a[href*="page=${pageNum}"], .ais-Pagination-item a:has-text("${pageNum}")`);
        if (nextButton && await nextButton.isVisible()) {
          await randomMouseMove(page);
          await humanDelay(300, 600);
          await nextButton.click();
          await humanDelay(3000, 4000);
          return;
        }
      } catch {
        // Fall back to direct navigation
      }

      // Direct URL navigation as fallback
      const url = SEARCH_URL.replace('page=1', `page=${pageNum}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(3000, 4000);
      return;
    } catch (error) {
      console.log(`  Page navigation failed (attempt ${attempt}/${retries}): ${error}`);
      if (attempt < retries) {
        const waitTime = 5000 * attempt;
        console.log(`  Waiting ${waitTime / 1000}s before retry...`);
        await delay(waitTime);
      } else {
        throw error;
      }
    }
  }
}

// =============================================================================
// Output Functions
// =============================================================================

function saveJson(members: ICSCMember[], outputPath: string): void {
  const output = {
    scrapedAt: new Date().toISOString(),
    source: 'https://www.icsc.com',
    filter: 'Owner/Developer',
    count: members.length,
    members,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
}

function saveCsv(members: ICSCMember[], outputPath: string): void {
  const headers = ['Name', 'Company', 'Title', 'Phone', 'Email', 'Location', 'Business Type', 'Profile URL', 'Scraped At'];

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
    escapeCsv(m.businessType),
    escapeCsv(m.profileUrl),
    m.scrapedAt,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const startPageIndex = args.indexOf('--start-page');
  let startPage = startPageIndex !== -1 ? parseInt(args[startPageIndex + 1], 10) : 1;
  const scrapeProfiles = !args.includes('--no-profiles'); // Scrape profiles by default to get email/phone

  console.log('\n' + '='.repeat(60));
  console.log('ICSC Member Directory Scraper');
  console.log('='.repeat(60));
  console.log('Target: Owner/Developer members');
  console.log(`Starting from page: ${startPage}`);
  console.log();

  ensureOutputDir();

  // Load previous progress if resuming
  let progress = loadProgress();
  let allMembers: ICSCMember[] = [];

  if (progress && startPage === 1) {
    console.log(`Found previous progress: ${progress.members.length} members from ${progress.lastPage} pages`);
    allMembers = progress.members;
    startPage = progress.lastPage + 1;
  }

  // Launch browser with stealth settings
  const browser: Browser = await chromium.launch({
    headless: false, // Keep visible to appear more human
    slowMo: 50,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });

  // Create context with realistic fingerprint
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.0060 }, // NYC
    permissions: ['geolocation'],
    colorScheme: 'light',
  });

  // Remove webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page: Page = await context.newPage();

  try {
    // Perform automated login
    const loggedIn = await performLogin(page);
    if (!loggedIn) {
      console.log('Login failed. Exiting.');
      return;
    }

    // Navigate to search results
    console.log('Navigating to member search...');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for AJAX/dynamic content to load
    console.log('Waiting for search results to load...');
    await delay(5000);

    // Get total pages
    const totalPages = await getTotalPages(page);
    console.log(`Found approximately ${totalPages} pages of results`);

    // Scrape each page
    for (let pageNum = startPage; pageNum <= totalPages; pageNum++) {
      console.log(`\n[Page ${pageNum}/${totalPages}]`);

      if (pageNum !== startPage || startPage !== 1) {
        await goToPage(page, pageNum);
      }

      const pageMembers = await scrapeMembersFromPage(page);
      console.log(`  Found ${pageMembers.length} members on this page`);

      // Optionally scrape individual profile pages for more details
      if (scrapeProfiles) {
        for (let i = 0; i < pageMembers.length; i++) {
          const member = pageMembers[i];
          if (member.profileUrl && (!member.email || !member.phone)) {
            console.log(`  Scraping profile ${i + 1}/${pageMembers.length}: ${member.name}`);
            const details = await scrapeProfilePage(page, member.profileUrl);
            if (details.email) member.email = details.email;
            if (details.phone) member.phone = details.phone;
            await delay(500);
          }
        }
        // Go back to search results
        await goToPage(page, pageNum);
      }

      allMembers.push(...pageMembers);

      // Save progress after each page
      progress = {
        lastPage: pageNum,
        totalPages,
        members: allMembers,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);
      console.log(`  Total members so far: ${allMembers.length}`);

      // Human-like behavior between pages
      await randomMouseMove(page);
      await humanScroll(page);

      // Variable rate limiting to avoid detection (2-5 seconds between pages)
      const waitTime = 2000 + Math.random() * 3000;
      console.log(`  Waiting ${(waitTime / 1000).toFixed(1)}s before next page...`);
      await delay(waitTime);

      // Occasionally take a longer break (every 10 pages)
      if (pageNum % 10 === 0 && pageNum < totalPages) {
        const breakTime = 5000 + Math.random() * 5000;
        console.log(`  Taking a short break (${(breakTime / 1000).toFixed(1)}s)...`);
        await delay(breakTime);
      }
    }

    // Deduplicate by name + company
    const seen = new Set<string>();
    const uniqueMembers = allMembers.filter(m => {
      const key = `${m.name}|${m.company}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Save final output
    const timestamp = new Date().toISOString().split('T')[0];
    const jsonPath = path.join(OUTPUT_DIR, `icsc-members-${timestamp}.json`);
    const csvPath = path.join(OUTPUT_DIR, `icsc-members-${timestamp}.csv`);

    saveJson(uniqueMembers, jsonPath);
    saveCsv(uniqueMembers, csvPath);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Scrape Complete!');
    console.log('='.repeat(60));
    console.log(`Total members scraped: ${allMembers.length}`);
    console.log(`Unique members: ${uniqueMembers.length}`);
    console.log(`\nOutput saved:`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  CSV: ${csvPath}`);

    // Sample output
    console.log('\n' + '='.repeat(60));
    console.log('Sample Results (first 5)');
    console.log('='.repeat(60));
    for (const m of uniqueMembers.slice(0, 5)) {
      console.log(`\n${m.name}`);
      console.log(`  Company: ${m.company || 'N/A'}`);
      console.log(`  Phone: ${m.phone || 'N/A'}`);
      console.log(`  Email: ${m.email || 'N/A'}`);
      console.log(`  Location: ${m.location || 'N/A'}`);
    }

  } catch (error) {
    console.error('\nError during scrape:', error);

    // Save whatever we have
    if (allMembers.length > 0) {
      const timestamp = new Date().toISOString().split('T')[0];
      const jsonPath = path.join(OUTPUT_DIR, `icsc-members-partial-${timestamp}.json`);
      saveJson(allMembers, jsonPath);
      console.log(`\nPartial results saved to: ${jsonPath}`);
    }
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }
}

main().catch(console.error);
