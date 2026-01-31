/**
 * Source YAML Validator
 *
 * Validates the source.yaml configuration file:
 * - Required fields: source_id, display_name, entity_type, data_as_of,
 *   start_urls, run_command, refresh, primary_key_strategy, expected_volume_range
 * - entity_type must be "person", "company", or "both"
 * - refresh must be "daily", "weekly", "monthly", "quarterly", or "yearly"
 * - data_as_of must be YYYY-MM-DD format
 * - primary_key_strategy.type must be valid
 * - expected_volume_range must have min and max numbers
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { ValidationError, SourceConfig } from "../types";

export function validateSourceYaml(folderPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const sourcePath = path.join(folderPath, "source.yaml");
  const file = "source.yaml";

  if (!fs.existsSync(sourcePath)) {
    errors.push({
      type: "structure",
      file,
      message: "Missing required 'source.yaml' file",
    });
    return errors;
  }

  let content: string;
  try {
    content = fs.readFileSync(sourcePath, "utf-8");
  } catch (e) {
    errors.push({
      type: "format",
      file,
      message: `Cannot read file: ${(e as Error).message}`,
    });
    return errors;
  }

  let source: unknown;
  try {
    source = yaml.parse(content);
  } catch (e) {
    errors.push({
      type: "format",
      file,
      message: `Invalid YAML: ${(e as Error).message}`,
    });
    return errors;
  }

  if (!source || typeof source !== "object") {
    errors.push({
      type: "schema",
      file,
      message: "source.yaml must be a YAML object",
    });
    return errors;
  }

  const s = source as Record<string, unknown>;

  // Required string fields
  const requiredStrings = [
    "source_id",
    "display_name",
    "entity_type",
    "data_as_of",
    "run_command",
    "refresh",
  ];
  for (const field of requiredStrings) {
    if (!s[field] || typeof s[field] !== "string") {
      errors.push({
        type: "schema",
        file,
        field,
        message: `Missing or invalid required field '${field}'`,
      });
    }
  }

  // Validate entity_type value
  const validEntityTypes = ["person", "company", "both"];
  if (s.entity_type && !validEntityTypes.includes(s.entity_type as string)) {
    errors.push({
      type: "schema",
      file,
      field: "entity_type",
      message: `Invalid entity_type: '${s.entity_type}'. Must be 'person', 'company', or 'both'`,
    });
  }

  // Validate refresh value
  const validRefreshValues = ["daily", "weekly", "monthly", "quarterly", "yearly"];
  if (s.refresh && !validRefreshValues.includes(s.refresh as string)) {
    errors.push({
      type: "schema",
      file,
      field: "refresh",
      message: `Invalid refresh: '${s.refresh}'. Must be one of: ${validRefreshValues.join(", ")}`,
    });
  }

  // Validate data_as_of is ISO date format (YYYY-MM-DD)
  if (s.data_as_of && typeof s.data_as_of === "string") {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(s.data_as_of)) {
      errors.push({
        type: "schema",
        file,
        field: "data_as_of",
        message: `Invalid date format: '${s.data_as_of}'. Must be YYYY-MM-DD`,
      });
    }
  }

  // Validate start_urls is an array
  if (!s.start_urls || !Array.isArray(s.start_urls)) {
    errors.push({
      type: "schema",
      file,
      field: "start_urls",
      message: "Missing or invalid required field 'start_urls' (must be an array)",
    });
  } else if (s.start_urls.length === 0) {
    errors.push({
      type: "schema",
      file,
      field: "start_urls",
      message: "'start_urls' must contain at least one URL",
    });
  }

  // Validate primary_key_strategy is an object
  if (!s.primary_key_strategy || typeof s.primary_key_strategy !== "object") {
    errors.push({
      type: "schema",
      file,
      field: "primary_key_strategy",
      message: "Missing or invalid required field 'primary_key_strategy' (must be an object)",
    });
  } else {
    const pks = s.primary_key_strategy as Record<string, unknown>;
    const validTypes = ["stable_id", "url", "url_fingerprint", "fingerprint"];
    if (!pks.type || !validTypes.includes(pks.type as string)) {
      errors.push({
        type: "schema",
        file,
        field: "primary_key_strategy.type",
        message: `Invalid or missing type. Must be one of: ${validTypes.join(", ")}`,
      });
    }
  }

  // Validate expected_volume_range is an object with min/max
  if (!s.expected_volume_range || typeof s.expected_volume_range !== "object") {
    errors.push({
      type: "schema",
      file,
      field: "expected_volume_range",
      message: "Missing or invalid required field 'expected_volume_range' (must be an object with min/max)",
    });
  } else {
    const evr = s.expected_volume_range as Record<string, unknown>;
    if (typeof evr.min !== "number") {
      errors.push({
        type: "schema",
        file,
        field: "expected_volume_range.min",
        message: "Missing or invalid 'expected_volume_range.min' (must be a number)",
      });
    }
    if (typeof evr.max !== "number") {
      errors.push({
        type: "schema",
        file,
        field: "expected_volume_range.max",
        message: "Missing or invalid 'expected_volume_range.max' (must be a number)",
      });
    }
  }

  return errors;
}

/**
 * Load and parse source.yaml, returning the config or null if invalid
 */
export function loadSourceConfig(folderPath: string): SourceConfig | null {
  const sourcePath = path.join(folderPath, "source.yaml");
  if (!fs.existsSync(sourcePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(sourcePath, "utf-8");
    return yaml.parse(content) || null;
  } catch {
    return null;
  }
}
