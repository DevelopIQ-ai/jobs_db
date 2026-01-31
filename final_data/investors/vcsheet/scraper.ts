/**
 * VCSheet.com Fund Directory Scraper
 * Outputs JSONL per DATA-RULES.md
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

const BASE_URL = 'https://www.vcsheet.com';
const PROGRESS_FILE = path.join(paths.outputDir, 'scrape-progress.json');

const DELAY_BETWEEN_PROFILES = 2000;
const BROWSER_RESTART_INTERVAL = 100;

interface Progress {
  processedSlugs: string[];
  failedSlugs: string[];
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureOutputDirLocal() {
  ensureOutputDir(__dirname);
}

function loadProgress(): Progress {
  ensureOutputDirLocal();
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { processedSlugs: [], failedSlugs: [] };
}

function saveProgress(progress: Progress) {
  ensureOutputDirLocal();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function createBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function collectAllFundSlugs(page: Page): Promise<string[]> {
  console.log('Collecting fund URLs...');
  await page.goto(`${BASE_URL}/funds`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await delay(5000);

  let previousCount = 0;
  let noNewCount = 0;

  while (noNewCount < 5) {
    const currentCount = await page.evaluate(() => document.querySelectorAll('a[href^="/fund/"]').length);
    console.log(`  Found ${currentCount} funds...`);
    if (currentCount === previousCount) noNewCount++;
    else noNewCount = 0;
    previousCount = currentCount;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(2000);
  }

  const slugs = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href^="/fund/"]');
    const slugSet = new Set<string>();
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const match = href.match(/\/fund\/([^/?]+)/);
        if (match) slugSet.add(match[1]);
      }
    });
    return Array.from(slugSet);
  });

  console.log(`Total unique funds: ${slugs.length}`);
  return slugs;
}

function parseLocation(loc: string | null): { city?: string; state?: string; country?: string } {
  if (!loc) return {};
  const parts = loc.split(',').map(p => p.trim());
  if (parts.length === 2) return { city: parts[0], state: parts[1], country: 'USA' };
  if (parts.length === 1) return { city: parts[0] };
  return { city: loc };
}

async function scrapeFundProfile(page: Page, slug: string): Promise<string | null> {
  const url = `${BASE_URL}/fund/${slug}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(2000);

    const data = await page.evaluate(() => {
      const pageText = document.body.innerText || '';
      const h1 = document.querySelector('h1');
      const checkMatch = pageText.match(/\$?([\d.]+[KMB]?)\s*[-–]\s*\$?([\d.]+[KMB])/i);
      const linkedIn = document.querySelector('a[href*="linkedin.com"]') as HTMLAnchorElement;
      const twitter = document.querySelector('a[href*="twitter.com"], a[href*="x.com"]') as HTMLAnchorElement;
      const crunchbase = document.querySelector('a[href*="crunchbase.com"]') as HTMLAnchorElement;

      const locMatch = pageText.match(/(?:Location|Based in|Headquarters)[:\s]*([A-Za-z\s,]+?)(?:\n|$)/i);
      const emailMatch = pageText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);

      const stages: string[] = [];
      ['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series B+', 'Growth'].forEach(s => {
        if (pageText.includes(s)) stages.push(s);
      });

      const geos: string[] = [];
      ['USA', 'Europe', 'Asia-Pacific', 'Asia', 'Africa', 'Latin America', 'Middle East', 'Canada', 'UK', 'India', 'China', 'Global'].forEach(g => {
        if (pageText.includes(g)) geos.push(g);
      });

      const sectors: string[] = [];
      ['AI', 'Enterprise', 'Consumer', 'Health', 'Biotech', 'Fintech', 'Web3', 'Crypto', 'SaaS', 'Defense', 'Climate', 'Robotics', 'Cybersecurity', 'EdTech', 'Healthcare'].forEach(s => {
        if (new RegExp(`\\b${s}\\b`, 'i').test(pageText)) sectors.push(s);
      });

      return {
        name: h1?.textContent?.trim() || '',
        location: locMatch?.[1]?.trim() || null,
        email: emailMatch?.[1] || null,
        linkedIn: linkedIn?.href || null,
        twitter: twitter?.href || null,
        crunchbase: crunchbase?.href || null,
        checkSizeRaw: checkMatch?.[0] || null,
        checkSizeMin: checkMatch?.[1] || null,
        checkSizeMax: checkMatch?.[2] || null,
        stages,
        geos,
        sectors
      };
    });

    const socials: { platform: string; url: string }[] = [];
    if (data.linkedIn) socials.push({ platform: 'linkedin', url: data.linkedIn });
    if (data.twitter) socials.push({ platform: 'twitter', url: data.twitter });
    if (data.crunchbase) socials.push({ platform: 'crunchbase', url: data.crunchbase });

    const record: Record<string, unknown> = {
      core: {
        source_id: config.source_id,
        entity_type: 'company',
        scraped_at: new Date().toISOString(),
        raw_url: url,
        primary_key: '' // Will be set below
      },
      company: {
        company_name: data.name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        industry: 'Venture Capital',
        profile_url: url
      },
      contact: {
        email: data.email || undefined,
        socials: socials.length > 0 ? socials : undefined,
        location: parseLocation(data.location)
      },
      context: {
        slug,
        check_size_raw: data.checkSizeRaw,
        check_size_min: data.checkSizeMin,
        check_size_max: data.checkSizeMax,
        investment_stages: data.stages,
        geographies: data.geos,
        sectors: data.sectors
      }
    };

    // Generate primary key using strategy from source.yaml
    (record.core as Record<string, unknown>).primary_key = generatePrimaryKey(config, record, url);

    return JSON.stringify(record);
  } catch (e) {
    console.error(`  Error: ${e}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('VCSheet Scraper');
  console.log('='.repeat(50));

  const startedAt = new Date().toISOString();
  ensureOutputDirLocal();

  let progress = loadProgress();
  const processedSet = new Set(progress.processedSlugs);

  let { browser, context, page } = await createBrowser();

  try {
    const allSlugs = await collectAllFundSlugs(page);
    const toProcess = allSlugs.filter(s => !processedSet.has(s));

    // Add failed slugs to retry
    for (const s of progress.failedSlugs) {
      if (!processedSet.has(s) && !toProcess.includes(s)) {
        toProcess.push(s);
      }
    }
    progress.failedSlugs = [];

    console.log(`\nTo scrape: ${toProcess.length}`);

    let validCount = 0;
    let errorCount = 0;
    const writeStream = fs.createWriteStream(paths.leadsFile, { flags: 'a' });

    for (let i = 0; i < toProcess.length; i++) {
      const slug = toProcess[i];
      console.log(`[${i + 1}/${toProcess.length}] ${slug}`);

      if ((i + 1) % BROWSER_RESTART_INTERVAL === 0) {
        console.log('  [Restarting browser...]');
        try { await browser.close(); } catch (e) {}
        ({ browser, context, page } = await createBrowser());
      }

      const jsonLine = await scrapeFundProfile(page, slug);

      if (jsonLine) {
        writeStream.write(jsonLine + '\n');
        progress.processedSlugs.push(slug);
        processedSet.add(slug);
        validCount++;
        const parsed = JSON.parse(jsonLine);
        console.log(`  ✓ ${parsed.company.company_name} - ${parsed.context.check_size_raw || 'N/A'}`);
      } else {
        progress.failedSlugs.push(slug);
        errorCount++;
        console.log('  ✗ Failed');
      }

      if ((i + 1) % 20 === 0) {
        saveProgress(progress);
        console.log(`  [Saved: ${validCount} records]`);
      }

      await delay(DELAY_BETWEEN_PROFILES);
    }

    writeStream.end();
    saveProgress(progress);

    const endedAt = new Date().toISOString();

    // Count total records in file
    const totalRecords = fs.readFileSync(paths.leadsFile, 'utf-8').split('\n').filter(l => l.trim()).length;

    const runJson = {
      source_id: config.source_id,
      run_id: `run_${Date.now()}`,
      started_at: startedAt,
      ended_at: endedAt,
      records_found: allSlugs.length,
      records_valid: totalRecords,
      records_written: totalRecords,
      error_count: progress.failedSlugs.length
    };

    fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

    // Update data_as_of in source.yaml
    updateDataAsOf(__dirname);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Done! ${totalRecords} records in ${paths.leadsFile}`);
    console.log(`Failed: ${progress.failedSlugs.length}`);

  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

main().catch(console.error);
