/**
 * Source Config Utility
 *
 * Provides read/write access to source.yaml for scrapers.
 * Ensures single source of truth for scraper metadata.
 *
 * Usage:
 *   import { loadSourceConfig, updateDataAsOf } from '../lib/source-config';
 *
 *   const config = loadSourceConfig(__dirname);
 *   console.log(config.source_id);  // e.g., "finance/fdic"
 *
 *   // After successful scrape:
 *   updateDataAsOf(__dirname);
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import * as crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface PrimaryKeyStrategy {
  type: "stable_id" | "url" | "url_fingerprint" | "fingerprint";
  stable_id_context_path?: string[];
  canonical_url_field?: string;
  fingerprint_fields?: string[];
}

export interface ExpectedVolumeRange {
  min: number;
  max: number;
}

export interface SourceConfig {
  source_id: string;
  display_name: string;
  entity_type: "person" | "company" | "both";
  data_as_of: string;
  start_urls: string[];
  run_command: string;
  refresh: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  primary_key_strategy: PrimaryKeyStrategy;
  expected_volume_range: ExpectedVolumeRange;
  notes?: string;
  requires_login?: boolean;
}

// ============================================================================
// Read Functions
// ============================================================================

/**
 * Load and parse source.yaml from a scraper directory.
 *
 * @param scraperDir - The directory containing source.yaml (usually __dirname)
 * @returns Parsed SourceConfig object
 * @throws Error if source.yaml is missing or invalid
 */
export function loadSourceConfig(scraperDir: string): SourceConfig {
  const sourcePath = path.join(scraperDir, "source.yaml");

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source.yaml not found in ${scraperDir}`);
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  const config = yaml.parse(content) as SourceConfig;

  // Validate required fields
  const requiredFields = [
    "source_id",
    "display_name",
    "entity_type",
    "data_as_of",
    "start_urls",
    "run_command",
    "refresh",
    "primary_key_strategy",
    "expected_volume_range",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      throw new Error(`Missing required field '${field}' in source.yaml`);
    }
  }

  // Validate entity_type
  if (!["person", "company", "both"].includes(config.entity_type)) {
    throw new Error(`Invalid entity_type: ${config.entity_type}`);
  }

  // Validate refresh
  if (!["daily", "weekly", "monthly", "quarterly", "yearly"].includes(config.refresh)) {
    throw new Error(`Invalid refresh: ${config.refresh}`);
  }

  return config;
}

/**
 * Get the effective entity_type for a single record.
 * For sources with entity_type="both", you must determine per-record.
 *
 * @param config - The source config
 * @param recordEntityType - Optional per-record entity type (required if config.entity_type is "both")
 * @returns "person" or "company"
 */
export function getRecordEntityType(
  config: SourceConfig,
  recordEntityType?: "person" | "company"
): "person" | "company" {
  if (config.entity_type === "both") {
    if (!recordEntityType) {
      throw new Error("entity_type is 'both' but no per-record entity type provided");
    }
    return recordEntityType;
  }
  return config.entity_type;
}

// ============================================================================
// Write Functions
// ============================================================================

/**
 * Update the data_as_of field in source.yaml to today's date.
 * Call this after a successful scrape run.
 *
 * @param scraperDir - The directory containing source.yaml (usually __dirname)
 * @param date - Optional date to set (defaults to today in YYYY-MM-DD format)
 */
export function updateDataAsOf(scraperDir: string, date?: string): void {
  const sourcePath = path.join(scraperDir, "source.yaml");

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source.yaml not found in ${scraperDir}`);
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  const config = yaml.parse(content);

  // Update data_as_of
  const newDate = date || new Date().toISOString().split("T")[0];
  config.data_as_of = newDate;

  // Write back with preserved formatting
  const newContent = yaml.stringify(config, {
    lineWidth: 0,  // Don't wrap lines
    defaultStringType: "QUOTE_DOUBLE",
  });

  fs.writeFileSync(sourcePath, newContent, "utf-8");
}

// ============================================================================
// Primary Key Helpers
// ============================================================================

/**
 * Generate a primary key based on the strategy in source.yaml.
 *
 * Key format: `source_id:key_type:value`
 * - stable_id: Uses last element of path as key_type (e.g., "cert" from ["context", "cert"])
 * - url: Uses "url" as key_type with URL pathname as value
 * - fingerprint: Uses "fp" as key_type with hash as value
 *
 * @param config - The source config
 * @param record - The record data (for extracting stable_id or fingerprint fields)
 * @param url - The raw URL (for url-based strategies)
 * @returns The generated primary key
 */
export function generatePrimaryKey(
  config: SourceConfig,
  record: Record<string, unknown>,
  url?: string
): string {
  const strategy = config.primary_key_strategy;
  const prefix = config.source_id;

  switch (strategy.type) {
    case "stable_id": {
      if (!strategy.stable_id_context_path || strategy.stable_id_context_path.length === 0) {
        throw new Error("stable_id strategy requires stable_id_context_path");
      }
      // Navigate to the value following the path
      let value: unknown = record;
      for (const key of strategy.stable_id_context_path) {
        if (value && typeof value === "object" && key in value) {
          value = (value as Record<string, unknown>)[key];
        } else {
          throw new Error(`Cannot find ${strategy.stable_id_context_path.join(".")} in record`);
        }
      }
      // Use the last path element as the key type for cleaner keys
      // e.g., ["context", "cert"] -> "cert", producing "source_id:cert:12345"
      const keyType = strategy.stable_id_context_path[strategy.stable_id_context_path.length - 1];
      return `${prefix}:${keyType}:${value}`;
    }

    case "url": {
      if (!url) {
        throw new Error("url strategy requires a URL");
      }
      // Extract path from URL for cleaner key
      try {
        const parsed = new URL(url);
        return `${prefix}:url:${parsed.pathname}`;
      } catch {
        return `${prefix}:url:${url}`;
      }
    }

    case "url_fingerprint": {
      if (!url) {
        throw new Error("url_fingerprint strategy requires a URL");
      }
      const fingerprint = hashFields(record, strategy.fingerprint_fields || []);
      try {
        const parsed = new URL(url);
        return `${prefix}:url:${parsed.pathname}:${fingerprint}`;
      } catch {
        return `${prefix}:url:${url}:${fingerprint}`;
      }
    }

    case "fingerprint": {
      const fingerprint = hashFields(record, strategy.fingerprint_fields || []);
      return `${prefix}:fp:${fingerprint}`;
    }

    default:
      throw new Error(`Unknown primary_key_strategy type: ${strategy.type}`);
  }
}

/**
 * Hash function for fingerprinting using SHA256.
 * Returns first 12 characters of hex digest.
 */
function hashFields(record: Record<string, unknown>, fields: string[]): string {
  const values: string[] = [];

  for (const field of fields) {
    const parts = field.split(".");
    let value: unknown = record;
    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = "";
        break;
      }
    }
    values.push(String(value || ""));
  }

  const str = values.join("|");
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, 12);
}

// ============================================================================
// Output Helpers
// ============================================================================

/**
 * Get standard output paths for a scraper.
 *
 * @param scraperDir - The directory containing source.yaml (usually __dirname)
 * @returns Object with paths to output files
 */
export function getOutputPaths(scraperDir: string) {
  const outputDir = path.join(scraperDir, "output");
  return {
    outputDir,
    leadsFile: path.join(outputDir, "leads.jsonl"),
    runFile: path.join(outputDir, "run.json"),
    progressFile: path.join(outputDir, "scrape-progress.json"),
    reviewSampleFile: path.join(outputDir, "review_sample.json"),
  };
}

/**
 * Ensure the output directory exists.
 *
 * @param scraperDir - The directory containing source.yaml (usually __dirname)
 */
export function ensureOutputDir(scraperDir: string): void {
  const { outputDir } = getOutputPaths(scraperDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}
