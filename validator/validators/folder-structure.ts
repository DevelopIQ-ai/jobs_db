/**
 * Folder Structure Validator
 *
 * Validates that the scraper folder has the required structure:
 * - output/ directory exists
 * - output/leads.jsonl exists
 * - output/run.json exists
 */

import * as fs from "fs";
import * as path from "path";
import { ValidationError } from "../types";

export function validateFolderStructure(folderPath: string): ValidationError[] {
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
