#!/usr/bin/env npx tsx
/**
 * Y Combinator Founder Directory Scraper
 *
 * Scrapes all company/founder data from https://www.ycombinator.com/companies
 * Uses Algolia API with batch filtering to get ALL companies (~5700).
 * Uses curl for HTTP requests (works with environment proxy).
 *
 * Usage:
 *   npx tsx scraper.ts          # Full scrape (resumes from checkpoint)
 *   npx tsx scraper.ts --test   # Test mode (10 companies only)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

const ALGOLIA_APP_ID = "45BWZJ1SGC";
const ALGOLIA_API_KEY =
  "MjBjYjRiMzY0NzdhZWY0NjExY2NhZjYxMGIxYjc2MTAwNWFkNTkwNTc4NjgxYjU0YzFhYTY2ZGQ5OGY5NDMxZnJlc3RyaWN0SW5kaWNlcz0lNUIlMjJZQ0NvbXBhbnlfcHJvZHVjdGlvbiUyMiUyQyUyMllDQ29tcGFueV9CeV9MYXVuY2hfRGF0ZV9wcm9kdWN0aW9uJTIyJTVEJnRhZ0ZpbHRlcnM9JTVCJTIyeWNkY19wdWJsaWMlMjIlNUQmYW5hbHl0aWNzVGFncz0lNUIlMjJ5Y2RjJTIyJTVE";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/YCCompany_production/query`;
const PROGRESS_FILE = path.join(paths.outputDir, "scrape-progress.json");
const HITS_PER_PAGE = 100;

interface AlgoliaCompany {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  all_locations: string | null;
  one_liner: string;
  team_size: number | null;
  batch: string;
  status: string | null;
  industries: string[];
  tags: string[];
}

interface Founder {
  user_id: number;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  is_active: boolean;
}

interface CompanyDetails {
  id: number;
  slug: string;
  name: string;
  batch_name: string;
  one_liner: string;
  website: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  team_size: number | null;
  ycdc_status: string | null;
  tags: string[];
  linkedin_url: string | null;
  twitter_url: string | null;
  founders: Founder[];
}

interface Progress {
  companiesScraped: number;
  processedSlugs: string[];
  failedSlugs: string[];
  founderRecords: LeadRecord[];
}

interface LeadRecord {
  core: {
    source_id: string;
    entity_type: "person";
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  person: {
    full_name: string;
    title?: string;
    company_name?: string;
    profile_url?: string;
  };
  contact: {
    website?: string;
    socials?: { platform: string; url: string }[];
    location?: {
      city?: string;
      state?: string;
      country?: string;
    };
  };
  context: {
    company_slug: string;
    yc_batch?: string;
    company_status?: string;
    company_one_liner?: string;
    company_industries?: string[];
    company_team_size?: number;
    company_website?: string;
    company_linkedin?: string;
    company_twitter?: string;
    founder_role?: string;
    founder_user_id?: number;
  };
}

const TEST_MODE = process.argv.includes("--test");

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    return {
      companiesScraped: data.companiesScraped || 0,
      processedSlugs: data.processedSlugs || [],
      failedSlugs: data.failedSlugs || [],
      founderRecords: data.founderRecords || [],
    };
  }
  return {
    companiesScraped: 0,
    processedSlugs: [],
    failedSlugs: [],
    founderRecords: [],
  };
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function parseLocation(
  city: string | null,
  country: string | null
): { city?: string; state?: string; country?: string } {
  const result: { city?: string; state?: string; country?: string } = {};

  if (city) {
    const parts = city.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      result.city = parts[0];
      const second = parts[1];
      if (second.length === 2 && second === second.toUpperCase()) {
        result.state = second;
      }
    } else {
      result.city = city;
    }
  }

  if (country) {
    const countryMap: Record<string, string> = {
      US: "USA",
      USA: "USA",
      UK: "United Kingdom",
      GB: "United Kingdom",
      CA: "Canada",
      DE: "Germany",
      FR: "France",
      IN: "India",
      SG: "Singapore",
      AU: "Australia",
    };
    result.country = countryMap[country] || country;
  }

  return result;
}

// Use curl for HTTP requests - handles proxies correctly
function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): { statusCode: number; body: string } {
  const args: string[] = ["-s", "-w", "\\n%{http_code}"];

  if (options.method === "POST") {
    args.push("-X", "POST");
  }

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  if (options.body) {
    args.push("-d", options.body);
  }

  args.push("--max-time", "30");
  args.push(url);

  try {
    const result = execSync(
      `curl ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const lines = result.trim().split("\n");
    const statusCode = parseInt(lines[lines.length - 1]) || 0;
    const body = lines.slice(0, -1).join("\n");

    return { statusCode, body };
  } catch (error: any) {
    return { statusCode: 0, body: error.message || "Request failed" };
  }
}

// Fetch all batch names from Algolia facets
function fetchAllBatches(): string[] {
  console.log("Fetching batch list from Algolia...");

  const response = httpRequest(ALGOLIA_URL, {
    method: "POST",
    headers: {
      "X-Algolia-API-Key": ALGOLIA_API_KEY,
      "X-Algolia-Application-Id": ALGOLIA_APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "",
      hitsPerPage: 0,
      facets: ["batch"],
    }),
  });

  if (response.statusCode !== 200) {
    throw new Error(`Algolia API error: ${response.statusCode}`);
  }

  const data = JSON.parse(response.body);
  const batches = Object.keys(data.facets?.batch || {});
  const totalCompanies = data.nbHits;

  console.log(`  Found ${batches.length} batches with ${totalCompanies} total companies`);
  return batches;
}

// Fetch all companies for a specific batch
function fetchCompaniesForBatch(batch: string): AlgoliaCompany[] {
  const companies: AlgoliaCompany[] = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const response = httpRequest(ALGOLIA_URL, {
      method: "POST",
      headers: {
        "X-Algolia-API-Key": ALGOLIA_API_KEY,
        "X-Algolia-Application-Id": ALGOLIA_APP_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "",
        hitsPerPage: HITS_PER_PAGE,
        page: page,
        filters: `batch:"${batch}"`,
      }),
    });

    if (response.statusCode !== 200) {
      console.log(`  Warning: Failed to fetch page ${page} for batch ${batch}`);
      break;
    }

    const data = JSON.parse(response.body);
    totalPages = data.nbPages;

    for (const hit of data.hits) {
      companies.push({
        id: hit.id,
        name: hit.name,
        slug: hit.slug,
        website: hit.website,
        all_locations: hit.all_locations,
        one_liner: hit.one_liner,
        team_size: hit.team_size,
        batch: hit.batch,
        status: hit.status,
        industries: hit.industries || [],
        tags: hit.tags || [],
      });
    }

    page++;
  }

  return companies;
}

// Fetch all companies from all batches
function fetchAllCompanies(): AlgoliaCompany[] {
  const batches = fetchAllBatches();
  const allCompanies: AlgoliaCompany[] = [];
  const seenSlugs = new Set<string>();

  console.log("\nFetching companies from each batch...");

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`\r  [${i + 1}/${batches.length}] ${batch.padEnd(20)} `);

    const companies = fetchCompaniesForBatch(batch);

    for (const company of companies) {
      if (!seenSlugs.has(company.slug)) {
        seenSlugs.add(company.slug);
        allCompanies.push(company);
      }
    }

    process.stdout.write(`(${allCompanies.length} total)`);

    if (TEST_MODE && allCompanies.length >= 10) {
      console.log("\n  [TEST MODE] Stopping after 10 companies");
      break;
    }
  }

  console.log(`\n\nTotal unique companies: ${allCompanies.length}`);
  return allCompanies;
}

function fetchCompanyDetails(slug: string): CompanyDetails | null {
  const url = `https://www.ycombinator.com/companies/${slug}`;

  try {
    const response = httpRequest(url);

    if (response.statusCode !== 200) {
      return null;
    }

    // Extract JSON from data-page attribute
    const match = response.body.match(/data-page="([^"]+)"/);
    if (!match) {
      return null;
    }

    // Decode HTML entities
    const jsonStr = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'");

    const pageData = JSON.parse(jsonStr);
    const company = pageData.props?.company;

    if (!company) {
      return null;
    }

    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      batch_name: company.batch_name,
      one_liner: company.one_liner,
      website: company.website,
      location: company.location,
      city: company.city,
      country: company.country,
      team_size: company.team_size,
      ycdc_status: company.ycdc_status,
      tags: company.tags || [],
      linkedin_url: company.linkedin_url,
      twitter_url: company.twitter_url,
      founders: (company.founders || []).map((f: any) => ({
        user_id: f.user_id,
        full_name: f.full_name,
        title: f.title,
        linkedin_url: f.linkedin_url,
        twitter_url: f.twitter_url,
        is_active: f.is_active,
      })),
    };
  } catch (error) {
    return null;
  }
}

function convertToLeadRecord(
  company: CompanyDetails,
  founder: Founder,
  scrapedAt: string
): LeadRecord {
  const location = parseLocation(company.city, company.country);
  const socials: { platform: string; url: string }[] = [];

  if (founder.linkedin_url) {
    socials.push({ platform: "linkedin", url: founder.linkedin_url });
  }
  if (founder.twitter_url) {
    socials.push({ platform: "twitter", url: founder.twitter_url });
  }

  const profileUrl = `https://www.ycombinator.com/companies/${company.slug}`;

  const record: LeadRecord = {
    core: {
      source_id: config.source_id,
      entity_type: "person",
      scraped_at: scrapedAt,
      raw_url: profileUrl,
      primary_key: "",
    },
    person: {
      full_name: founder.full_name,
      title: founder.title || undefined,
      company_name: company.name,
      profile_url: profileUrl,
    },
    contact: {
      website: company.website || undefined,
      socials: socials.length > 0 ? socials : undefined,
      location: Object.keys(location).length > 0 ? location : undefined,
    },
    context: {
      company_slug: company.slug,
      yc_batch: company.batch_name || undefined,
      company_status: company.ycdc_status || undefined,
      company_one_liner: company.one_liner || undefined,
      company_industries: company.tags.length > 0 ? company.tags : undefined,
      company_team_size: company.team_size || undefined,
      company_website: company.website || undefined,
      company_linkedin: company.linkedin_url || undefined,
      company_twitter: company.twitter_url || undefined,
      founder_role: founder.title || undefined,
      founder_user_id: founder.user_id,
    },
  };

  record.core.primary_key = generatePrimaryKey(
    config,
    record as unknown as Record<string, unknown>,
    profileUrl
  );

  return record;
}

function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log("=".repeat(60));
  console.log("Y Combinator Founder Scraper");
  console.log(TEST_MODE ? "[TEST MODE - 10 companies only]" : "[FULL SCRAPE]");
  console.log("=".repeat(60));

  ensureOutputDir(__dirname);

  let progress = loadProgress();
  console.log(
    `\nLoaded progress: ${progress.founderRecords.length} founders from ${progress.companiesScraped} companies`
  );

  let errorCount = 0;

  try {
    // Step 1: Get all companies from Algolia (using batch filtering)
    const companies = fetchAllCompanies();

    // Filter out already processed
    const processedSet = new Set(progress.processedSlugs);
    let toProcess = companies.filter((c) => !processedSet.has(c.slug));

    if (TEST_MODE) {
      toProcess = toProcess.slice(0, 10);
    }

    console.log(
      `\n${toProcess.length} companies to process (${processedSet.size} already done)`
    );

    // Step 2: Fetch each company page for founder details
    let processed = 0;
    for (const company of toProcess) {
      processed++;
      process.stdout.write(
        `\r[${processed}/${toProcess.length}] Scraping: ${company.name.substring(0, 40).padEnd(40)}`
      );

      const details = fetchCompanyDetails(company.slug);

      if (details && details.founders.length > 0) {
        for (const founder of details.founders) {
          const record = convertToLeadRecord(details, founder, startTime);
          progress.founderRecords.push(record);
        }
        progress.processedSlugs.push(company.slug);
        progress.companiesScraped++;
      } else if (details) {
        // Company exists but no founders
        progress.processedSlugs.push(company.slug);
        progress.companiesScraped++;
      } else {
        progress.failedSlugs.push(company.slug);
        errorCount++;
      }

      // Save progress every 100 companies
      if (processed % 100 === 0) {
        saveProgress(progress);
        console.log(
          `\n  [Progress saved: ${progress.founderRecords.length} founders from ${progress.companiesScraped} companies]`
        );
      }
    }

    console.log("\n");
    saveProgress(progress);

    // Write leads.jsonl
    console.log("Writing leads.jsonl...");
    const jsonlContent =
      progress.founderRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.writeFileSync(paths.leadsFile, jsonlContent);

    // Write run.json
    const endTime = new Date().toISOString();
    const runJson = {
      source_id: config.source_id,
      run_id: runId,
      started_at: startTime,
      ended_at: endTime,
      records_found: progress.founderRecords.length,
      records_valid: progress.founderRecords.length,
      records_written: progress.founderRecords.length,
      error_count: errorCount,
      errors:
        progress.failedSlugs.length > 0
          ? [
              {
                type: "http_error",
                message: `Failed to fetch ${progress.failedSlugs.length} company pages`,
                skipped_records: progress.failedSlugs.length,
              },
            ]
          : [],
    };
    fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

    // Update data_as_of in source.yaml
    updateDataAsOf(__dirname);

    console.log(`${"=".repeat(60)}`);
    console.log("Scraping complete!");
    console.log(`Companies scraped: ${progress.companiesScraped}`);
    console.log(`Founders written: ${progress.founderRecords.length}`);
    console.log(`Failed companies: ${progress.failedSlugs.length}`);
    console.log(`Output: ${paths.leadsFile}`);
    console.log(`${"=".repeat(60)}`);
  } catch (error) {
    console.error("\nFatal error:", error);
    errorCount++;
    saveProgress(progress);
    throw error;
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
