import * as fs from "fs";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

// Load config from source.yaml
const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

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
    domain?: string;
  };
  contact: {
    website?: string;
    location?: {
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
  };
  context: Record<string, unknown>;
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

function extractDomain(website: string): string | undefined {
  if (!website) return undefined;
  try {
    let url = website;
    if (!url.startsWith("http")) url = "https://" + url;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0] || undefined;
  }
}

function convertToLeadRecord(inst: Institution, fin: Financial | undefined, scrapedAt: string): LeadRecord {
  const website = inst.WEBADDR || "";
  const record: LeadRecord = {
    core: {
      source_id: config.source_id,
      entity_type: "company",
      scraped_at: scrapedAt,
      raw_url: INSTITUTIONS_API,
      primary_key: "", // Will be set below
    },
    company: {
      company_name: inst.NAME || "",
      domain: extractDomain(website),
    },
    contact: {
      website: website ? (website.startsWith("http") ? website : `https://${website}`) : undefined,
      location: {
        city: inst.CITY || undefined,
        state: inst.STALP || undefined,
        zip: inst.ZIP || undefined,
        country: "USA",
      },
    },
    context: {
      cert: inst.CERT,
      address: inst.ADDRESS || undefined,
      state_name: inst.STNAME || undefined,
      county: inst.COUNTY || undefined,
      bank_class: inst.BKCLASS || undefined,
      established: inst.ESTYMD || undefined,
      insured_date: inst.INSDATE || undefined,
      total_assets_thousands: fin?.ASSET ?? undefined,
      total_assets_formatted: formatAssets(fin?.ASSET ?? null),
      employee_count: fin?.NUMEMP ?? undefined,
    },
  };
  // Generate primary key using strategy from source.yaml
  record.core.primary_key = generatePrimaryKey(config, record as unknown as Record<string, unknown>, INSTITUTIONS_API);
  return record;
}

async function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log(`=== ${config.display_name} Scraper ===\n`);

  // Ensure output directory exists
  ensureOutputDir(__dirname);

  // Fetch data
  const institutions = await fetchAllInstitutions();
  const financials = await fetchLatestFinancials();

  // Sort by assets descending
  institutions.sort((a, b) => {
    const aAssets = financials.get(a.CERT)?.ASSET ?? 0;
    const bAssets = financials.get(b.CERT)?.ASSET ?? 0;
    return bAssets - aAssets;
  });

  // Convert and write to JSONL
  console.log("\nWriting leads.jsonl...");
  const records: string[] = [];
  for (const inst of institutions) {
    const fin = financials.get(inst.CERT);
    const record = convertToLeadRecord(inst, fin, startTime);
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
    records_found: institutions.length,
    records_valid: records.length,
    records_written: records.length,
    error_count: 0,
  };
  fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

  // Update data_as_of in source.yaml
  updateDataAsOf(__dirname);

  // Summary stats
  const withAssets = institutions.filter((i) => financials.has(i.CERT));

  console.log("\n=== Summary ===");
  console.log(`Total active banks: ${institutions.length}`);
  console.log(`Banks with financial data: ${withAssets.length}`);
  console.log(`\nOutput: ${paths.leadsFile}`);
  console.log(`Run metadata: ${paths.runFile}`);
  console.log(`Updated data_as_of in source.yaml`);
}

main().catch(console.error);
