/**
 * NYC DOB BIS Scraper
 *
 * Scrapes New Building permit applications from NYC Department of Buildings
 * Building Information System (BIS) to extract developer/owner information.
 *
 * Usage:
 *   npm install
 *   npx tsx scraper.ts
 *   npx tsx scraper.ts --borough 1 --start-year 2023
 *
 * Borough codes: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir as ensureOutputDirLib,
  generatePrimaryKey,
} from "../../../lib/source-config";

// =============================================================================
// Types
// =============================================================================

interface Developer {
  jobNumber: string;
  address: string;
  borough: string;
  block: string;
  lot: string;
  bin: string;
  zipCode: string;
  communityBoard: string;
  ownerName: string;
  ownerRelationship: string;
  ownerBusinessName: string;
  ownerPhone: string;
  ownerAddress: string;
  ownerType: string;
  applicantName: string;
  applicantBusiness: string;
  applicantPhone: string;
  applicantEmail: string;
  filingRepName: string;
  filingRepBusiness: string;
  filingRepPhone: string;
  filingRepEmail: string;
  jobType: string;
  fileDate: string;
  jobStatus: string;
  estimatedCost: string;
  buildingType: string;
  profileUrl: string;
  scrapedAt: string;
}

interface ScrapeProgress {
  borough: number;
  currentPage: number;
  totalProcessed: number;
  developers: Developer[];
  lastUpdated: string;
}

// =============================================================================
// Constants
// =============================================================================

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

const BASE_URL = 'https://a810-bisweb.nyc.gov/bisweb';
const PROGRESS_FILE = path.join(paths.outputDir, 'scrape-progress.json');

const BOROUGH_NAMES: Record<number, string> = {
  1: 'Manhattan',
  2: 'Bronx',
  3: 'Brooklyn',
  4: 'Queens',
  5: 'Staten Island',
};

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureOutputDir(): void {
  ensureOutputDirLib(__dirname);
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
// Scraping Functions
// =============================================================================

async function navigateToSearch(page: Page, borough: number, startYear: number): Promise<void> {
  console.log('Navigating to BIS search page...');
  await page.goto(`${BASE_URL}/bispi00.jsp`, { waitUntil: 'networkidle', timeout: 60000 });
  await delay(5000); // Wait for page to fully initialize

  console.log(`Setting up search: NB jobs in ${BOROUGH_NAMES[borough]}, starting ${startYear}...`);

  // Fill in search form for "Jobs by Community Board" (search #18)
  await page.selectOption('select[name="alljobtype"]', 'NB');
  await delay(500);

  const commBdValue = `${BOROUGH_NAMES[borough]} -- ALL`;
  await page.selectOption('select[name="allcommbd"]', commBdValue);
  await delay(500);

  // Fill start date
  await page.selectOption('#allstartdate_month2', 'Jan');
  await page.fill('#allstartdate_day2', '1');
  await page.fill('#allstartdate_year2', startYear.toString());
  await delay(2000);

  // Click GO button
  console.log('Submitting search...');
  await page.click('input[name="go19"]', { timeout: 120000 });
  await delay(3000);

  console.log('Search results loaded.');
}

async function extractJobFromCurrentPage(page: Page, jobNumber: string, borough: number): Promise<Developer | null> {
  // Get page text
  const pageText = await page.evaluate(function() {
    return document.body.innerText;
  });

  const url = page.url();

  // Initialize data object
  const data: Developer = {
    jobNumber,
    address: '',
    borough: BOROUGH_NAMES[borough],
    block: '',
    lot: '',
    bin: '',
    zipCode: '',
    communityBoard: '',
    ownerName: '',
    ownerRelationship: '',
    ownerBusinessName: '',
    ownerPhone: '',
    ownerAddress: '',
    ownerType: '',
    applicantName: '',
    applicantBusiness: '',
    applicantPhone: '',
    applicantEmail: '',
    filingRepName: '',
    filingRepBusiness: '',
    filingRepPhone: '',
    filingRepEmail: '',
    jobType: 'NB - NEW BUILDING',
    fileDate: '',
    jobStatus: '',
    estimatedCost: '',
    buildingType: '',
    profileUrl: url,
    scrapedAt: new Date().toISOString(),
  };

  // Property info
  let match = pageText.match(/Premises:\s*([^\n]+)/);
  if (match) data.address = match[1].trim();

  match = pageText.match(/Block:\s*(\d+)/);
  if (match) data.block = match[1];

  match = pageText.match(/Lot:\s*(\d+)/);
  if (match) data.lot = match[1];

  match = pageText.match(/BIN:\s*(\d+)/);
  if (match) data.bin = match[1];

  match = pageText.match(/Zip Code:\s*(\d+)/);
  if (match) data.zipCode = match[1];

  match = pageText.match(/CB No:\s*(\d+)/);
  if (match) data.communityBoard = match[1];

  // Owner info (Section 26)
  const section26Match = pageText.match(/26\s+Owner's Information[\s\S]*?(?=27|Metes and Bounds|Yes\s+No\s+Owner)/i);
  if (section26Match) {
    const ownerSection = section26Match[0];

    match = ownerSection.match(/Name:\s*([A-Z][A-Z\s]+)/);
    if (match) data.ownerName = match[1].trim();

    match = ownerSection.match(/Relationship to Owner:\s*([A-Z]+)/);
    if (match) data.ownerRelationship = match[1].trim();

    match = ownerSection.match(/Business Name:\s*([^\n]+?)(?:\s*Business Phone|$)/);
    if (match) data.ownerBusinessName = match[1].trim();

    match = ownerSection.match(/Business Phone:\s*([\d\-\(\)\s]+)/);
    if (match) data.ownerPhone = match[1].trim();

    match = ownerSection.match(/Business Address:\s*([^\n]+?)(?:\s*Business Fax|$)/);
    if (match) data.ownerAddress = match[1].trim();

    match = ownerSection.match(/Owner Type:\s*([A-Z]+)/);
    if (match) data.ownerType = match[1].trim();
  }

  // Applicant info (Section 2)
  const section2Match = pageText.match(/2\s+Applicant of Record[\s\S]*?(?=3\s+Filing|Directive)/i);
  if (section2Match) {
    const appSection = section2Match[0];

    match = appSection.match(/Name:\s*([A-Z][A-Z\s]+)/);
    if (match) data.applicantName = match[1].trim();

    match = appSection.match(/Business Name:\s*([^\n]+?)(?:\s*Business Phone|$)/);
    if (match) data.applicantBusiness = match[1].trim();

    match = appSection.match(/Business Phone:\s*([\d\-\(\)\s]+)/);
    if (match) data.applicantPhone = match[1].trim();

    match = appSection.match(/E-Mail:\s*([^\s]+@[^\s]+)/);
    if (match) data.applicantEmail = match[1].trim();
  }

  // Filing rep info (Section 3)
  const section3Match = pageText.match(/3\s+Filing Representative[\s\S]*?(?=4\s+Filing Status)/i);
  if (section3Match) {
    const repSection = section3Match[0];

    match = repSection.match(/Name:\s*([^\n]+?)(?:\s*Business|$)/);
    if (match) data.filingRepName = match[1].trim();

    match = repSection.match(/Business Name:\s*([^\n]+?)(?:\s*Business Phone|$)/);
    if (match) data.filingRepBusiness = match[1].trim();

    match = repSection.match(/Business Phone:\s*([\d\-\(\)\s]+)/);
    if (match) data.filingRepPhone = match[1].trim();

    match = repSection.match(/E-Mail:\s*([^\s]+@[^\s]+)/);
    if (match) data.filingRepEmail = match[1].trim();
  }

  // Job info
  match = pageText.match(/Date Filed:\s*(\d{2}\/\d{2}\/\d{4})/);
  if (match) data.fileDate = match[1];

  match = pageText.match(/Estimated Total Cost:\s*\$?([\d,\.]+)/);
  if (match) data.estimatedCost = match[1];

  match = pageText.match(/Building Type:\s*([^\n]+)/);
  if (match) data.buildingType = match[1].trim();

  match = pageText.match(/Last Action:\s*([^\n]+)/);
  if (match) data.jobStatus = match[1].trim();

  // Return null if no owner info found
  if (!data.ownerName && !data.ownerBusinessName) {
    return null;
  }

  return data;
}

async function scrapeJobsFromSearchResults(page: Page, borough: number, progress: ScrapeProgress): Promise<void> {
  let hasNextPage = true;
  let pageNum = progress.currentPage;

  while (hasNextPage) {
    console.log(`\n--- Search Results Page ${pageNum} ---`);

    // Get all job links on current page
    const jobLinks = await page.$$eval('a[href*="JobsQueryByNumberServlet"]', function(links) {
      var results: Array<{href: string, jobNumber: string}> = [];
      var seen = new Set();
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var match = href.match(/passjobnumber=(\d+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ href: href, jobNumber: match[1] });
        }
      }
      return results;
    });

    console.log(`Found ${jobLinks.length} jobs on this page`);

    // Scrape each job
    for (let i = 0; i < jobLinks.length; i++) {
      const job = jobLinks[i];
      progress.totalProcessed++;

      console.log(`  [${i + 1}/${jobLinks.length}] Job: ${job.jobNumber}`);

      try {
        // Click on the job link using JS to avoid navigation timeout
        await page.evaluate(function(jobNum: string) {
          var link = document.querySelector('a[href*="passjobnumber=' + jobNum + '"]') as HTMLAnchorElement;
          if (link) link.click();
        }, job.jobNumber);
        // Wait for page to load
        await delay(5000);

        // Check if we need to go to Doc 1 (for owner info)
        const docSelector = await page.$('select:has(option:has-text("Doc 1"))');
        if (docSelector) {
          // Select Doc 1 and click Go
          await page.selectOption('select:has(option:has-text("Doc 1"))', 'Doc 1');
          await delay(200);
          const goButton = await page.$('button:has-text("Go")');
          if (goButton) {
            await goButton.click();
            await delay(2000);
          }
        }

        // Extract developer data
        const developer = await extractJobFromCurrentPage(page, job.jobNumber, borough);

        if (developer) {
          progress.developers.push(developer);
          console.log(`    Owner: ${developer.ownerBusinessName || developer.ownerName || 'N/A'}`);
        } else {
          console.log(`    No owner info found`);
        }

        // Go back to search results using JS
        await page.evaluate(function() {
          var links = document.querySelectorAll('a');
          for (var i = 0; i < links.length; i++) {
            if (links[i].textContent && links[i].textContent.indexOf('Jobs') >= 0) {
              links[i].click();
              break;
            }
          }
        });
        await delay(5000);

      } catch (error) {
        console.log(`    Error: ${error}`);
        // Try to recover by going back to search
        try {
          await page.goto(`${BASE_URL}/bispi00.jsp`, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(1000);
          await navigateToSearch(page, borough, 2024);
          // Skip to current page
          for (let p = 1; p < pageNum; p++) {
            const nextBtn = await page.$('button:has-text("Next"), input[value="Next"]');
            if (nextBtn) {
              await nextBtn.click();
              await delay(2000);
            }
          }
        } catch {
          console.log('    Failed to recover, continuing...');
        }
      }

      // Save progress
      progress.currentPage = pageNum;
      saveProgress(progress);

      // Rate limiting
      await delay(1000 + Math.random() * 1000);
    }

    // Check for next page using JS
    const hasNext = await page.evaluate(function() {
      var btn = document.querySelector('input[value="Next"]') as HTMLInputElement;
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    if (hasNext) {
      console.log('\nGoing to next page...');
      await delay(5000);
      pageNum++;
    } else {
      hasNextPage = false;
    }

    // Break every 5 pages for a longer rest
    if (pageNum % 5 === 0) {
      console.log('\nTaking a break...');
      await delay(5000);
    }
  }
}

// =============================================================================
// Output Functions
// =============================================================================

function saveJson(developers: Developer[], outputPath: string): void {
  const output = {
    scrapedAt: new Date().toISOString(),
    source: 'https://a810-bisweb.nyc.gov/bisweb',
    type: 'NB - NEW BUILDING',
    count: developers.length,
    developers,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
}

function saveCsv(developers: Developer[], outputPath: string): void {
  const headers = [
    'Job Number', 'Address', 'Borough', 'Block', 'Lot', 'BIN', 'Zip Code', 'Community Board',
    'Owner Name', 'Owner Relationship', 'Owner Business Name', 'Owner Phone', 'Owner Address', 'Owner Type',
    'Applicant Name', 'Applicant Business', 'Applicant Phone', 'Applicant Email',
    'Filing Rep Name', 'Filing Rep Business', 'Filing Rep Phone', 'Filing Rep Email',
    'Job Type', 'File Date', 'Job Status', 'Estimated Cost', 'Building Type', 'Profile URL', 'Scraped At',
  ];

  const escapeCsv = (value: string): string => {
    if (!value) return '""';
    return `"${value.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  };

  const rows = developers.map(d => [
    escapeCsv(d.jobNumber), escapeCsv(d.address), escapeCsv(d.borough), escapeCsv(d.block),
    escapeCsv(d.lot), escapeCsv(d.bin), escapeCsv(d.zipCode), escapeCsv(d.communityBoard),
    escapeCsv(d.ownerName), escapeCsv(d.ownerRelationship), escapeCsv(d.ownerBusinessName),
    escapeCsv(d.ownerPhone), escapeCsv(d.ownerAddress), escapeCsv(d.ownerType),
    escapeCsv(d.applicantName), escapeCsv(d.applicantBusiness), escapeCsv(d.applicantPhone), escapeCsv(d.applicantEmail),
    escapeCsv(d.filingRepName), escapeCsv(d.filingRepBusiness), escapeCsv(d.filingRepPhone), escapeCsv(d.filingRepEmail),
    escapeCsv(d.jobType), escapeCsv(d.fileDate), escapeCsv(d.jobStatus), escapeCsv(d.estimatedCost),
    escapeCsv(d.buildingType), escapeCsv(d.profileUrl), d.scrapedAt,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
}

function buildRawUrl(dev: Developer): string {
  if (dev.bin) return `https://a810-bisweb.nyc.gov/bisweb/PropertyBrowseByBINServlet?allbin=${dev.bin}`;
  return 'https://a810-bisweb.nyc.gov/bisweb/bispi00.jsp';
}

function convertToLeadRecord(dev: Developer) {
  const hasBusinessName = dev.ownerBusinessName && dev.ownerBusinessName.length > 2;
  const displayName = hasBusinessName ? dev.ownerBusinessName : dev.ownerName;

  if (!displayName || displayName.length < 2) return null;

  const isCompany = hasBusinessName;
  const rawUrl = buildRawUrl(dev);
  const location = { city: "New York", state: "NY", zip: dev.zipCode || undefined, country: "USA" };
  const baseRecord: Record<string, unknown> = {
    core: {
      source_id: config.source_id,
      entity_type: isCompany ? "company" as const : "person" as const,
      scraped_at: dev.scrapedAt,
      raw_url: rawUrl,
      primary_key: "", // Will be set below
    },
    contact: {
      phone: dev.ownerPhone || undefined,
    },
    context: {
      job: dev.jobNumber, // Required for primary key generation
      job_type: dev.jobType || undefined,
      job_status: dev.jobStatus || undefined,
      file_date: dev.fileDate || undefined,
      estimated_cost: dev.estimatedCost || undefined,
      property_address: dev.address || undefined,
      borough: dev.borough || undefined,
      block: dev.block || undefined,
      lot: dev.lot || undefined,
      bin: dev.bin || undefined,
      building_type: dev.buildingType || undefined,
      community_board: dev.communityBoard || undefined,
      owner_type: dev.ownerType || undefined,
      applicant_name: dev.applicantName || undefined,
      applicant_business: dev.applicantBusiness || undefined,
    },
  };

  // Add entity-specific section
  if (isCompany) {
    baseRecord.company = { company_name: displayName, location };
  } else {
    baseRecord.person = { full_name: displayName, company_name: dev.ownerBusinessName || undefined, location };
  }

  // Generate primary key using strategy from source.yaml
  (baseRecord.core as Record<string, unknown>).primary_key = generatePrimaryKey(config, baseRecord, rawUrl);

  return baseRecord;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const boroughIndex = args.indexOf('--borough');
  const borough = boroughIndex !== -1 ? parseInt(args[boroughIndex + 1], 10) : 1;

  const startYearIndex = args.indexOf('--start-year');
  const startYear = startYearIndex !== -1 ? parseInt(args[startYearIndex + 1], 10) : 2024;

  const shouldResume = args.includes('--resume');

  console.log('\n' + '='.repeat(60));
  console.log('NYC DOB BIS Scraper - New Building Permits');
  console.log('='.repeat(60));
  console.log(`Borough: ${BOROUGH_NAMES[borough]}`);
  console.log(`Start Year: ${startYear}`);
  console.log();

  ensureOutputDir();

  // Load or create progress
  let progress: ScrapeProgress;
  const existingProgress = loadProgress();

  if (shouldResume && existingProgress && existingProgress.borough === borough) {
    console.log(`Resuming: ${existingProgress.developers.length} developers from page ${existingProgress.currentPage}`);
    progress = existingProgress;
  } else {
    progress = {
      borough,
      currentPage: 1,
      totalProcessed: 0,
      developers: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // Launch browser with anti-automation detection
  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    viewport: { width: 1440, height: 900 },
  });

  const page: Page = await context.newPage();
  page.setDefaultTimeout(90000); // 90 second default timeout

  try {
    // Navigate to search
    await navigateToSearch(page, borough, startYear);

    // Skip to current page if resuming
    if (progress.currentPage > 1) {
      console.log(`Skipping to page ${progress.currentPage}...`);
      for (let p = 1; p < progress.currentPage; p++) {
        const nextBtn = await page.$('button:has-text("Next"), input[value="Next"]');
        if (nextBtn) {
          await nextBtn.click();
          await delay(2000);
        }
      }
    }

    // Scrape jobs
    await scrapeJobsFromSearchResults(page, borough, progress);

    // Deduplicate
    const seen = new Set<string>();
    const uniqueDevelopers = progress.developers.filter(d => {
      const key = `${d.ownerBusinessName}|${d.ownerName}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Save final output
    const timestamp = new Date().toISOString().split('T')[0];
    const boroughSlug = BOROUGH_NAMES[borough].toLowerCase().replace(/\s+/g, '-');
    const jsonPath = path.join(paths.outputDir, `nyc-developers-${boroughSlug}-${timestamp}.json`);
    const csvPath = path.join(paths.outputDir, `nyc-developers-${boroughSlug}-${timestamp}.csv`);

    saveJson(uniqueDevelopers, jsonPath);
    saveCsv(uniqueDevelopers, csvPath);

    // Write JSONL output
    const records = uniqueDevelopers.map(d => convertToLeadRecord(d)).filter(Boolean);
    fs.writeFileSync(paths.leadsFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

    // Write run.json
    const endTime = new Date().toISOString();
    fs.writeFileSync(paths.runFile, JSON.stringify({
      source_id: config.source_id,
      run_id: `run_${Date.now()}`,
      started_at: progress.lastUpdated,
      ended_at: endTime,
      records_found: uniqueDevelopers.length,
      records_valid: records.length,
      records_written: records.length,
      error_count: uniqueDevelopers.length - records.length,
    }, null, 2));

    // Update data_as_of in source.yaml
    updateDataAsOf(__dirname);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Scrape Complete!');
    console.log('='.repeat(60));
    console.log(`Jobs processed: ${progress.totalProcessed}`);
    console.log(`Developers found: ${progress.developers.length}`);
    console.log(`Unique developers: ${uniqueDevelopers.length}`);
    console.log(`\nOutput:`);
    console.log(`  JSONL: ${paths.leadsFile}`);
    console.log(`  Run: ${paths.runFile}`);

    // Sample
    console.log('\n--- Sample Results ---');
    for (const d of uniqueDevelopers.slice(0, 5)) {
      console.log(`\n${d.ownerBusinessName || d.ownerName}`);
      console.log(`  Contact: ${d.ownerName} (${d.ownerRelationship || 'N/A'})`);
      console.log(`  Phone: ${d.ownerPhone || 'N/A'}`);
      console.log(`  Address: ${d.address}`);
    }

  } catch (error) {
    console.error('\nError:', error);
    if (progress.developers.length > 0) {
      const jsonPath = path.join(paths.outputDir, `nyc-developers-partial.json`);
      saveJson(progress.developers, jsonPath);
      console.log(`\nPartial results saved to: ${jsonPath}`);
    }
  } finally {
    console.log('\nClosing browser...');
    await browser.close();
  }
}

main().catch(console.error);
