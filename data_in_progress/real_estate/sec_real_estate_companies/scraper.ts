/**
 * SEC EDGAR Real Estate Companies Scraper
 *
 * Scrapes SEC EDGAR for public companies classified under real estate
 * and building contractor SIC codes.
 *
 * Strategy:
 *   1. Use browse-edgar Atom feed to collect all CIK numbers per SIC code
 *   2. Deduplicate CIKs (some companies appear under multiple SIC codes)
 *   3. Fetch full company details from data.sec.gov/submissions/CIK{cik}.json
 *   4. Output leads.jsonl with company name, address, phone, SIC, tickers, etc.
 *
 * Rate limiting: SEC EDGAR allows 10 requests/second. We target ~8/sec.
 *
 * Usage:
 *   npx tsx scraper.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

// ============================================================================
// Configuration
// ============================================================================

const USER_AGENT = "ScrappyPuffle/1.0 (scrappypuffle@example.com)";
const RATE_LIMIT_MS = 125; // ~8 requests per second
const MIN_FILING_YEAR = 2015; // Only include companies with filings from 2015 onwards

// SIC codes for real estate and building contractors
const SIC_CODES: { code: string; description: string }[] = [
  { code: "6500", description: "Real Estate" },
  { code: "6510", description: "Real Estate Operators (No Developers) & Lessors" },
  { code: "6512", description: "Operators of Apartment Buildings" },
  { code: "6513", description: "Operators of Real Estate NEC" },
  { code: "6519", description: "Real Property Lessors, NEC" },
  { code: "6531", description: "Real Estate Agents and Managers" },
  { code: "6532", description: "Real Estate Dealers (for Their Own Account)" },
  { code: "6552", description: "Land Subdividers & Developers (No Cemeteries)" },
  { code: "6798", description: "Real Estate Investment Trusts" },
  { code: "1520", description: "General Building Contractors - Residential" },
  { code: "1521", description: "General Contractors - Residential Buildings" },
  { code: "1522", description: "General Contractors - Residential, Other Than Building" },
  { code: "1531", description: "Operative Builders" },
  { code: "1540", description: "General Building Contractors - Nonresidential" },
  { code: "1541", description: "General Contractors - Industrial & Commercial" },
  { code: "1542", description: "General Contractors - Nonresidential, Other" },
  { code: "1500", description: "General Building Contractors" },
];

const BROWSE_EDGAR_BASE =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=100&output=atom";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

// ============================================================================
// Types
// ============================================================================

interface CikEntry {
  cik: string;
  name: string;
  sic: string;
  state: string;
}

interface CompanySubmission {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  ownerOrg: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein: string;
  description: string;
  website: string;
  category: string;
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  stateOfIncorporationDescription: string;
  addresses: {
    mailing: AddressInfo;
    business: AddressInfo;
  };
  phone: string;
  formerNames: { name: string; from: string; to: string }[];
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
    };
  };
}

interface AddressInfo {
  street1: string;
  street2: string;
  city: string;
  stateOrCountry: string;
  zipCode: string;
  stateOrCountryDescription: string;
  isForeignLocation?: number | null;
}

// ============================================================================
// Utilities
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, application/atom+xml, text/xml, */*",
        },
      });

      if (response.status === 429) {
        const waitTime = Math.min(5000 * attempt, 30000);
        console.warn(
          `  Rate limited (429). Waiting ${waitTime / 1000}s (attempt ${attempt}/${maxRetries})...`
        );
        await delay(waitTime);
        continue;
      }

      if (!response.ok && attempt < maxRetries) {
        console.warn(
          `  HTTP ${response.status} for ${url}. Retry ${attempt}/${maxRetries}...`
        );
        await delay(2000 * attempt);
        continue;
      }

      return response;
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn(
          `  Fetch error for ${url}: ${err}. Retry ${attempt}/${maxRetries}...`
        );
        await delay(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

// ============================================================================
// Step 1: Collect CIKs from browse-edgar Atom feed
// ============================================================================

function parseCiksFromAtom(xml: string, sicCode: string): CikEntry[] {
  const entries: CikEntry[] = [];

  // Match each <entry> block
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    const cikMatch = block.match(/<cik>(\d+)<\/cik>/);
    const nameMatch = block.match(/<name>(.*?)<\/name>/);
    const stateMatch = block.match(
      /<company-info>[\s\S]*?<state>(.*?)<\/state>/
    );

    if (cikMatch) {
      entries.push({
        cik: cikMatch[1].replace(/^0+/, ""), // Strip leading zeros
        name: nameMatch ? nameMatch[1] : "",
        sic: sicCode,
        state: stateMatch ? stateMatch[1] : "",
      });
    }
  }

  return entries;
}

async function collectCiksForSic(sicCode: string): Promise<CikEntry[]> {
  const allEntries: CikEntry[] = [];
  let start = 0;

  while (true) {
    const url = `${BROWSE_EDGAR_BASE}&SIC=${sicCode}&start=${start}`;
    await delay(RATE_LIMIT_MS);

    const response = await fetchWithRetry(url);
    const xml = await response.text();

    const entries = parseCiksFromAtom(xml, sicCode);
    if (entries.length === 0) break;

    allEntries.push(...entries);
    console.log(
      `    SIC ${sicCode}: fetched ${entries.length} entries (offset ${start}, total so far: ${allEntries.length})`
    );

    if (entries.length < 100) break; // Last page
    start += 100;
  }

  return allEntries;
}

async function collectAllCiks(): Promise<Map<string, CikEntry>> {
  const cikMap = new Map<string, CikEntry>();

  for (const sic of SIC_CODES) {
    console.log(`\nCollecting CIKs for SIC ${sic.code} (${sic.description})...`);
    const entries = await collectCiksForSic(sic.code);

    for (const entry of entries) {
      if (!cikMap.has(entry.cik)) {
        cikMap.set(entry.cik, entry);
      }
    }

    console.log(
      `  SIC ${sic.code}: ${entries.length} entries. Unique CIKs so far: ${cikMap.size}`
    );
  }

  return cikMap;
}

// ============================================================================
// Step 2: Fetch full company details from submissions API
// ============================================================================

async function fetchCompanyDetails(
  cik: string
): Promise<CompanySubmission | null> {
  const paddedCik = cik.padStart(10, "0");
  const url = `${SUBMISSIONS_BASE}/CIK${paddedCik}.json`;

  try {
    await delay(RATE_LIMIT_MS);
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      console.warn(`  Failed to fetch CIK ${cik}: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as CompanySubmission;
    return data;
  } catch (err) {
    console.warn(`  Error fetching CIK ${cik}: ${err}`);
    return null;
  }
}

// ============================================================================
// Step 3: Transform to lead records
// ============================================================================

function getLatestFilingDate(company: CompanySubmission): string | undefined {
  const filings = company.filings?.recent;
  if (!filings?.filingDate || filings.filingDate.length === 0) return undefined;
  return filings.filingDate[0]; // Most recent filing
}

function getLatestFilingForm(company: CompanySubmission): string | undefined {
  const filings = company.filings?.recent;
  if (!filings?.form || filings.form.length === 0) return undefined;
  return filings.form[0];
}

function buildAddress(addr: AddressInfo | undefined): string {
  if (!addr) return "";
  const parts: string[] = [];
  if (addr.street1) parts.push(addr.street1);
  if (addr.street2) parts.push(addr.street2);
  if (addr.city) parts.push(addr.city);
  if (addr.stateOrCountry) parts.push(addr.stateOrCountry);
  if (addr.zipCode) parts.push(addr.zipCode);
  return parts.join(", ");
}

function transformToLeadRecord(
  company: CompanySubmission,
  config: ReturnType<typeof loadSourceConfig>,
  scrapedAt: string
) {
  const bizAddr = company.addresses?.business;
  const rawUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}&type=&dateb=&owner=include&count=40&search_text=&action=getcompany`;

  // Build location from business address
  const location: Record<string, string> = {};
  if (bizAddr?.city) location.city = bizAddr.city;
  if (bizAddr?.stateOrCountry) location.state = bizAddr.stateOrCountry;
  if (bizAddr?.zipCode) location.zip = bizAddr.zipCode;
  if (bizAddr?.stateOrCountryDescription)
    location.country = bizAddr.isForeignLocation ? bizAddr.stateOrCountryDescription : "US";

  // Build website URL
  let website: string | undefined;
  if (company.website) {
    website = company.website.startsWith("http")
      ? company.website
      : `https://${company.website}`;
  }

  const record: Record<string, unknown> = {
    core: {
      source_id: config.source_id,
      entity_type: "company" as const,
      scraped_at: scrapedAt,
      raw_url: rawUrl,
      primary_key: "", // Set below
    },
    company: {
      company_name: company.name,
      legal_name: company.name,
      industry: company.sicDescription || undefined,
      website: website || undefined,
      location: Object.keys(location).length > 0 ? location : undefined,
    },
    contact: {
      phone: company.phone || undefined,
    },
    context: {
      cik: company.cik,
      sic: company.sic,
      sic_description: company.sicDescription || undefined,
      entity_type_sec: company.entityType || undefined,
      category: company.category || undefined,
      tickers:
        company.tickers && company.tickers.length > 0
          ? company.tickers
          : undefined,
      exchanges:
        company.exchanges && company.exchanges.length > 0
          ? company.exchanges
          : undefined,
      ein: company.ein || undefined,
      state_of_incorporation: company.stateOfIncorporation || undefined,
      fiscal_year_end: company.fiscalYearEnd || undefined,
      business_address: buildAddress(bizAddr) || undefined,
      mailing_address: buildAddress(company.addresses?.mailing) || undefined,
      latest_filing_date: getLatestFilingDate(company) || undefined,
      latest_filing_form: getLatestFilingForm(company) || undefined,
      former_names:
        company.formerNames && company.formerNames.length > 0
          ? company.formerNames.map((fn) => fn.name)
          : undefined,
      owner_org: company.ownerOrg || undefined,
    },
  };

  // Generate primary key
  (record.core as Record<string, unknown>).primary_key = generatePrimaryKey(
    config,
    record,
    rawUrl
  );

  return record;
}

// ============================================================================
// Progress management (for resumable scrapes)
// ============================================================================

interface ScrapeProgress {
  phase: "collect_ciks" | "fetch_details" | "complete";
  ciks_collected: string[];
  details_fetched: string[];
  last_updated: string;
}

function loadProgress(progressFile: string): ScrapeProgress | null {
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveProgress(progressFile: string, progress: ScrapeProgress): void {
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = loadSourceConfig(__dirname);
  const paths = getOutputPaths(__dirname);

  console.log("=".repeat(60));
  console.log("SEC EDGAR Real Estate Companies Scraper");
  console.log("=".repeat(60));
  console.log(`Source ID: ${config.source_id}`);
  console.log(`Entity type: ${config.entity_type}`);
  console.log(`SIC codes: ${SIC_CODES.map((s) => s.code).join(", ")}`);
  console.log();

  ensureOutputDir(__dirname);

  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;
  const progressFile = paths.progressFile;

  // Track errors
  const errors: Array<{
    type: "rate_limit" | "http_error" | "parse_error" | "timeout" | "other";
    url?: string;
    message: string;
    attempts?: number;
    skipped_records?: number;
  }> = [];

  // Load or initialize progress
  let progress = loadProgress(progressFile);
  let cikList: string[] = [];

  // ---- Phase 1: Collect CIKs ----
  if (!progress || progress.phase === "collect_ciks") {
    console.log("Phase 1: Collecting CIKs from EDGAR browse by SIC code...\n");

    const cikMap = await collectAllCiks();
    cikList = Array.from(cikMap.keys());

    console.log(`\nTotal unique CIKs collected: ${cikList.length}`);

    progress = {
      phase: "fetch_details",
      ciks_collected: cikList,
      details_fetched: [],
      last_updated: new Date().toISOString(),
    };
    saveProgress(progressFile, progress);
  } else {
    cikList = progress.ciks_collected;
    console.log(
      `Resuming. ${cikList.length} CIKs collected, ${progress.details_fetched.length} details already fetched.`
    );
  }

  // ---- Phase 2: Fetch company details ----
  console.log("\nPhase 2: Fetching company details from submissions API...\n");

  const alreadyFetched = new Set(progress?.details_fetched || []);
  const ciksToFetch = cikList.filter((cik) => !alreadyFetched.has(cik));

  console.log(`CIKs to fetch: ${ciksToFetch.length}`);
  console.log(
    `Already fetched: ${alreadyFetched.size} (will append to existing leads)\n`
  );

  // Open leads file for appending (or create fresh)
  const scrapedAt = new Date().toISOString();
  let recordsWritten = alreadyFetched.size;
  let errorCount = 0;

  // If resuming, read existing records count
  let existingRecords = 0;
  if (alreadyFetched.size > 0 && fs.existsSync(paths.leadsFile)) {
    const existingContent = fs.readFileSync(paths.leadsFile, "utf-8");
    existingRecords = existingContent
      .split("\n")
      .filter((line) => line.trim()).length;
    recordsWritten = existingRecords;
  }

  const leadsStream = fs.createWriteStream(paths.leadsFile, {
    flags: alreadyFetched.size > 0 ? "a" : "w",
  });

  let batchCount = 0;
  const PROGRESS_SAVE_INTERVAL = 50;

  for (let i = 0; i < ciksToFetch.length; i++) {
    const cik = ciksToFetch[i];

    if ((i + 1) % 100 === 0 || i === 0) {
      console.log(
        `  Processing CIK ${i + 1}/${ciksToFetch.length} (${cik})...`
      );
    }

    try {
      const company = await fetchCompanyDetails(cik);

      if (!company) {
        errorCount++;
        continue;
      }

      // Skip if no company name
      if (!company.name || company.name.trim() === "") {
        continue;
      }

      // Skip companies whose latest filing is before MIN_FILING_YEAR
      const latestFiling = getLatestFilingDate(company);
      if (latestFiling) {
        const filingYear = parseInt(latestFiling.substring(0, 4), 10);
        if (filingYear < MIN_FILING_YEAR) {
          continue;
        }
      } else {
        // No filing date at all — skip
        continue;
      }

      const record = transformToLeadRecord(company, config, scrapedAt);
      leadsStream.write(JSON.stringify(record) + "\n");
      recordsWritten++;

      alreadyFetched.add(cik);
      batchCount++;

      // Save progress periodically
      if (batchCount >= PROGRESS_SAVE_INTERVAL) {
        progress!.details_fetched = Array.from(alreadyFetched);
        progress!.last_updated = new Date().toISOString();
        saveProgress(progressFile, progress!);
        batchCount = 0;
      }
    } catch (err) {
      console.warn(`  Error processing CIK ${cik}: ${err}`);
      errorCount++;
      errors.push({
        type: "http_error",
        url: `${SUBMISSIONS_BASE}/CIK${cik.padStart(10, "0")}.json`,
        message: String(err),
        attempts: 3,
        skipped_records: 1,
      });
    }
  }

  // Close stream and wait for it to finish
  await new Promise<void>((resolve) => leadsStream.end(resolve));

  // Save final progress
  progress!.phase = "complete";
  progress!.details_fetched = Array.from(alreadyFetched);
  progress!.last_updated = new Date().toISOString();
  saveProgress(progressFile, progress!);

  // ---- Write run.json ----
  const endTime = new Date().toISOString();
  const runJson = {
    source_id: config.source_id,
    run_id: runId,
    started_at: startTime,
    ended_at: endTime,
    records_found: cikList.length,
    records_valid: recordsWritten,
    records_written: recordsWritten,
    error_count: errorCount,
    errors: errors.slice(0, 20), // Cap at 20 errors
  };
  fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

  // ---- Update data_as_of ----
  updateDataAsOf(__dirname);

  // ---- Generate review sample ----
  console.log("\nGenerating review sample...");
  generateReviewSample(paths.leadsFile, paths.reviewSampleFile);

  // ---- Summary ----
  console.log("\n" + "=".repeat(60));
  console.log("SCRAPE COMPLETE");
  console.log("=".repeat(60));
  console.log(`CIKs collected: ${cikList.length}`);
  console.log(`Records written: ${recordsWritten}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`\nOutput files:`);
  console.log(`  Leads: ${paths.leadsFile}`);
  console.log(`  Run: ${paths.runFile}`);
  console.log(`  Review: ${paths.reviewSampleFile}`);
  console.log(`  Progress: ${progressFile}`);
}

// ============================================================================
// Review Sample Generation
// ============================================================================

function generateReviewSample(
  leadsFile: string,
  reviewFile: string,
  sampleSize: number = 20
): void {
  if (!fs.existsSync(leadsFile)) {
    console.warn("No leads file found to generate sample from.");
    return;
  }

  const lines = fs
    .readFileSync(leadsFile, "utf-8")
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length === 0) {
    console.warn("Leads file is empty.");
    return;
  }

  // Randomly select records
  const indices = new Set<number>();
  const targetSize = Math.min(sampleSize, lines.length);

  while (indices.size < targetSize) {
    indices.add(Math.floor(Math.random() * lines.length));
  }

  const sample = Array.from(indices)
    .sort((a, b) => a - b)
    .map((idx) => {
      try {
        return JSON.parse(lines[idx]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  fs.writeFileSync(reviewFile, JSON.stringify(sample, null, 2));
  console.log(`  Review sample: ${sample.length} records written to ${reviewFile}`);
}

// ============================================================================
// Process Documentation
// ============================================================================

function writeProcessDocs(): void {
  const docsPath = path.join(
    __dirname,
    "output",
    "process_documentation.txt"
  );
  const content = `SEC EDGAR Real Estate Companies Scraper - Process Documentation
================================================================

Date: ${new Date().toISOString()}

Approach:
1. Browse-edgar Atom feed used to collect CIK numbers by SIC code
2. SIC codes targeted: ${SIC_CODES.map((s) => `${s.code} (${s.description})`).join(", ")}
3. data.sec.gov/submissions API used to get full company details per CIK
4. Rate limited to ~8 requests/second (SEC allows 10/sec)

Data fields captured:
- Company name, legal name
- CIK (SEC unique identifier)
- SIC code and description
- Business address (street, city, state, zip)
- Phone number
- Tickers and exchanges (if publicly traded)
- State of incorporation
- Entity type (operating, fund, etc.)
- SEC filing category (large/small/non-accelerated filer)
- Latest filing date and form type
- Former company names
- EIN (employer identification number)

Known limitations:
- Some very old/inactive companies may have minimal data
- Phone numbers may be outdated
- Website field is often empty in SEC data
- Foreign companies may have non-US addresses

Error handling:
- HTTP 429 rate limits: exponential backoff with 3 retries
- Network errors: 3 retries with increasing delay
- Missing data: fields omitted rather than guessed
- Progress saved every 50 records for resumability
`;

  fs.writeFileSync(docsPath, content);
}

// Run
writeProcessDocs();
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
