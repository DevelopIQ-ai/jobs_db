import * as fs from "fs";
import * as path from "path";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);
const RAW_URL = "https://ncua.gov/analysis/credit-union-corporate-call-report-data";
const EXTRACTED_DIR = path.join(__dirname, "extracted");

interface LeadRecord {
  core: {
    source_id: string;
    entity_type: "company";
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  company: {
    company_name: string;
  };
  contact: {
    location?: {
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
  };
  context: Record<string, unknown>;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function readCSVFile(filename: string): Map<string, Map<number, string>> {
  const filepath = path.join(EXTRACTED_DIR, filename);
  const content = fs.readFileSync(filepath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const headers = parseCSVLine(lines[0]);
  const cuNumberIdx = headers.findIndex((h) => h.toUpperCase() === "CU_NUMBER");

  const data = new Map<string, Map<number, string>>();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const cuNumber = parseInt(values[cuNumberIdx], 10);
    if (isNaN(cuNumber)) continue;

    const row = new Map<number, string>();
    for (let j = 0; j < headers.length; j++) {
      row.set(j, values[j] || "");
    }

    // Use column index as key since we need to look up by header name
    if (!data.has("_headers")) {
      const headerMap = new Map<number, string>();
      headers.forEach((h, idx) => headerMap.set(idx, h.toUpperCase()));
      data.set("_headers", headerMap);
    }

    data.set(cuNumber.toString(), row);
  }

  return data;
}

function getFieldValue(
  data: Map<string, Map<number, string>>,
  cuNumber: number,
  fieldName: string
): string {
  const headers = data.get("_headers");
  const row = data.get(cuNumber.toString());
  if (!headers || !row) return "";

  for (const [idx, header] of headers.entries()) {
    if (header === fieldName.toUpperCase()) {
      return row.get(idx) || "";
    }
  }
  return "";
}

function formatAssets(assets: number | null): string {
  if (assets === null) return "N/A";
  if (assets >= 1_000_000_000) {
    return `$${(assets / 1_000_000_000).toFixed(2)}B`;
  } else if (assets >= 1_000_000) {
    return `$${(assets / 1_000_000).toFixed(2)}M`;
  } else if (assets >= 1_000) {
    return `$${(assets / 1_000).toFixed(2)}K`;
  }
  return `$${assets.toLocaleString()}`;
}

async function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log("=== NCUA Credit Union Scraper ===\n");

  // Ensure output directory exists
  ensureOutputDir(__dirname);

  // Check if extracted files exist
  const requiredFiles = ["FOICU.txt", "FS220.txt", "FS220A.txt"];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(EXTRACTED_DIR, file))) {
      console.error(`Missing file: ${file}. Please extract the NCUA data first.`);
      process.exit(1);
    }
  }

  // Read data files
  console.log("Reading FOICU.txt (credit union info)...");
  const foicu = readCSVFile("FOICU.txt");

  console.log("Reading FS220.txt (financials - assets, members)...");
  const fs220 = readCSVFile("FS220.txt");

  console.log("Reading FS220A.txt (employee counts)...");
  const fs220a = readCSVFile("FS220A.txt");

  // Get all CU numbers from FOICU
  const cuNumbers: number[] = [];
  for (const key of foicu.keys()) {
    if (key !== "_headers") {
      cuNumbers.push(parseInt(key, 10));
    }
  }

  console.log(`\nProcessing ${cuNumbers.length} credit unions...`);

  // Build records with all data for sorting
  const cuData: Array<{
    cuNumber: number;
    name: string;
    city: string;
    state: string;
    zipCode: string;
    street: string;
    yearOpened: number;
    charterDate: string;
    peerGroup: number;
    isMDI: boolean;
    totalAssets: number | null;
    memberCount: number | null;
    fullTimeEmployees: number | null;
    partTimeEmployees: number | null;
    totalEmployees: number | null;
  }> = [];

  for (const cuNum of cuNumbers) {
    const name = getFieldValue(foicu, cuNum, "CU_NAME");
    const city = getFieldValue(foicu, cuNum, "CITY");
    const state = getFieldValue(foicu, cuNum, "STATE");
    const zipCode = getFieldValue(foicu, cuNum, "ZIP_CODE");
    const street = getFieldValue(foicu, cuNum, "STREET");
    const yearOpened = parseInt(getFieldValue(foicu, cuNum, "YEAR_OPENED"), 10) || 0;
    const charterDate = getFieldValue(foicu, cuNum, "ISSUE_DATE");
    const peerGroup = parseInt(getFieldValue(foicu, cuNum, "PEER_GROUP"), 10) || 0;
    const isMDI = getFieldValue(foicu, cuNum, "ISMDI").toLowerCase() === "true";

    const assetsStr = getFieldValue(fs220, cuNum, "ACCT_010");
    const totalAssets = assetsStr ? parseInt(assetsStr, 10) : null;

    const membersStr = getFieldValue(fs220, cuNum, "ACCT_083");
    const memberCount = membersStr ? parseInt(membersStr, 10) : null;

    const ftStr = getFieldValue(fs220a, cuNum, "ACCT_564A");
    const ptStr = getFieldValue(fs220a, cuNum, "ACCT_564B");
    const fullTimeEmployees = ftStr ? parseInt(ftStr, 10) : null;
    const partTimeEmployees = ptStr ? parseInt(ptStr, 10) : null;
    const totalEmployees =
      fullTimeEmployees !== null || partTimeEmployees !== null
        ? (fullTimeEmployees || 0) + (partTimeEmployees || 0)
        : null;

    cuData.push({
      cuNumber: cuNum, name, city, state, zipCode, street,
      yearOpened, charterDate, peerGroup, isMDI,
      totalAssets, memberCount, fullTimeEmployees, partTimeEmployees, totalEmployees,
    });
  }

  // Sort by assets descending
  cuData.sort((a, b) => (b.totalAssets ?? 0) - (a.totalAssets ?? 0));

  // Convert to JSONL
  console.log("Writing leads.jsonl...");
  const records: string[] = [];

  for (const cu of cuData) {
    const record: LeadRecord = {
      core: {
        source_id: config.source_id,
        entity_type: "company",
        scraped_at: startTime,
        raw_url: RAW_URL,
        primary_key: "", // Will be set below
      },
      company: {
        company_name: cu.name,
      },
      contact: {
        location: {
          city: cu.city || undefined,
          state: cu.state || undefined,
          zip: cu.zipCode || undefined,
          country: "USA",
        },
      },
      context: {
        cu_number: cu.cuNumber,
        street: cu.street || undefined,
        year_opened: cu.yearOpened || undefined,
        charter_date: cu.charterDate || undefined,
        peer_group: cu.peerGroup || undefined,
        is_mdi: cu.isMDI,
        total_assets: cu.totalAssets ?? undefined,
        total_assets_formatted: formatAssets(cu.totalAssets),
        member_count: cu.memberCount ?? undefined,
        full_time_employees: cu.fullTimeEmployees ?? undefined,
        part_time_employees: cu.partTimeEmployees ?? undefined,
        total_employees: cu.totalEmployees ?? undefined,
      },
    };
    // Generate primary key using strategy from source.yaml
    record.core.primary_key = generatePrimaryKey(config, record as unknown as Record<string, unknown>, RAW_URL);
    records.push(JSON.stringify(record));
  }

  fs.writeFileSync(paths.leadsFile, records.join("\n") + "\n");

  // Write run.json
  const endTime = new Date().toISOString();
  const runJson = {
    source_id: config.source_id,
    run_id: runId,
    started_at: startTime,
    ended_at: endTime,
    records_found: cuNumbers.length,
    records_valid: records.length,
    records_written: records.length,
    error_count: 0,
  };
  fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

  // Update data_as_of in source.yaml
  updateDataAsOf(__dirname);

  console.log("\n=== Summary ===");
  console.log(`Total credit unions: ${records.length}`);
  console.log(`\nOutput: ${paths.leadsFile}`);
  console.log(`Run metadata: ${paths.runFile}`);
}

main().catch(console.error);
