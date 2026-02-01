/**
 * Scraper Template
 *
 * This template shows how to build a scraper that:
 * 1. Reads configuration from source.yaml (single source of truth)
 * 2. Outputs leads.jsonl and run.json per DATA-RULES.md
 * 3. Updates data_as_of in source.yaml after successful run
 *
 * Customize the fetchData() and transformRecord() functions for your source.
 *
 * Copy this entire template/ directory to your scraper location:
 *   cp -r template/ final_data/<industry>/<source_name>/
 *   cp -r template/ data_in_progress/<industry>/<source_name>/
 *
 * The import path below is configured for scraper directories and works immediately after copying.
 */

import * as fs from "fs";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
  getRecordEntityType,
  SourceConfig,
} from "../../../lib/source-config";

// ============================================================================
// Types - Customize these for your source
// ============================================================================

// Raw data structure from the source (customize this)
interface RawRecord {
  id: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  // ... add fields specific to your source
}

// ============================================================================
// Main Scraper
// ============================================================================

async function main() {
  // Load config from source.yaml
  const config = loadSourceConfig(__dirname);
  const paths = getOutputPaths(__dirname);

  console.log(`Starting scrape: ${config.display_name}`);
  console.log(`Source ID: ${config.source_id}`);
  console.log(`Entity type: ${config.entity_type}`);

  // Ensure output directory exists
  ensureOutputDir(__dirname);

  // Track run stats
  const runStats = {
    source_id: config.source_id,
    run_id: `run_${Date.now()}`,
    started_at: new Date().toISOString(),
    ended_at: "",
    records_found: 0,
    records_valid: 0,
    records_written: 0,
    error_count: 0,
    errors: [] as Array<{
      type: "rate_limit" | "http_error" | "parse_error" | "timeout" | "other";
      url?: string;
      message: string;
      attempts?: number;
      skipped_records?: number;
    }>,
  };

  // Open leads file for writing
  const leadsStream = fs.createWriteStream(paths.leadsFile);

  try {
    // Fetch data from source
    const rawRecords = await fetchData(config);
    runStats.records_found = rawRecords.length;

    console.log(`Found ${rawRecords.length} records`);

    // Transform and write each record
    for (const raw of rawRecords) {
      try {
        const record = transformRecord(raw, config);
        leadsStream.write(JSON.stringify(record) + "\n");
        runStats.records_valid++;
        runStats.records_written++;
      } catch (err) {
        console.error(`Error transforming record:`, err);
        runStats.error_count++;
      }
    }

    // Update data_as_of in source.yaml
    updateDataAsOf(__dirname);
    console.log(`Updated data_as_of to today`);

  } catch (err) {
    console.error("Scrape failed:", err);
    runStats.error_count++;
  } finally {
    leadsStream.end();
  }

  // Write run.json
  runStats.ended_at = new Date().toISOString();
  fs.writeFileSync(paths.runFile, JSON.stringify(runStats, null, 2));

  console.log(`\nScrape complete:`);
  console.log(`  Records found: ${runStats.records_found}`);
  console.log(`  Records written: ${runStats.records_written}`);
  console.log(`  Errors: ${runStats.error_count}`);
}

// ============================================================================
// Data Fetching - Customize this for your source
// ============================================================================

async function fetchData(config: SourceConfig): Promise<RawRecord[]> {
  // Example: Fetch from an API
  // const response = await fetch(config.start_urls[0]);
  // return await response.json();

  // Example: Scrape a webpage with Playwright
  // const browser = await chromium.launch();
  // const page = await browser.newPage();
  // await page.goto(config.start_urls[0]);
  // const data = await page.evaluate(() => { ... });

  // Placeholder - replace with actual fetching logic
  console.log(`Would fetch from: ${config.start_urls.join(", ")}`);

  return [
    // Example records for demonstration
    { id: "1", name: "Jane Doe", title: "Partner", company: "Acme Corp", city: "New York", state: "NY" },
    { id: "2", name: "John Smith", title: "Associate", company: "Acme Corp", email: "jsmith@acme.com" },
  ];
}

// ============================================================================
// Record Transformation - Customize this for your source
// ============================================================================

function transformRecord(raw: RawRecord, config: SourceConfig) {
  const scrapedAt = new Date().toISOString();
  const rawUrl = `${config.start_urls[0]}/${raw.id}`;

  // Determine entity type for this record
  // For entity_type="both", you'd determine this per-record
  const entityType = getRecordEntityType(config);

  // Build the record structure per DATA-RULES.md
  const record: Record<string, unknown> = {
    core: {
      source_id: config.source_id,
      entity_type: entityType,
      scraped_at: scrapedAt,
      raw_url: rawUrl,
      primary_key: "", // Will be set below
    },
    contact: {
      email: raw.email || undefined,
      phone: raw.phone || undefined,
      location: (raw.city || raw.state) ? {
        city: raw.city,
        state: raw.state,
      } : undefined,
    },
    context: {
      // Add source-specific fields here
      original_id: raw.id,
    },
  };

  // Add entity section based on type
  if (entityType === "person") {
    record.person = {
      full_name: raw.name,
      title: raw.title,
      company_name: raw.company,
    };
  } else {
    record.company = {
      company_name: raw.name,
    };
  }

  // Generate primary key using the strategy from source.yaml
  // Pass the full record so generatePrimaryKey can navigate to the ID field
  (record.core as Record<string, unknown>).primary_key = generatePrimaryKey(
    config,
    record as Record<string, unknown>,
    rawUrl
  );

  return record;
}

// ============================================================================
// Run
// ============================================================================

main().catch(console.error);
