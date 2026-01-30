/**
 * Quick test script to verify the Skadden scraper works
 * Scrapes 5 profiles from letter "A" as a test
 *
 * Usage: npx tsx test-suite/scraper/test-scraper.ts
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://www.skadden.com';
const OUTPUT_DIR = path.join(__dirname, 'output');

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

async function scrapeProfilePage(page: Page, profileUrl: string): Promise<Record<string, unknown> | null> {
  try {
    console.log(`  Navigating to: ${profileUrl}`);
    await page.goto(profileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await dismissCookieDialog(page);
    await delay(1000);

    // Wait for main content
    await page.waitForSelector('h1', { timeout: 10000 });

    const profile: Record<string, unknown> = {
      profileUrl,
      scrapedAt: new Date().toISOString()
    };

    // Name - from h1
    const nameEl = await page.locator('h1').first();
    profile.name = (await nameEl.textContent())?.trim() || '';

    // Photo URL - look for profile image
    const photoImg = page.locator('img[src*="professional"], .professional-image img, [class*="profile"] img').first();
    const photoSrc = await photoImg.getAttribute('src').catch(() => null);
    if (photoSrc) {
      profile.photoUrl = photoSrc.startsWith('http') ? photoSrc : `${BASE_URL}${photoSrc}`;
    }

    // Email
    const emailLink = page.locator('a[href^="mailto:"]').first();
    const emailHref = await emailLink.getAttribute('href').catch(() => null);
    if (emailHref) {
      profile.email = emailHref.replace('mailto:', '');
    }

    // Phone
    const phoneLink = page.locator('a[href^="tel:"]').first();
    const phoneHref = await phoneLink.getAttribute('href').catch(() => null);
    if (phoneHref) {
      profile.phone = phoneHref.replace('tel:', '').replace(/^\+/, '');
    }

    // Office locations
    const officeLinks = await page.locator('a[href*="/locations/"]').all();
    const offices: string[] = [];
    for (const link of officeLinks) {
      const text = await link.textContent();
      if (text && !offices.includes(text.trim())) {
        offices.push(text.trim());
      }
    }
    profile.offices = offices;

    // Practice areas from links
    const practiceLinks = await page.locator('a[href*="/practices/"]').all();
    const practiceAreas: string[] = [];
    for (const link of practiceLinks) {
      const text = await link.textContent();
      if (text && !practiceAreas.includes(text.trim())) {
        practiceAreas.push(text.trim());
      }
    }
    profile.practiceAreas = practiceAreas;

    // Get page HTML for text extraction
    const mainContent = page.locator('main, article, .content').first();
    const htmlContent = await mainContent.innerHTML().catch(() => '');

    // Extract sections using regex
    const extractSection = (html: string, sectionName: string): string[] => {
      const regex = new RegExp(`${sectionName}[^<]*</[^>]+>\\s*<(?:ul|div)[^>]*>([\\s\\S]*?)</(?:ul|div)>`, 'i');
      const match = html.match(regex);
      if (match) {
        const items = match[1].match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/li>/gi) || [];
        return items.map(item => item.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
      }
      return [];
    };

    profile.education = extractSection(htmlContent, 'Education');
    profile.barAdmissions = extractSection(htmlContent, 'Bar Admissions?');
    profile.affiliations = extractSection(htmlContent, '(?:Professional\\s+)?Affiliations?');
    profile.languages = extractSection(htmlContent, 'Languages?');

    // Biography - get main content paragraph(s)
    const paragraphs = await page.locator('main p, article p, .content p').all();
    const bioTexts: string[] = [];
    for (const p of paragraphs.slice(0, 5)) {
      const text = await p.textContent();
      if (text && text.length > 50) {
        bioTexts.push(text.trim());
      }
    }
    if (bioTexts.length > 0) {
      profile.biography = bioTexts.join('\n\n');
    }

    return profile;
  } catch (error) {
    console.error(`  Error scraping ${profileUrl}: ${error}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Skadden Scraper - Test Run');
  console.log('='.repeat(60));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser: Browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page: Page = await context.newPage();

  try {
    // Navigate directly to letter A results (bypass clicking)
    console.log('\n1. Navigating to professionals page (letter A)...');
    await page.goto(`${BASE_URL}/professionals?skip=0&letter=a&hassearched=true`, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await dismissCookieDialog(page);
    await delay(2000);

    // Wait for results to load
    console.log('2. Waiting for results...');
    await page.waitForSelector('a[href*="/professionals/a/"]', { timeout: 15000 });

    // Get first 5 profile links
    console.log('3. Collecting profile links...');
    const profileLinks = await page.locator('a[href*="/professionals/a/"]').all();
    const urls = new Set<string>();

    for (const link of profileLinks) {
      const href = await link.getAttribute('href');
      if (href && href.match(/\/professionals\/a\/[\w-]+$/) && urls.size < 5) {
        urls.add(`${BASE_URL}${href}`);
      }
    }

    const profileUrls = Array.from(urls);
    console.log(`   Found ${profileUrls.length} profiles to test`);

    // Scrape each profile
    console.log('\n4. Scraping profiles...');
    const profiles: Record<string, unknown>[] = [];

    for (let i = 0; i < profileUrls.length; i++) {
      console.log(`\n[${i + 1}/${profileUrls.length}]`);
      const profile = await scrapeProfilePage(page, profileUrls[i]);
      if (profile) {
        profiles.push(profile);
        console.log(`   Success: ${profile.name}`);
        console.log(`   Email: ${profile.email || 'N/A'}`);
        console.log(`   Phone: ${profile.phone || 'N/A'}`);
        console.log(`   Offices: ${(profile.offices as string[])?.join(', ') || 'N/A'}`);
        console.log(`   Practice Areas: ${((profile.practiceAreas as string[])?.slice(0, 3).join(', ') || 'N/A')}...`);
      }
      await delay(1000);
    }

    // Save results
    const outputFile = path.join(OUTPUT_DIR, 'test-results.json');
    fs.writeFileSync(outputFile, JSON.stringify(profiles, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Test complete!');
    console.log(`Profiles scraped: ${profiles.length}`);
    console.log(`Output saved to: ${outputFile}`);
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
