/**
 * Folder Structure Validator
 *
 * Validates that the scraper folder has the required structure:
 * - source.yaml exists
 * - scraper.ts exists
 * - README.md exists
 * - output/ directory exists
 * - output/leads.jsonl exists
 * - output/run.json exists
 * - output/review_sample.json exists
 * - output/process_documentation.txt exists
 */

import * as fs from "fs";
import * as path from "path";
import { ValidationError } from "../types";

export function validateFolderStructure(folderPath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check root-level required files
  const requiredRootFiles = [
    { file: "source.yaml", description: "Source configuration file" },
    { file: "scraper.ts", description: "Scraper implementation" },
    { file: "README.md", description: "Documentation file" },
  ];

  for (const { file, description } of requiredRootFiles) {
    const filePath = path.join(folderPath, file);
    if (!fs.existsSync(filePath)) {
      errors.push({
        type: "structure",
        file,
        message: `Missing required '${file}' (${description})`,
      });
    } else if (!fs.statSync(filePath).isFile()) {
      errors.push({
        type: "structure",
        file,
        message: `'${file}' exists but is not a file`,
      });
    }
  }

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

  // Check required files in output directory
  const requiredOutputFiles = [
    { file: "leads.jsonl", description: "Scraped data in JSONL format" },
    { file: "run.json", description: "Run metadata and statistics" },
    { file: "review_sample.json", description: "Sample records for human review (AGENTS.md Step 10)" },
    { file: "process_documentation.txt", description: "Debugging and process documentation journal" },
  ];

  for (const { file, description } of requiredOutputFiles) {
    const filePath = path.join(outputDir, file);
    if (!fs.existsSync(filePath)) {
      errors.push({
        type: "structure",
        file: `output/${file}`,
        message: `Missing required 'output/${file}' (${description})`,
      });
    } else if (!fs.statSync(filePath).isFile()) {
      errors.push({
        type: "structure",
        file: `output/${file}`,
        message: `'output/${file}' exists but is not a file`,
      });
    }
  }

  return errors;
}
