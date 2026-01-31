#!/usr/bin/env npx tsx
/**
 * Legacy entry point - redirects to index.ts
 *
 * For backwards compatibility. Use `npx tsx validator/index.ts` instead.
 */

import * as path from "path";
import { validate } from "./index";
import { ValidationError } from "./types";

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
    console.error("Usage: npx tsx validator/validate-scraper-output.ts <path-to-scraper-folder>");
    console.error("Example: npx tsx validator/validate-scraper-output.ts final_data/finance/fdic");
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

// Re-export for programmatic use
export { validate, ValidationError, ValidationResult } from "./index";
