import { chromium, Browser, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const FDIC_CSV = path.join(__dirname, "../fdic-scraper/output/fdic-active-banks.csv");

interface Bank {
  cert: string;
  name: string;
  website: string;
  city: string;
  state: string;
  totalAssets: string;
  employeeCount: string;
}

interface Executive {
  bankCert: string;
  bankName: string;
  bankWebsite: string;
  bankCity: string;
  bankState: string;
  bankAssets: string;
  executiveName: string;
  executiveTitle: string;
  sourceUrl: string;
}

// Common leadership page URL patterns
const LEADERSHIP_PATHS = [
  "/about/leadership",
  "/about-us/leadership",
  "/about/our-team",
  "/about-us/our-team",
  "/about/management",
  "/about-us/management",
  "/leadership",
  "/our-team",
  "/management",
  "/about/executive-team",
  "/about-us/executive-team",
  "/executive-team",
  "/about/board",
  "/about-us/board",
  "/board-of-directors",
  "/about/officers",
  "/officers",
  "/about",
  "/about-us",
];

// Target titles we're looking for
const TARGET_TITLES = [
  "ceo", "chief executive",
  "president",
  "cto", "chief technology",
  "cio", "chief information",
  "chief digital", "chief innovation",
  "cfo", "chief financial",
  "coo", "chief operating",
  "chief compliance", "compliance officer",
  "vice president", "vp",
  "svp", "senior vice president",
  "evp", "executive vice president",
  "managing director",
  "chairman", "board",
];

function parseCSV(content: string): Bank[] {
  const lines = content.split("\n").filter(l => l.trim());
  const headers = lines[0].split(",");

  const certIdx = headers.findIndex(h => h.includes("CERT"));
  const nameIdx = headers.findIndex(h => h === "Name");
  const websiteIdx = headers.findIndex(h => h === "Website");
  const cityIdx = headers.findIndex(h => h === "City");
  const stateIdx = headers.findIndex(h => h.includes("State Code") || h === "State Code");
  const assetsIdx = headers.findIndex(h => h.includes("formatted"));
  const employeeIdx = headers.findIndex(h => h.includes("Employee"));

  const banks: Bank[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles basic cases)
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const website = values[websiteIdx] || "";
    if (!website || website === "N/A" || !website.includes(".")) continue;

    banks.push({
      cert: values[certIdx] || "",
      name: values[nameIdx] || "",
      website: website.startsWith("http") ? website : `https://${website}`,
      city: values[cityIdx] || "",
      state: values[stateIdx] || "",
      totalAssets: values[assetsIdx] || "",
      employeeCount: values[employeeIdx] || "",
    });
  }

  return banks;
}

async function findLeadershipPage(page: Page, baseUrl: string): Promise<string | null> {
  // First try common paths
  for (const path of LEADERSHIP_PATHS) {
    try {
      const url = new URL(path, baseUrl).href;
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
      if (response && response.ok()) {
        const content = await page.content();
        // Check if page has leadership-related content
        if (content.toLowerCase().includes("president") ||
            content.toLowerCase().includes("ceo") ||
            content.toLowerCase().includes("executive") ||
            content.toLowerCase().includes("officer")) {
          return url;
        }
      }
    } catch {
      continue;
    }
  }

  // Try finding links on homepage
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });

    const leadershipLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const keywords = ["leadership", "team", "about", "management", "executive", "officer", "board"];

      for (const link of links) {
        const text = (link.textContent || "").toLowerCase();
        const href = link.href || "";

        for (const kw of keywords) {
          if (text.includes(kw) || href.includes(kw)) {
            return href;
          }
        }
      }
      return null;
    });

    if (leadershipLink) {
      return leadershipLink;
    }
  } catch {
    // ignore
  }

  return null;
}

async function extractExecutives(page: Page, url: string): Promise<Array<{name: string, title: string}>> {
  const executives: Array<{name: string, title: string}> = [];

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    const results = await page.evaluate((targetTitles) => {
      const found: Array<{name: string, title: string}> = [];

      // Look for common patterns: name followed by title, or structured elements
      const textContent = document.body.innerText;
      const lines = textContent.split("\n").map(l => l.trim()).filter(l => l);

      // Pattern 1: Look for title keywords and nearby names
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const isTitle = targetTitles.some(t => line.includes(t));

        if (isTitle && lines[i].length < 100) {
          // Check if this line has both name and title
          const fullLine = lines[i];

          // Pattern: "John Smith, CEO" or "John Smith - President"
          const commaMatch = fullLine.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[,\-–]\s*(.+)$/);
          if (commaMatch) {
            found.push({ name: commaMatch[1].trim(), title: commaMatch[2].trim() });
            continue;
          }

          // Check previous line for name
          if (i > 0 && lines[i-1].length < 50) {
            const prevLine = lines[i-1];
            // Check if prev line looks like a name (2-4 capitalized words)
            if (/^[A-Z][a-z]+(\s+[A-Z]\.?)?(\s+[A-Z][a-z]+)+$/.test(prevLine)) {
              found.push({ name: prevLine, title: fullLine });
            }
          }
        }
      }

      // Pattern 2: Look for structured elements (cards, divs with specific classes)
      const cards = document.querySelectorAll('[class*="team"], [class*="leader"], [class*="executive"], [class*="staff"], [class*="bio"], [class*="member"]');
      cards.forEach(card => {
        const text = card.textContent || "";
        const headings = card.querySelectorAll("h2, h3, h4, h5, strong, b");
        const paragraphs = card.querySelectorAll("p, span, div");

        let name = "";
        let title = "";

        headings.forEach(h => {
          const t = (h.textContent || "").trim();
          if (t.length < 50 && /^[A-Z][a-z]+/.test(t) && !targetTitles.some(tt => t.toLowerCase().includes(tt))) {
            name = t;
          }
        });

        paragraphs.forEach(p => {
          const t = (p.textContent || "").trim();
          if (t.length < 80 && targetTitles.some(tt => t.toLowerCase().includes(tt))) {
            title = t;
          }
        });

        if (name && title) {
          found.push({ name, title });
        }
      });

      // Deduplicate
      const seen = new Set<string>();
      return found.filter(e => {
        const key = `${e.name}|${e.title}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }, TARGET_TITLES);

    executives.push(...results);
  } catch (error) {
    // ignore extraction errors
  }

  return executives;
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  console.log("=== Bank Executive Scraper ===\n");

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Read FDIC data
  console.log("Reading FDIC bank data...");
  if (!fs.existsSync(FDIC_CSV)) {
    console.error(`FDIC CSV not found at: ${FDIC_CSV}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(FDIC_CSV, "utf-8");
  const allBanks = parseCSV(csvContent);

  // Filter to banks with websites and under $5B (small banks)
  const banks = allBanks.filter(b => {
    const assets = b.totalAssets;
    // Keep banks under $5B
    if (assets.includes("B")) {
      const num = parseFloat(assets.replace(/[$B]/g, ""));
      return num < 5;
    }
    return true; // Keep all M and K sized banks
  });

  console.log(`Found ${banks.length} small banks with websites\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();

  const allExecutives: Executive[] = [];
  let processed = 0;
  let withExecs = 0;

  // Process banks (limit for initial run)
  const BATCH_SIZE = 100; // Process first 100 banks
  const banksToProcess = banks.slice(0, BATCH_SIZE);

  for (const bank of banksToProcess) {
    processed++;
    console.log(`[${processed}/${banksToProcess.length}] ${bank.name}...`);

    try {
      // Find leadership page
      const leadershipUrl = await findLeadershipPage(page, bank.website);

      if (leadershipUrl) {
        // Extract executives
        const executives = await extractExecutives(page, leadershipUrl);

        if (executives.length > 0) {
          withExecs++;
          console.log(`  Found ${executives.length} executives`);

          for (const exec of executives) {
            allExecutives.push({
              bankCert: bank.cert,
              bankName: bank.name,
              bankWebsite: bank.website,
              bankCity: bank.city,
              bankState: bank.state,
              bankAssets: bank.totalAssets,
              executiveName: exec.name,
              executiveTitle: exec.title,
              sourceUrl: leadershipUrl,
            });
          }
        } else {
          console.log(`  No executives found`);
        }
      } else {
        console.log(`  No leadership page found`);
      }
    } catch (error) {
      console.log(`  Error: ${error}`);
    }

    // Save progress every 20 banks
    if (processed % 20 === 0) {
      const progressPath = path.join(OUTPUT_DIR, "scrape-progress.json");
      fs.writeFileSync(progressPath, JSON.stringify({
        processed,
        withExecs,
        totalExecutives: allExecutives.length
      }));
    }
  }

  await browser.close();

  // Generate CSV
  const headers = [
    "Bank CERT",
    "Bank Name",
    "Bank Website",
    "Bank City",
    "Bank State",
    "Bank Assets",
    "Executive Name",
    "Executive Title",
    "Source URL",
  ];

  const csvRows = [headers.join(",")];
  for (const exec of allExecutives) {
    csvRows.push([
      escapeCSV(exec.bankCert),
      escapeCSV(exec.bankName),
      escapeCSV(exec.bankWebsite),
      escapeCSV(exec.bankCity),
      escapeCSV(exec.bankState),
      escapeCSV(exec.bankAssets),
      escapeCSV(exec.executiveName),
      escapeCSV(exec.executiveTitle),
      escapeCSV(exec.sourceUrl),
    ].join(","));
  }

  const csvPath = path.join(OUTPUT_DIR, "bank-executives.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n"));

  console.log("\n=== Summary ===");
  console.log(`Banks processed: ${processed}`);
  console.log(`Banks with executives found: ${withExecs}`);
  console.log(`Total executives extracted: ${allExecutives.length}`);
  console.log(`\nCSV saved to: ${csvPath}`);
}

main().catch(console.error);
