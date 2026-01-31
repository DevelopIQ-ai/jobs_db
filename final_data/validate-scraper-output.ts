#!/usr/bin/env npx tsx
/**
 * Scraper Output Validator
 * Validates that a scraper output folder conforms to the ScrappyPuffle data contract.
 *
 * Usage: npx tsx validate-scraper-output.ts <path-to-scraper-folder>
 * Example: npx tsx validate-scraper-output.ts ./law/skadden
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

interface ValidationError {
  type: "structure" | "format" | "schema";
  file: string;
  line?: number;
  field?: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  stats: {
    recordsChecked: number;
    recordsValid: number;
    recordsInvalid: number;
  };
}

interface CoreSection {
  source_id: string;
  entity_type: "person" | "company";
  scraped_at: string;
  raw_url: string;
  primary_key: string;
}

interface PersonSection {
  full_name: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  suffix?: string;
  title?: string;
  company_name?: string;
  profile_url?: string;
  name_raw?: string;
}

interface CompanySection {
  company_name: string;
  legal_name?: string;
  domain?: string;
  industry?: string;
  size?: number;
  founded_year?: number;
  profile_url?: string;
  name_raw?: string;
}

interface ContactSection {
  email?: string;
  phone?: string;
  website?: string;
  socials?: Array<{ platform: string; url: string }>;
  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

interface LeadRecord {
  core: CoreSection;
  person?: PersonSection;
  company?: CompanySection;
  contact: ContactSection;
  context: Record<string, unknown>;
}

interface RunJson {
  source_id: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  records_found: number;
  records_valid: number;
  records_written: number;
  error_count: number;
}

// ============================================================================
// Validators
// ============================================================================

function validateFolderStructure(folderPath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check output directory exists
  const outputDir = path.join(folderPath, "output");
  if (!fs.existsSync(outputDir)) {
    errors.push({
      type: "structure",
      file: "output/",
      message: "Missing required 'output/' directory",
    });
    return errors; // Can't continue without output dir
  }

  if (!fs.statSync(outputDir).isDirectory()) {
    errors.push({
      type: "structure",
      file: "output/",
      message: "'output' exists but is not a directory",
    });
    return errors;
  }

  // Check leads.jsonl exists
  const leadsPath = path.join(outputDir, "leads.jsonl");
  if (!fs.existsSync(leadsPath)) {
    errors.push({
      type: "structure",
      file: "output/leads.jsonl",
      message: "Missing required 'output/leads.jsonl' file",
    });
  }

  // Check run.json exists
  const runPath = path.join(outputDir, "run.json");
  if (!fs.existsSync(runPath)) {
    errors.push({
      type: "structure",
      file: "output/run.json",
      message: "Missing required 'output/run.json' file",
    });
  }

  return errors;
}

function validateCoreSection(
  core: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (!core || typeof core !== "object") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "core",
      message: "Missing or invalid 'core' section",
    });
    return errors;
  }

  const c = core as Record<string, unknown>;

  // Required fields
  const requiredFields = [
    "source_id",
    "entity_type",
    "scraped_at",
    "raw_url",
    "primary_key",
  ];

  for (const field of requiredFields) {
    if (!c[field] || typeof c[field] !== "string") {
      errors.push({
        type: "schema",
        file,
        line: lineNum,
        field: `core.${field}`,
        message: `Missing or invalid required field 'core.${field}'`,
      });
    }
  }

  // Validate entity_type value
  if (c.entity_type && !["person", "company"].includes(c.entity_type as string)) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "core.entity_type",
      message: `Invalid entity_type: '${c.entity_type}'. Must be 'person' or 'company'`,
    });
  }

  // Validate scraped_at is ISO timestamp
  if (c.scraped_at && typeof c.scraped_at === "string") {
    const date = new Date(c.scraped_at);
    if (isNaN(date.getTime())) {
      errors.push({
        type: "schema",
        file,
        line: lineNum,
        field: "core.scraped_at",
        message: `Invalid ISO timestamp: '${c.scraped_at}'`,
      });
    }
  }

  // Validate primary_key is not empty
  if (c.primary_key && typeof c.primary_key === "string" && c.primary_key.trim() === "") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "core.primary_key",
      message: "primary_key cannot be empty",
    });
  }

  return errors;
}

function validatePersonSection(
  person: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (!person || typeof person !== "object") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "person",
      message: "Invalid 'person' section (must be an object)",
    });
    return errors;
  }

  const p = person as Record<string, unknown>;

  if (!p.full_name || typeof p.full_name !== "string") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "person.full_name",
      message: "Missing or invalid required field 'person.full_name'",
    });
  }

  return errors;
}

function validateCompanySection(
  company: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (!company || typeof company !== "object") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "company",
      message: "Invalid 'company' section (must be an object)",
    });
    return errors;
  }

  const c = company as Record<string, unknown>;

  if (!c.company_name || typeof c.company_name !== "string") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "company.company_name",
      message: "Missing or invalid required field 'company.company_name'",
    });
  }

  return errors;
}

function validateContactSection(
  contact: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (contact === undefined || contact === null) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "contact",
      message: "Missing 'contact' section (use {} if empty)",
    });
    return errors;
  }

  if (typeof contact !== "object") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "contact",
      message: "Invalid 'contact' section (must be an object)",
    });
  }

  return errors;
}

function validateContextSection(
  context: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (context === undefined || context === null) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "context",
      message: "Missing 'context' section (use {} if empty)",
    });
    return errors;
  }

  if (typeof context !== "object") {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "context",
      message: "Invalid 'context' section (must be an object)",
    });
  }

  return errors;
}

function validateLeadRecord(
  record: unknown,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  if (!record || typeof record !== "object") {
    errors.push({
      type: "format",
      file,
      line: lineNum,
      message: "Record is not a valid JSON object",
    });
    return errors;
  }

  const r = record as Record<string, unknown>;

  // Validate core section
  errors.push(...validateCoreSection(r.core, lineNum));

  // Check entity type matches entity section
  const entityType = (r.core as Record<string, unknown>)?.entity_type;
  const hasPerson = "person" in r;
  const hasCompany = "company" in r;

  if (hasPerson && hasCompany) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      message: "Record has both 'person' and 'company' sections. Must have exactly one.",
    });
  } else if (!hasPerson && !hasCompany) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      message: "Record missing entity section. Must have 'person' or 'company'.",
    });
  } else {
    // Validate entity section matches entity_type
    if (entityType === "person") {
      if (!hasPerson) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          message: "entity_type is 'person' but 'person' section is missing",
        });
      } else {
        errors.push(...validatePersonSection(r.person, lineNum));
      }
      if (hasCompany) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          message: "entity_type is 'person' but record has 'company' section",
        });
      }
    } else if (entityType === "company") {
      if (!hasCompany) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          message: "entity_type is 'company' but 'company' section is missing",
        });
      } else {
        errors.push(...validateCompanySection(r.company, lineNum));
      }
      if (hasPerson) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          message: "entity_type is 'company' but record has 'person' section",
        });
      }
    }
  }

  // Validate contact and context sections
  errors.push(...validateContactSection(r.contact, lineNum));
  errors.push(...validateContextSection(r.context, lineNum));

  return errors;
}

function validateLeadsJsonl(folderPath: string): {
  errors: ValidationError[];
  stats: { checked: number; valid: number; invalid: number };
} {
  const errors: ValidationError[] = [];
  const leadsPath = path.join(folderPath, "output", "leads.jsonl");

  if (!fs.existsSync(leadsPath)) {
    return { errors, stats: { checked: 0, valid: 0, invalid: 0 } };
  }

  const content = fs.readFileSync(leadsPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Try to parse JSON
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (e) {
      errors.push({
        type: "format",
        file: "output/leads.jsonl",
        line: lineNum,
        message: `Invalid JSON: ${(e as Error).message}`,
      });
      invalidCount++;
      continue;
    }

    // Validate the record
    const recordErrors = validateLeadRecord(record, lineNum);
    if (recordErrors.length > 0) {
      errors.push(...recordErrors);
      invalidCount++;
    } else {
      validCount++;
    }
  }

  return {
    errors,
    stats: { checked: lines.length, valid: validCount, invalid: invalidCount },
  };
}

function validateRunJson(folderPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const runPath = path.join(folderPath, "output", "run.json");
  const file = "output/run.json";

  if (!fs.existsSync(runPath)) {
    return errors;
  }

  let content: string;
  try {
    content = fs.readFileSync(runPath, "utf-8");
  } catch (e) {
    errors.push({
      type: "format",
      file,
      message: `Cannot read file: ${(e as Error).message}`,
    });
    return errors;
  }

  let run: unknown;
  try {
    run = JSON.parse(content);
  } catch (e) {
    errors.push({
      type: "format",
      file,
      message: `Invalid JSON: ${(e as Error).message}`,
    });
    return errors;
  }

  if (!run || typeof run !== "object") {
    errors.push({
      type: "schema",
      file,
      message: "run.json must be a JSON object",
    });
    return errors;
  }

  const r = run as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["source_id", "run_id", "started_at", "ended_at"];
  for (const field of requiredStrings) {
    if (!r[field] || typeof r[field] !== "string") {
      errors.push({
        type: "schema",
        file,
        field,
        message: `Missing or invalid required field '${field}'`,
      });
    }
  }

  // Required number fields
  const requiredNumbers = [
    "records_found",
    "records_valid",
    "records_written",
    "error_count",
  ];
  for (const field of requiredNumbers) {
    if (typeof r[field] !== "number") {
      errors.push({
        type: "schema",
        file,
        field,
        message: `Missing or invalid required field '${field}' (must be a number)`,
      });
    }
  }

  // Validate timestamps
  for (const field of ["started_at", "ended_at"]) {
    if (r[field] && typeof r[field] === "string") {
      const date = new Date(r[field] as string);
      if (isNaN(date.getTime())) {
        errors.push({
          type: "schema",
          file,
          field,
          message: `Invalid ISO timestamp: '${r[field]}'`,
        });
      }
    }
  }

  return errors;
}

// ============================================================================
// Main
// ============================================================================

function validate(folderPath: string): ValidationResult {
  const absolutePath = path.resolve(folderPath);

  if (!fs.existsSync(absolutePath)) {
    return {
      valid: false,
      errors: [
        {
          type: "structure",
          file: folderPath,
          message: `Folder does not exist: ${absolutePath}`,
        },
      ],
      stats: { recordsChecked: 0, recordsValid: 0, recordsInvalid: 0 },
    };
  }

  const allErrors: ValidationError[] = [];

  // 1. Validate folder structure
  const structureErrors = validateFolderStructure(absolutePath);
  allErrors.push(...structureErrors);

  // 2. Validate leads.jsonl (if exists)
  const { errors: leadsErrors, stats } = validateLeadsJsonl(absolutePath);
  allErrors.push(...leadsErrors);

  // 3. Validate run.json (if exists)
  const runErrors = validateRunJson(absolutePath);
  allErrors.push(...runErrors);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    stats: {
      recordsChecked: stats.checked,
      recordsValid: stats.valid,
      recordsInvalid: stats.invalid,
    },
  };
}

function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";

  const grouped: Record<string, ValidationError[]> = {};
  for (const err of errors) {
    const key = err.file;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(err);
  }

  let output = "";
  for (const [file, fileErrors] of Object.entries(grouped)) {
    output += `\n${file}:\n`;
    for (const err of fileErrors) {
      const lineInfo = err.line ? `:${err.line}` : "";
      const fieldInfo = err.field ? ` [${err.field}]` : "";
      output += `  ${err.type}${lineInfo}${fieldInfo}: ${err.message}\n`;
    }
  }

  return output;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx validate-scraper-output.ts <path-to-scraper-folder>");
    console.error("Example: npx tsx validate-scraper-output.ts ./law/skadden");
    process.exit(1);
  }

  const folderPath = args[0];
  const result = validate(folderPath);

  console.log("\n========================================");
  console.log("  SCRAPER OUTPUT VALIDATION");
  console.log("========================================\n");
  console.log(`Folder: ${path.resolve(folderPath)}`);
  console.log(`Records checked: ${result.stats.recordsChecked}`);
  console.log(`Records valid: ${result.stats.recordsValid}`);
  console.log(`Records invalid: ${result.stats.recordsInvalid}`);
  console.log(`Total errors: ${result.errors.length}`);

  if (result.valid) {
    console.log("\n✓ VALID - All checks passed\n");
    process.exit(0);
  } else {
    console.log("\n✗ INVALID - Errors found:");
    console.log(formatErrors(result.errors));
    process.exit(1);
  }
}

// Export for programmatic use
export { validate, ValidationResult, ValidationError };
