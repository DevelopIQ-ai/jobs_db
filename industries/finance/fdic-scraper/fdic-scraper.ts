import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const INSTITUTIONS_API = "https://api.fdic.gov/banks/institutions";
const FINANCIALS_API = "https://api.fdic.gov/banks/financials";
const BATCH_SIZE = 1000;

interface Institution {
  CERT: number;
  NAME: string;
  ADDRESS: string;
  CITY: string;
  STNAME: string;
  STALP: string;
  ZIP: string;
  COUNTY: string;
  WEBADDR: string;
  BKCLASS: string;
  ESTYMD: string;
  INSDATE: string;
}

interface Financial {
  CERT: number;
  ASSET: number;
  NUMEMP: number;
  REPDTE: string;
}

interface BankRecord {
  cert: number;
  name: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  zip: string;
  county: string;
  website: string;
  bankClass: string;
  established: string;
  insuredDate: string;
  totalAssets: number | null;
  totalAssetsFormatted: string;
  employeeCount: number | null;
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1}/${retries} for ${url}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function fetchAllInstitutions(): Promise<Institution[]> {
  console.log("Fetching active institutions...");
  const fields = "CERT,NAME,ADDRESS,CITY,STNAME,STALP,ZIP,COUNTY,WEBADDR,BKCLASS,ESTYMD,INSDATE";
  const allInstitutions: Institution[] = [];
  let offset = 0;

  while (true) {
    const url = `${INSTITUTIONS_API}?filters=ACTIVE:1&fields=${fields}&limit=${BATCH_SIZE}&offset=${offset}`;
    const data = await fetchWithRetry(url);

    const institutions = data.data.map((d: any) => d.data as Institution);
    allInstitutions.push(...institutions);

    console.log(`  Fetched ${allInstitutions.length} / ${data.meta.total} institutions`);

    if (allInstitutions.length >= data.meta.total) break;
    offset += BATCH_SIZE;
  }

  return allInstitutions;
}

async function fetchLatestFinancials(): Promise<Map<number, Financial>> {
  console.log("Fetching latest financials...");

  // Get the latest report date first
  const latestUrl = `${FINANCIALS_API}?limit=1&sort_by=REPDTE&sort_order=DESC&fields=REPDTE`;
  const latestData = await fetchWithRetry(latestUrl);
  const latestDate = latestData.data[0]?.data?.REPDTE;
  console.log(`  Latest report date: ${latestDate}`);

  const fields = "CERT,ASSET,NUMEMP,REPDTE";
  const financialsMap = new Map<number, Financial>();
  let offset = 0;

  // Filter by latest report date to get current financials
  while (true) {
    const url = `${FINANCIALS_API}?filters=REPDTE:${latestDate}&fields=${fields}&limit=${BATCH_SIZE}&offset=${offset}`;
    const data = await fetchWithRetry(url);

    for (const d of data.data) {
      const fin = d.data as Financial;
      financialsMap.set(fin.CERT, fin);
    }

    console.log(`  Fetched ${financialsMap.size} / ${data.meta.total} financial records`);

    if (financialsMap.size >= data.meta.total || data.data.length === 0) break;
    offset += BATCH_SIZE;
  }

  return financialsMap;
}

function formatAssets(assets: number | null): string {
  if (assets === null || assets === undefined) return "N/A";
  // Assets are in thousands, convert to actual value
  const actualValue = assets * 1000;
  if (actualValue >= 1_000_000_000) {
    return `$${(actualValue / 1_000_000_000).toFixed(2)}B`;
  } else if (actualValue >= 1_000_000) {
    return `$${(actualValue / 1_000_000).toFixed(2)}M`;
  }
  return `$${actualValue.toLocaleString()}`;
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
  console.log("=== FDIC Active Banks Scraper ===\n");

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Fetch data
  const institutions = await fetchAllInstitutions();
  const financials = await fetchLatestFinancials();

  // Merge data
  console.log("\nMerging institution and financial data...");
  const banks: BankRecord[] = institutions.map((inst) => {
    const fin = financials.get(inst.CERT);
    return {
      cert: inst.CERT,
      name: inst.NAME || "",
      address: inst.ADDRESS || "",
      city: inst.CITY || "",
      state: inst.STNAME || "",
      stateCode: inst.STALP || "",
      zip: inst.ZIP || "",
      county: inst.COUNTY || "",
      website: inst.WEBADDR || "",
      bankClass: inst.BKCLASS || "",
      established: inst.ESTYMD || "",
      insuredDate: inst.INSDATE || "",
      totalAssets: fin?.ASSET ?? null,
      totalAssetsFormatted: formatAssets(fin?.ASSET ?? null),
      employeeCount: fin?.NUMEMP ?? null,
    };
  });

  // Sort by assets descending (banks with assets first)
  banks.sort((a, b) => (b.totalAssets ?? 0) - (a.totalAssets ?? 0));

  // Generate CSV
  const headers = [
    "CERT",
    "Name",
    "Address",
    "City",
    "State",
    "State Code",
    "ZIP",
    "County",
    "Website",
    "Bank Class",
    "Established",
    "Insured Date",
    "Total Assets (thousands)",
    "Total Assets (formatted)",
    "Employee Count",
  ];

  const csvRows = [headers.join(",")];
  for (const bank of banks) {
    csvRows.push(
      [
        escapeCSV(bank.cert),
        escapeCSV(bank.name),
        escapeCSV(bank.address),
        escapeCSV(bank.city),
        escapeCSV(bank.state),
        escapeCSV(bank.stateCode),
        escapeCSV(bank.zip),
        escapeCSV(bank.county),
        escapeCSV(bank.website),
        escapeCSV(bank.bankClass),
        escapeCSV(bank.established),
        escapeCSV(bank.insuredDate),
        escapeCSV(bank.totalAssets),
        escapeCSV(bank.totalAssetsFormatted),
        escapeCSV(bank.employeeCount),
      ].join(",")
    );
  }

  const csvPath = path.join(OUTPUT_DIR, "fdic-active-banks.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n"));

  // Summary stats
  const withAssets = banks.filter((b) => b.totalAssets !== null);
  const under5B = withAssets.filter((b) => (b.totalAssets ?? 0) * 1000 < 5_000_000_000);
  const smallTeam = banks.filter((b) => b.employeeCount !== null && b.employeeCount < 150);

  console.log("\n=== Summary ===");
  console.log(`Total active banks: ${banks.length}`);
  console.log(`Banks with asset data: ${withAssets.length}`);
  console.log(`Banks under $5B AUM: ${under5B.length}`);
  console.log(`Banks with <150 employees (small IT proxy): ${smallTeam.length}`);
  console.log(`\nCSV saved to: ${csvPath}`);
}

main().catch(console.error);
