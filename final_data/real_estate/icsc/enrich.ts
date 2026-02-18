/**
 * ICSC Profile Enrichment Script
 *
 * Enriches existing leads.jsonl records with phone, email, title, and address
 * by visiting individual member profile pages.
 *
 * Usage:
 *   npx tsx enrich.ts              # Run full enrichment (resumes from checkpoint)
 *   npx tsx enrich.ts --limit 10   # Enrich only 10 profiles (for testing)
 *   npx tsx enrich.ts --retry       # Re-scrape profiles that have empty data
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir as ensureOutputDirLib,
} from "../../../lib/source-config";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const CREDENTIALS = {
  email: process.env.ICSC_EMAIL || '',
  password: process.env.ICSC_PASSWORD || '',
};

if (!CREDENTIALS.email || !CREDENTIALS.password) {
  console.error('ERROR: ICSC credentials not found. Set ICSC_EMAIL and ICSC_PASSWORD in .env or .env.local');
  process.exit(1);
}

// =============================================================================
// Config
// =============================================================================

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);
const PROGRESS_FILE = path.join(paths.outputDir, 'enrich-progress.json');
const ENRICHED_FILE = path.join(paths.outputDir, 'enriched-data.json');
const BASE_URL = 'https://www.icsc.com';

const BROWSER_RESTART_EVERY = 200;
const BREAK_EVERY = 50;
const BREAK_DURATION_MIN = 15000;
const BREAK_DURATION_MAX = 30000;
const PAGE_DELAY_MIN = 3000;
const PAGE_DELAY_MAX = 5000;
const RENDER_WAIT = 5000;

// =============================================================================
// Types
// =============================================================================

interface EnrichProgress {
  completedIds: string[];
  enrichedData: Record<string, EnrichedFields>;
  lastUpdated: string;
}

interface EnrichedFields {
  phone?: string;
  email?: string;
  title?: string;
  city?: string;
  state?: string;
  address?: string;
  zip?: string;
  country?: string;
}

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min: number, max: number): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

function loadProgress(): EnrichProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch {
      // corrupted, start fresh
    }
  }
  return { completedIds: [], enrichedData: {}, lastUpdated: '' };
}

function saveProgress(progress: EnrichProgress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function loadLeads(): Array<{ profileId: string; record: Record<string, unknown> }> {
  const content = fs.readFileSync(paths.leadsFile, 'utf-8').trim();
  return content.split('\n').map(line => {
    const record = JSON.parse(line);
    const profileId = (record.context as Record<string, string>)?.profile_id || '';
    return { profileId, record };
  });
}

// =============================================================================
// Login
// =============================================================================

async function performLogin(page: Page): Promise<boolean> {
  console.log('Logging in...');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(5000);
    console.log('  Login page loaded:', page.url());

    // Dismiss privacy banner
    try {
      const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Reject All")');
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch {}

    // Try multiple selector strategies for the login form
    const emailInput = await page.$('input[name="username"]') || await page.$('input[type="text"]') || await page.$('input[type="email"]');
    const passwordInput = await page.$('input[name="password"]') || await page.$('input[type="password"]');

    if (!emailInput || !passwordInput) {
      console.error('Login form not found. Page URL:', page.url());
      // Take screenshot for debugging
      await page.screenshot({ path: path.join(paths.outputDir, 'login-debug.png') });
      console.error('Screenshot saved to output/login-debug.png');
      return false;
    }

    console.log('  Found login form, filling credentials...');
    await emailInput.fill(CREDENTIALS.email);
    await humanDelay(500, 1000);
    await passwordInput.fill(CREDENTIALS.password);
    await humanDelay(500, 1000);

    console.log('  Clicking Sign In...');
    const signInBtn = await page.$('button:text-is("Sign In")') || await page.$('button[type="submit"]');
    if (signInBtn) {
      await signInBtn.click();
    } else {
      console.log('  No Sign In button found, pressing Enter...');
      await page.keyboard.press('Enter');
    }
    await delay(8000);

    const url = page.url();
    console.log('  Post-login URL:', url);
    if (!url.includes('/login')) {
      console.log('Login successful!\n');
      return true;
    }
    // Check for error message
    const errorMsg = await page.evaluate(() => {
      const err = document.querySelector('[class*="error"], [class*="alert"]');
      return err?.textContent?.trim() || '';
    });
    if (errorMsg) console.error('  Login error message:', errorMsg);
    await page.screenshot({ path: path.join(paths.outputDir, 'login-failed.png') });
    console.error('Login failed - screenshot saved');
    return false;
  } catch (error) {
    console.error('Login error:', error);
    return false;
  }
}

// =============================================================================
// Profile Scraping
// =============================================================================

let emailLimitHit = false;

async function scrapeProfile(page: Page, profileId: string): Promise<EnrichedFields> {
  const result: EnrichedFields = {};

  try {
    await page.goto(`${BASE_URL}/member/profile/${profileId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await delay(RENDER_WAIT);

    // Dismiss any modals by removing them from DOM
    await page.evaluate(() => {
      document.querySelectorAll('.ReactModalPortal').forEach(m => m.remove());
    });
    await delay(500);

    // Extract all data from the profile page
    const data = await page.evaluate(() => {
      const info: Record<string, string> = {};

      // Phone
      const phoneLink = document.querySelector('a[href^="tel:"]');
      if (phoneLink) {
        info.phone = phoneLink.getAttribute('href')?.replace('tel:', '').trim() || '';
      }

      // Email (might already be visible as mailto link)
      const emailLink = document.querySelector('a[href^="mailto:"]');
      if (emailLink) {
        info.email = emailLink.getAttribute('href')?.replace('mailto:', '').trim() || '';
      }

      // Title - look in the profile card header area
      const profileSection = document.querySelector('[class*="MemberProfile__SectionContainer"]');
      if (profileSection) {
        const headingArea = profileSection.querySelector('h4');
        if (headingArea) {
          const spans = headingArea.querySelectorAll('span, div');
          for (const span of spans) {
            const text = span.textContent?.trim() || '';
            if (text && !text.includes(',') && !text.includes('Owner/Developer') &&
                !text.includes('Broker') && !text.includes('Retailer') &&
                text.length < 100 && text.length > 1) {
              const titlePatterns = /^(.*(?:President|CEO|CFO|COO|CIO|CTO|Founder|Co-Founder|Owner|Principal|Partner|Director|VP|Vice|Chairman|Manager|Developer|Analyst|Associate|Broker|Agent|Officer|Head|Lead|Chief|Senior|SVP|EVP|Managing|Executive|Superintendent|Counsel|Attorney|Advisor|Consultant|Supervisor|Coordinator|Specialist|Planner|Administrator).*)/i;
              if (titlePatterns.test(text)) {
                info.title = text;
                break;
              }
            }
          }
        }
      }

      // Fallback title extraction from body text
      if (!info.title) {
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === 'Owner/Developer' || lines[i] === 'Broker' || lines[i] === 'Retailer/Tenant') {
            if (i >= 2) {
              const titleCandidate = lines[i - 3];
              if (titleCandidate && titleCandidate.length < 100 && !titleCandidate.includes('@')) {
                info.title = titleCandidate;
              }
            }
          }
        }
      }

      // Address - preserve line breaks so we can split street from city
      const bodyText = document.body.innerText;
      const addressMatch = bodyText.match(/Address:\s*\n([\s\S]*?)(?:\n\s*View Map|\n\s*Send a Message)/);
      if (addressMatch) {
        const rawAddr = addressMatch[1].trim();
        const lines = rawAddr.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length >= 2) {
          // Last line is "City, ST ZIP" or "City, ST ZIP Country"
          info.cityStateLine = lines[lines.length - 1];
          // Everything before is street address
          info.streetAddress = lines.slice(0, -1).join(', ');
        } else if (lines.length === 1) {
          info.fullAddress = lines[0];
        }
      }

      // Fallback: single-line address
      if (!info.streetAddress && !info.fullAddress) {
        const addrFallback = bodyText.match(/Address:\s*([\s\S]*?)(?:View Map|Send a Message)/);
        if (addrFallback) {
          info.fullAddress = addrFallback[1].replace(/\n/g, ' ').trim();
        }
      }

      return info;
    });

    // Assign extracted data
    if (data.phone) result.phone = data.phone;
    if (data.title) result.title = data.title;

    // Parse address into components
    if (data.cityStateLine) {
      // Parse "City, ST ZIP" from the last line
      const cszMatch = data.cityStateLine.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)(?:\s+(.+))?$/);
      if (cszMatch) {
        result.address = data.streetAddress || '';
        result.city = cszMatch[1].trim();
        result.state = cszMatch[2];
        result.zip = cszMatch[3];
        result.country = cszMatch[4]?.trim() || 'US';
      } else {
        // City line didn't match expected pattern, store raw
        result.address = [data.streetAddress, data.cityStateLine].filter(Boolean).join(', ');
      }
    } else if (data.fullAddress) {
      result.address = data.fullAddress;
    }

    // Try to get email (skip if daily limit already hit)
    if (!data.email && !emailLimitHit) {
      try {
        const hasRevealLink = await page.evaluate(() => {
          return !!Array.from(document.querySelectorAll('a')).find(a =>
            a.textContent?.toLowerCase().includes('click here to display email')
          );
        });

        if (hasRevealLink) {
          // Set up network listener BEFORE clicking
          const responsePromise = page.waitForResponse(
            resp => resp.url().includes('emaillookup') || resp.url().includes('graph.icsc.com'),
            { timeout: 8000 }
          ).catch(() => null);

          // Click the reveal link via dispatchEvent (bypasses overlays)
          await page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(a =>
              a.textContent?.toLowerCase().includes('click here to display email')
            );
            if (link) {
              link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          });

          const apiResponse = await responsePromise;
          if (apiResponse) {
            try {
              const responseBody = await apiResponse.text();
              // Check for daily limit error
              if (responseBody.includes('Exceeded daily email lookups')) {
                emailLimitHit = true;
                console.log(`    *** Daily email lookup limit reached. Skipping email for remaining profiles. ***`);
              } else {
                const emailMatch = responseBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (emailMatch) {
                  result.email = emailMatch[0];
                }
              }
            } catch {}
          }

          // Fallback: check the DOM
          if (!result.email && !emailLimitHit) {
            await delay(2000);
            const email = await page.evaluate(() => {
              const mailtoEl = document.querySelector('a[href^="mailto:"]');
              if (mailtoEl) return mailtoEl.getAttribute('href')?.replace('mailto:', '').trim() || '';
              const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
              const match = document.body.innerText.match(pattern);
              return match ? match[0] : '';
            });
            if (email) result.email = email;
          }
        }
      } catch (e) {
        // Email extraction failed silently
      }
    } else {
      result.email = data.email;
    }

  } catch (error) {
    console.error(`  Error scraping profile ${profileId}:`, error instanceof Error ? error.message : error);
  }

  return result;
}

// =============================================================================
// Browser Management
// =============================================================================

async function createBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  return { browser, context, page };
}

// =============================================================================
// Merge enriched data back into leads.jsonl
// =============================================================================

function mergeAndSave(progress: EnrichProgress): void {
  console.log('\nMerging enriched data into leads.jsonl...');

  const leads = loadLeads();
  let enrichedCount = 0;
  let phoneCount = 0;
  let emailCount = 0;
  let titleCount = 0;

  const updatedRecords = leads.map(({ profileId, record }) => {
    const enriched = progress.enrichedData[profileId];
    if (!enriched) return record;

    enrichedCount++;
    const person = record.person as Record<string, unknown> || {};
    const contact = record.contact as Record<string, unknown> || {};
    const location = (person.location as Record<string, unknown>) || {};

    // Update contact
    if (enriched.phone) {
      contact.phone = enriched.phone;
      phoneCount++;
    }
    if (enriched.email) {
      contact.email = enriched.email;
      emailCount++;
    }
    record.contact = contact;

    // Update person
    if (enriched.title) {
      person.title = enriched.title;
      titleCount++;
    }
    if (enriched.city) location.city = enriched.city;
    if (enriched.state) location.state = enriched.state;
    if (enriched.address) location.address = enriched.address;
    if (enriched.zip) location.zip = enriched.zip;
    if (enriched.country) location.country = enriched.country;
    person.location = location;
    record.person = person;

    // Update scraped_at
    (record.core as Record<string, unknown>).scraped_at = new Date().toISOString();

    return record;
  });

  // Write updated leads.jsonl
  const output = updatedRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(paths.leadsFile, output);

  // Write run.json
  const runData = {
    source_id: config.source_id,
    run_id: `run_${Date.now()}`,
    started_at: progress.lastUpdated,
    ended_at: new Date().toISOString(),
    records_found: leads.length,
    records_valid: leads.length,
    records_written: leads.length,
    error_count: 0,
    enrichment: {
      profiles_visited: progress.completedIds.length,
      with_phone: phoneCount,
      with_email: emailCount,
      with_title: titleCount,
    },
  };
  fs.writeFileSync(paths.runFile, JSON.stringify(runData, null, 2));

  updateDataAsOf(__dirname);

  console.log(`Enrichment complete:`);
  console.log(`  Profiles enriched: ${enrichedCount}`);
  console.log(`  With phone: ${phoneCount} (${(phoneCount / leads.length * 100).toFixed(1)}%)`);
  console.log(`  With email: ${emailCount} (${(emailCount / leads.length * 100).toFixed(1)}%)`);
  console.log(`  With title: ${titleCount} (${(titleCount / leads.length * 100).toFixed(1)}%)`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const retryMode = args.includes('--retry');

  console.log('\n' + '='.repeat(60));
  console.log('ICSC Profile Enrichment');
  console.log('='.repeat(60));

  ensureOutputDirLib(__dirname);

  // Load existing leads and progress
  const leads = loadLeads();
  const progress = loadProgress();

  // In retry mode, remove profiles with empty data from completedIds
  if (retryMode) {
    const emptyIds = Object.entries(progress.enrichedData)
      .filter(([, v]) => !v.phone && !v.title && !v.email && !v.city)
      .map(([k]) => k);
    console.log(`Retry mode: removing ${emptyIds.length} empty profiles from completed list`);
    const emptySet = new Set(emptyIds);
    progress.completedIds = progress.completedIds.filter(id => !emptySet.has(id));
    for (const id of emptyIds) {
      delete progress.enrichedData[id];
    }
    saveProgress(progress);
  }

  const completedSet = new Set(progress.completedIds);

  console.log(`Total leads: ${leads.length}`);
  console.log(`Already enriched: ${completedSet.size}`);

  // Filter to un-enriched profiles
  const remaining = leads
    .filter(l => l.profileId && !completedSet.has(l.profileId))
    .slice(0, limit);

  console.log(`Remaining to enrich: ${remaining.length}`);
  if (remaining.length === 0) {
    console.log('Nothing to do! All profiles already enriched.');
    mergeAndSave(progress);
    return;
  }

  // Launch browser and login
  let { browser, context, page } = await createBrowser();
  const loggedIn = await performLogin(page);
  if (!loggedIn) {
    console.error('Login failed. Exiting.');
    await browser.close();
    return;
  }

  let profilesSinceRestart = 0;

  try {
    for (let i = 0; i < remaining.length; i++) {
      const { profileId } = remaining[i];
      const overallIdx = completedSet.size + i + 1;

      console.log(`[${overallIdx}/${leads.length}] Scraping profile ${profileId}...`);

      // Scrape the profile
      const enriched = await scrapeProfile(page, profileId);

      // Save results
      progress.enrichedData[profileId] = enriched;
      progress.completedIds.push(profileId);
      completedSet.add(profileId);

      const parts = [];
      if (enriched.phone) parts.push(`phone: ${enriched.phone}`);
      if (enriched.email) parts.push(`email: ${enriched.email}`);
      if (enriched.title) parts.push(`title: ${enriched.title}`);
      console.log(`  ${parts.length > 0 ? parts.join(', ') : '(no contact data found)'}`);

      // Save progress after each profile
      saveProgress(progress);
      profilesSinceRestart++;

      // Rate limiting delay
      await humanDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX);

      // Periodic break
      if ((i + 1) % BREAK_EVERY === 0 && i < remaining.length - 1) {
        const breakTime = BREAK_DURATION_MIN + Math.random() * (BREAK_DURATION_MAX - BREAK_DURATION_MIN);
        console.log(`\n  Taking a break (${(breakTime / 1000).toFixed(0)}s)...\n`);
        await delay(breakTime);
      }

      // Browser restart to prevent detection / memory leaks
      if (profilesSinceRestart >= BROWSER_RESTART_EVERY && i < remaining.length - 1) {
        console.log('\n  Restarting browser...');
        await browser.close();
        ({ browser, context, page } = await createBrowser());
        const relogged = await performLogin(page);
        if (!relogged) {
          console.error('Re-login failed after browser restart. Saving progress and exiting.');
          break;
        }
        profilesSinceRestart = 0;
      }
    }
  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }

  // Merge enriched data into leads.jsonl
  mergeAndSave(progress);

  console.log('\n' + '='.repeat(60));
  console.log('ENRICHMENT COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
