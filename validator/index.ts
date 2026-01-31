#!/usr/bin/env npx tsx
/**
 * Scraper Output Validator - Main Entry Point
 *
 * Validates that a scraper output folder conforms to the ScrappyPuffle data contract.
 *
 * Usage: npx tsx validator/index.ts <path-to-scraper-folder>
 * Example: npx tsx validator/index.ts final_data/finance/fdic
 */

import * as fs from "fs";
import * as path from "path";
import { ValidationError, ValidationResult } from "./types";
import {
  validateFolderStructure,
  validateSourceYaml,
  validateLeadsJsonl,
  validateRunJson,
} from "./validators";

// ============================================================================
// Main Validation Function
// ============================================================================

export function validate(folderPath: string): ValidationResult {
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

  // 2. Validate source.yaml
  const sourceYamlErrors = validateSourceYaml(absolutePath);
  allErrors.push(...sourceYamlErrors);

  // 3. Validate leads.jsonl (if exists)
  const { errors: leadsErrors, stats } = validateLeadsJsonl(absolutePath);
  allErrors.push(...leadsErrors);

  // 4. Validate run.json (if exists)
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

// ============================================================================
// Output Formatting
// ============================================================================

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

// ============================================================================
// CLI Entry Point
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx validator/index.ts <path-to-scraper-folder>");
    console.error("Example: npx tsx validator/index.ts final_data/finance/fdic");
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
export { ValidationResult, ValidationError } from "./types";
