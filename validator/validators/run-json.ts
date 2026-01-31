/**
 * Run JSON Validator
 *
 * Validates the output/run.json file:
 * - Required string fields: source_id, run_id, started_at, ended_at
 * - Required number fields: records_found, records_valid, records_written, error_count
 * - Timestamps must be valid ISO format
 */

import * as fs from "fs";
import * as path from "path";
import { ValidationError } from "../types";

export function validateRunJson(folderPath: string): ValidationError[] {
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
