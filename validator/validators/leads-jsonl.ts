/**
 * Leads JSONL Validator
 *
 * Validates each record in output/leads.jsonl:
 * - Valid JSON on each line
 * - core section with required fields (source_id, entity_type, scraped_at, raw_url, primary_key)
 * - entity_type must be "person" or "company"
 * - Exactly one of person or company section (matching entity_type)
 * - person.full_name required if entity_type is "person"
 * - company.company_name required if entity_type is "company"
 * - contact section required (can be empty {})
 * - context section required (can be empty {})
 * - primary_key format matches source.yaml strategy
 */

import * as fs from "fs";
import * as path from "path";
import { ValidationError, SourceConfig } from "../types";
import { loadSourceConfig } from "./source-yaml";
import { validatePrimaryKeyFormat } from "./primary-key";

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

export function validateLeadsJsonl(folderPath: string): {
  errors: ValidationError[];
  stats: { checked: number; valid: number; invalid: number };
} {
  const errors: ValidationError[] = [];
  const leadsPath = path.join(folderPath, "output", "leads.jsonl");

  if (!fs.existsSync(leadsPath)) {
    return { errors, stats: { checked: 0, valid: 0, invalid: 0 } };
  }

  // Load source.yaml to get primary_key_strategy
  const sourceConfig = loadSourceConfig(folderPath);

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

    // Validate primary_key format matches strategy
    if (sourceConfig?.source_id && sourceConfig?.primary_key_strategy) {
      const r = record as Record<string, unknown>;
      const core = r.core as Record<string, unknown> | undefined;
      if (core?.primary_key && typeof core.primary_key === "string") {
        const pkErrors = validatePrimaryKeyFormat(
          core.primary_key,
          sourceConfig.source_id,
          sourceConfig.primary_key_strategy,
          lineNum
        );
        recordErrors.push(...pkErrors);
      }
    }

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
