/**
 * Retry failed URLs from the YC scraper
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, 'output');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-progress.json');
const DELAY_BETWEEN_PROFILES = 2500;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeCompanyPage(page: Page, url: string): Promise<any | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(1500);

    const slug = url.split('/companies/')[1];

    const details = await page.evaluate(() => {
      const result = {
        name: '',
        batch: '',
        status: null as string | null,
        oneLiner: '',
        longDescription: null as string | null,
        industries: [] as string[],
        teamSize: null as string | null,
        location: null as string | null,
        website: null as string | null,
        linkedIn: null as string | null,
        twitter: null as string | null,
        logoUrl: null as string | null,
        founders: [] as { name: string; title: string | null; linkedIn: string | null; twitter: string | null }[]
      };

      const pageText = document.body.innerText || '';

      // Extract batch
      const batchMatch = pageText.match(/Batch:?\s*(Winter|Summer|Spring|Fall)\s*(\d{4})/i);
      if (batchMatch) {
        const season = batchMatch[1].toLowerCase();
        const year = batchMatch[2].slice(-2);
        const seasonCode = season.startsWith('s') ? 'S' : 'W';
        result.batch = `${seasonCode}${year}`;
      }

      if (!result.batch) {
        const shortBatchMatch = pageText.match(/\b([WS]\d{2})\b/);
        if (shortBatchMatch) result.batch = shortBatchMatch[1];
      }

      // Status
      const statusMatch = pageText.match(/Status:?\s*(Active|Acquired|Public|Inactive|Exited)/i);
      if (statusMatch) result.status = statusMatch[1];

      // Team size
      const teamSizeMatch = pageText.match(/Team Size:?\s*(\d[\d,]*)/i);
      if (teamSizeMatch) result.teamSize = teamSizeMatch[1].replace(/,/g, '');

      // Location
      const locationMatch = pageText.match(/Location:?\s*([A-Za-z\s,]+?)(?:\n|Founders)/i);
      if (locationMatch) result.location = locationMatch[1].trim();

      // Long description
      const descMatch = pageText.match(/(?:http[s]?:\/\/[^\s]+)\s*\n([^]+?)(?:\nLatest News|\nJobs at|\nFounded:|\nActive Founders)/i);
      if (descMatch) {
        const desc = descMatch[1].trim();
        if (desc.length > 50 && !desc.startsWith('Founded:')) result.longDescription = desc;
      }

      // Website
      const websiteMatch = pageText.match(/(?:News|Company|Jobs)\s*(?:\d+)?\s*(?:News)?\s*(https?:\/\/(?!www\.ycombinator\.com)[^\s]+)/i);
      if (websiteMatch) result.website = websiteMatch[1];

      // Founders
      const foundersMatch = pageText.match(/(?:Active\s+)?Founders\s*\n([\s\S]*?)(?:\nFooter|\nY Combinator|$)/i);
      if (foundersMatch) {
        const foundersSection = foundersMatch[1];
        const lines = foundersSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const nameMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
          if (nameMatch) {
            const name = nameMatch[1];
            if (name.toLowerCase().includes('footer') || name.toLowerCase().includes('combinator') ||
                name.toLowerCase().includes('latest') || name.toLowerCase().includes('news')) continue;

            let title = 'Founder';
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              if (nextLine.match(/^(Co-?)?Founder|^CEO|^CTO|^COO/i)) {
                title = nextLine;
                i++;
              }
            }

            if (!result.founders.some(f => f.name === name)) {
              result.founders.push({ name, title, linkedIn: null, twitter: null });
            }
          }
        }
      }

      // LinkedIn URLs for founders
      const linkedInLinks = document.querySelectorAll('a[href*="linkedin.com/in"]');
      const linkedInUrls: string[] = [];
      linkedInLinks.forEach(link => {
        const href = (link as HTMLAnchorElement).href;
        if (!linkedInUrls.includes(href)) linkedInUrls.push(href);
      });
      result.founders.forEach((founder, i) => {
        if (i < linkedInUrls.length) founder.linkedIn = linkedInUrls[i];
      });

      // Company LinkedIn
      const companyLinkedIn = document.querySelector('a[href*="linkedin.com/company"]');
      if (companyLinkedIn) result.linkedIn = (companyLinkedIn as HTMLAnchorElement).href;

      // Twitter
      const twitterLink = document.querySelector('a[href*="twitter.com"]:not([href*="/intent/"]), a[href*="x.com"]:not([href*="/intent/"])');
      if (twitterLink) result.twitter = (twitterLink as HTMLAnchorElement).href;

      // Logo
      const logo = document.querySelector('img[src*="bookface-images"], img[src*="logo"]') as HTMLImageElement;
      if (logo) result.logoUrl = logo.src;

      // Name from title
      const titleEl = document.querySelector('title');
      if (titleEl) {
        const titleText = titleEl.textContent || '';
        const nameMatch = titleText.match(/^([^:]+):/);
        if (nameMatch) result.name = nameMatch[1].trim();
      }

      // One-liner from title
      if (titleEl) {
        const titleText = titleEl.textContent || '';
        const oneLineMatch = titleText.match(/:\s*([^|]+)/);
        if (oneLineMatch) result.oneLiner = oneLineMatch[1].trim();
      }

      return result;
    });

    return {
      name: details.name,
      slug,
      profileUrl: url,
      logoUrl: details.logoUrl,
      batch: details.batch,
      status: details.status,
      oneLiner: details.oneLiner,
      longDescription: details.longDescription,
      industries: details.industries,
      tags: [],
      teamSize: details.teamSize,
      founders: details.founders,
      location: details.location,
      regions: [],
      website: details.website,
      linkedIn: details.linkedIn,
      twitter: details.twitter,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`  Error: ${error}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Retrying Failed YC Companies');
  console.log('='.repeat(60));

  // Load progress
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  const failedUrls = progress.failedUrls || [];

  console.log(`\nFound ${failedUrls.length} failed URLs to retry`);

  if (failedUrls.length === 0) {
    console.log('Nothing to retry!');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  const stillFailed: string[] = [];
  let successCount = 0;

  try {
    for (let i = 0; i < failedUrls.length; i++) {
      const url = failedUrls[i];
      const slug = url.split('/companies/')[1];
      console.log(`\n[${i + 1}/${failedUrls.length}] Retrying: ${slug}`);

      const company = await scrapeCompanyPage(page, url);

      if (company) {
        progress.companies.push(company);
        successCount++;
        console.log(`  Success: ${company.batch || 'Unknown batch'} | ${company.founders.map((f: any) => f.name).join(', ') || 'No founders'}`);
      } else {
        stillFailed.push(url);
        console.log(`  Still failed`);
      }

      // Save every 50
      if ((i + 1) % 50 === 0) {
        progress.failedUrls = stillFailed;
        progress.companiesScraped = progress.companies.length;
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        console.log(`\n  [Progress saved: ${progress.companies.length} total, ${stillFailed.length} still failed]`);
      }

      await delay(DELAY_BETWEEN_PROFILES);
    }

    // Final save
    progress.failedUrls = stillFailed;
    progress.companiesScraped = progress.companies.length;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    // Update output files
    const outputFile = path.join(OUTPUT_DIR, 'yc-founders.json');
    fs.writeFileSync(outputFile, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalCompanies: progress.companies.length,
      failedUrls: stillFailed,
      companies: progress.companies
    }, null, 2));

    // CSV
    const csvFile = path.join(OUTPUT_DIR, 'yc-founders.csv');
    const headers = ['Company Name', 'Batch', 'Status', 'One Liner', 'Industries', 'Location', 'Team Size', 'Founders', 'Website', 'LinkedIn', 'Twitter', 'Profile URL'];
    const escapeCSV = (str: string): string => {
      if (str && (str.includes(',') || str.includes('"') || str.includes('\n'))) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str || '';
    };
    const rows = progress.companies.map((c: any) => [
      escapeCSV(c.name), escapeCSV(c.batch), escapeCSV(c.status || ''), escapeCSV(c.oneLiner),
      escapeCSV((c.industries || []).join('; ')), escapeCSV(c.location || ''), escapeCSV(c.teamSize || ''),
      escapeCSV((c.founders || []).map((f: any) => f.name).join('; ')), escapeCSV(c.website || ''),
      escapeCSV(c.linkedIn || ''), escapeCSV(c.twitter || ''), escapeCSV(c.profileUrl)
    ]);
    fs.writeFileSync(csvFile, [headers.join(','), ...rows.map(row => row.join(','))].join('\n'));

    console.log(`\n${'='.repeat(60)}`);
    console.log('Retry complete!');
    console.log(`Newly scraped: ${successCount}`);
    console.log(`Still failed: ${stillFailed.length}`);
    console.log(`Total companies: ${progress.companies.length}`);
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error('Fatal error:', error);
    progress.failedUrls = [...stillFailed, ...failedUrls.slice(failedUrls.indexOf(stillFailed[stillFailed.length - 1]) + 1)];
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
