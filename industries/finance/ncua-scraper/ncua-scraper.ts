import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const EXTRACTED_DIR = path.join(__dirname, "extracted");

interface CreditUnion {
  cuNumber: number;
  name: string;
  city: string;
  state: string;
  stateCode: number;
  zipCode: string;
  street: string;
  county: string;
  yearOpened: number;
  charterDate: string;
  peerGroup: number;
  isMDI: boolean;
  totalAssets: number | null;
  memberCount: number | null;
  fullTimeEmployees: number | null;
  partTimeEmployees: number | null;
  totalEmployees: number | null;
  totalAssetsFormatted: string;
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

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.log("=== NCUA Credit Union Scraper ===\n");

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

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

  const creditUnions: CreditUnion[] = [];

  for (const cuNum of cuNumbers) {
    const name = getFieldValue(foicu, cuNum, "CU_NAME");
    const city = getFieldValue(foicu, cuNum, "CITY");
    const state = getFieldValue(foicu, cuNum, "STATE");
    const stateCode = parseInt(getFieldValue(foicu, cuNum, "STATE_CODE"), 10) || 0;
    const zipCode = getFieldValue(foicu, cuNum, "ZIP_CODE");
    const street = getFieldValue(foicu, cuNum, "STREET");
    const yearOpened = parseInt(getFieldValue(foicu, cuNum, "YEAR_OPENED"), 10) || 0;
    const charterDate = getFieldValue(foicu, cuNum, "ISSUE_DATE");
    const peerGroup = parseInt(getFieldValue(foicu, cuNum, "PEER_GROUP"), 10) || 0;
    const isMDI = getFieldValue(foicu, cuNum, "ISMDI").toLowerCase() === "true";

    // Get assets from FS220 (ACCT_010)
    const assetsStr = getFieldValue(fs220, cuNum, "ACCT_010");
    const totalAssets = assetsStr ? parseInt(assetsStr, 10) : null;

    // Get member count from FS220 (ACCT_083)
    const membersStr = getFieldValue(fs220, cuNum, "ACCT_083");
    const memberCount = membersStr ? parseInt(membersStr, 10) : null;

    // Get employee counts from FS220A
    const ftStr = getFieldValue(fs220a, cuNum, "ACCT_564A");
    const ptStr = getFieldValue(fs220a, cuNum, "ACCT_564B");
    const fullTimeEmployees = ftStr ? parseInt(ftStr, 10) : null;
    const partTimeEmployees = ptStr ? parseInt(ptStr, 10) : null;
    const totalEmployees =
      fullTimeEmployees !== null || partTimeEmployees !== null
        ? (fullTimeEmployees || 0) + (partTimeEmployees || 0)
        : null;

    creditUnions.push({
      cuNumber: cuNum,
      name,
      city,
      state,
      stateCode,
      zipCode,
      street,
      county: "", // Not in FOICU directly
      yearOpened,
      charterDate,
      peerGroup,
      isMDI,
      totalAssets,
      memberCount,
      fullTimeEmployees,
      partTimeEmployees,
      totalEmployees,
      totalAssetsFormatted: formatAssets(totalAssets),
    });
  }

  // Sort by assets descending
  creditUnions.sort((a, b) => (b.totalAssets ?? 0) - (a.totalAssets ?? 0));

  // Generate CSV
  const headers = [
    "CU Number",
    "Name",
    "Street",
    "City",
    "State",
    "ZIP",
    "Year Opened",
    "Charter Date",
    "Peer Group",
    "Is MDI",
    "Total Assets",
    "Total Assets (formatted)",
    "Member Count",
    "Full-Time Employees",
    "Part-Time Employees",
    "Total Employees",
  ];

  const csvRows = [headers.join(",")];
  for (const cu of creditUnions) {
    csvRows.push(
      [
        escapeCSV(cu.cuNumber),
        escapeCSV(cu.name),
        escapeCSV(cu.street),
        escapeCSV(cu.city),
        escapeCSV(cu.state),
        escapeCSV(cu.zipCode),
        escapeCSV(cu.yearOpened),
        escapeCSV(cu.charterDate),
        escapeCSV(cu.peerGroup),
        escapeCSV(cu.isMDI),
        escapeCSV(cu.totalAssets),
        escapeCSV(cu.totalAssetsFormatted),
        escapeCSV(cu.memberCount),
        escapeCSV(cu.fullTimeEmployees),
        escapeCSV(cu.partTimeEmployees),
        escapeCSV(cu.totalEmployees),
      ].join(",")
    );
  }

  const csvPath = path.join(OUTPUT_DIR, "ncua-credit-unions.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n"));

  // Summary stats
  const withAssets = creditUnions.filter((cu) => cu.totalAssets !== null);
  const under5B = withAssets.filter((cu) => (cu.totalAssets ?? 0) < 5_000_000_000);
  const smallTeam = creditUnions.filter(
    (cu) => cu.totalEmployees !== null && cu.totalEmployees < 150
  );

  console.log("\n=== Summary ===");
  console.log(`Total credit unions: ${creditUnions.length}`);
  console.log(`Credit unions with asset data: ${withAssets.length}`);
  console.log(`Credit unions under $5B AUM: ${under5B.length}`);
  console.log(`Credit unions with <150 employees: ${smallTeam.length}`);
  console.log(`\nCSV saved to: ${csvPath}`);
}

main().catch(console.error);
