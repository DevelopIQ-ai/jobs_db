import { chromium, Page } from "playwright";
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

const LEADERSHIP_PATHS = [
  "/about/leadership", "/about-us/leadership", "/leadership",
  "/about/our-team", "/our-team", "/management",
  "/about/executive-team", "/executive-team", "/about/board",
  "/board-of-directors", "/about/officers", "/officers",
  "/team", "/about", "/about-us",
];

const TARGET_TITLES = [
  "ceo", "chief executive", "president", "cfo", "coo", "cto", "cio",
  "vice president", "vp", "svp", "evp", "chairman", "director",
  "officer", "treasurer", "secretary", "chief"
];

function parseCSV(content: string): Bank[] {
  const lines = content.split("\n").filter(l => l.trim());
  const headers = lines[0].split(",");
  const certIdx = headers.findIndex(h => h.includes("CERT"));
  const nameIdx = headers.findIndex(h => h === "Name");
  const websiteIdx = headers.findIndex(h => h === "Website");
  const cityIdx = headers.findIndex(h => h === "City");
  const stateIdx = headers.findIndex(h => h.includes("State Code"));
  const assetsIdx = headers.findIndex(h => h.includes("formatted"));
  const employeeIdx = headers.findIndex(h => h.includes("Employee"));

  const banks: Bank[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else current += char;
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

async function findLeadershipPages(page: Page, baseUrl: string): Promise<string[]> {
  const foundPages: string[] = [];

  for (const pathStr of LEADERSHIP_PATHS) {
    if (foundPages.length >= 2) break;
    try {
      const url = new URL(pathStr, baseUrl).href;
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 });
      if (response && response.ok()) {
        const content = await page.content();
        const lower = content.toLowerCase();
        if (lower.includes("president") || lower.includes("ceo") ||
            lower.includes("executive") || lower.includes("officer") ||
            lower.includes("chairman") || lower.includes("director")) {
          foundPages.push(url);
        }
      }
    } catch { continue; }
  }

  if (foundPages.length === 0) {
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      const links = await page.$$eval("a", (anchors) => {
        const keywords = ["leadership", "team", "management", "executive", "board", "about"];
        const found: string[] = [];
        for (const a of anchors) {
          const text = (a.textContent || "").toLowerCase();
          const href = a.href || "";
          for (const kw of keywords) {
            if ((text.includes(kw) || href.toLowerCase().includes(kw)) && href.startsWith("http")) {
              if (!found.includes(href)) found.push(href);
              break;
            }
          }
          if (found.length >= 3) break;
        }
        return found;
      });
      foundPages.push(...links);
    } catch { }
  }

  return foundPages;
}

// Extraction script as a string to bypass TypeScript transformation
const EXTRACT_SCRIPT = `
(function(targetTitles) {
  var found = [];

  function checkName(text) {
    var t = text.trim();
    if (t.length < 4 || t.length > 60) return false;
    if (/\\d/.test(t)) return false;
    var words = t.split(/\\s+/);
    if (words.length < 2 || words.length > 6) return false;
    if (!/^[A-Z]/.test(words[0])) return false;
    var lower = t.toLowerCase();
    if (lower.includes("bank") || lower.includes("trust") || lower.includes("financial")) return false;
    if (lower.includes("click") || lower.includes("learn") || lower.includes("read")) return false;
    if (lower.includes("@") || lower.includes("www") || lower.includes(".com")) return false;
    return true;
  }

  function checkTitle(text) {
    var lower = text.toLowerCase();
    for (var i = 0; i < targetTitles.length; i++) {
      if (lower.includes(targetTitles[i])) return true;
    }
    return false;
  }

  var textContent = document.body.innerText;
  var rawLines = textContent.split("\\n");
  var lines = [];
  for (var i = 0; i < rawLines.length; i++) {
    var line = rawLines[i].trim();
    if (line && line.length > 2 && line.length < 150) lines.push(line);
  }

  // Method 1: Name then title on next line
  for (var i = 0; i < lines.length - 1; i++) {
    if (checkName(lines[i]) && checkTitle(lines[i + 1])) {
      found.push({ name: lines[i], title: lines[i + 1] });
    }
  }

  // Method 2: Name, Title on same line
  var separators = [", ", " - ", " | "];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    for (var s = 0; s < separators.length; s++) {
      var idx = line.indexOf(separators[s]);
      if (idx > 3 && idx < line.length - 5) {
        var before = line.substring(0, idx).trim();
        var after = line.substring(idx + separators[s].length).trim();
        if (checkName(before) && checkTitle(after)) {
          found.push({ name: before, title: after });
          break;
        }
      }
    }
  }

  // Deduplicate
  var seen = {};
  var result = [];
  for (var i = 0; i < found.length; i++) {
    var key = found[i].name.toLowerCase().replace(/[^a-z]/g, "");
    if (!seen[key] && key.length >= 4) {
      seen[key] = true;
      result.push(found[i]);
    }
  }

  return result;
})
`;

async function extractExecutives(page: Page, url: string): Promise<Array<{name: string, title: string}>> {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    // Inject the extraction script
    await page.addScriptTag({ content: `window.extractExecs = ${EXTRACT_SCRIPT};` });

    // Call the injected function
    const results = await page.evaluate((titles) => {
      return (window as any).extractExecs(titles);
    }, TARGET_TITLES);

    return results as Array<{name: string, title: string}>;
  } catch (err) {
    console.log(`    Extraction error: ${err}`);
    return [];
  }
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  console.log("=== Bank Executive Scraper v4 ===\n");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Reading FDIC bank data...");
  if (!fs.existsSync(FDIC_CSV)) { console.error("FDIC CSV not found"); process.exit(1); }

  const csvContent = fs.readFileSync(FDIC_CSV, "utf-8");
  const allBanks = parseCSV(csvContent);

  const banks = allBanks.filter(b => {
    const assets = b.totalAssets;
    if (assets.includes("B")) {
      const num = parseFloat(assets.replace(/[$B]/g, ""));
      return num < 5;
    }
    return true;
  });

  console.log(`Found ${banks.length} small banks\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  }).then(ctx => ctx.newPage());

  let allExecutives: Executive[] = [];
  let processed = 0;
  let withExecs = 0;
  let startIndex = 0;

  const progressPath = path.join(OUTPUT_DIR, "scrape-progress-v4.json");
  const csvPath = path.join(OUTPUT_DIR, "bank-executives-v4.csv");

  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      startIndex = progress.processed || 0;
      withExecs = progress.withExecs || 0;
      console.log(`Resuming from bank ${startIndex}...`);

      if (fs.existsSync(csvPath)) {
        const existingCsv = fs.readFileSync(csvPath, "utf-8");
        const lines = existingCsv.split("\n").slice(1).filter(l => l.trim());
        for (const line of lines) {
          const values: string[] = [];
          let current = "";
          let inQuotes = false;
          for (const char of line) {
            if (char === '"') inQuotes = !inQuotes;
            else if (char === "," && !inQuotes) { values.push(current); current = ""; }
            else current += char;
          }
          values.push(current);
          if (values.length >= 9) {
            allExecutives.push({
              bankCert: values[0], bankName: values[1], bankWebsite: values[2],
              bankCity: values[3], bankState: values[4], bankAssets: values[5],
              executiveName: values[6], executiveTitle: values[7], sourceUrl: values[8],
            });
          }
        }
        console.log(`Loaded ${allExecutives.length} existing executives`);
      }
    } catch { console.log("Starting fresh"); }
  }

  const banksToProcess = banks.slice(startIndex);
  processed = startIndex;

  for (const bank of banksToProcess) {
    processed++;
    console.log(`[${processed}/${banks.length}] ${bank.name}...`);

    try {
      const leadershipUrls = await findLeadershipPages(page, bank.website);
      let bankExecutives: Array<{name: string, title: string}> = [];
      const seenNames = new Set<string>();

      for (const url of leadershipUrls) {
        const execs = await extractExecutives(page, url);
        for (const e of execs) {
          const key = e.name.toLowerCase().replace(/[^a-z]/g, "");
          if (!seenNames.has(key)) {
            seenNames.add(key);
            bankExecutives.push(e);
          }
        }
      }

      if (bankExecutives.length > 0) {
        withExecs++;
        console.log(`  Found ${bankExecutives.length} executives`);
        for (const exec of bankExecutives) {
          allExecutives.push({
            bankCert: bank.cert, bankName: bank.name, bankWebsite: bank.website,
            bankCity: bank.city, bankState: bank.state, bankAssets: bank.totalAssets,
            executiveName: exec.name, executiveTitle: exec.title,
            sourceUrl: leadershipUrls[0] || bank.website,
          });
        }
      } else {
        console.log(`  No executives found`);
      }
    } catch (error) {
      console.log(`  Error: ${error}`);
    }

    if (processed % 10 === 0) {
      fs.writeFileSync(progressPath, JSON.stringify({ processed, withExecs, totalExecutives: allExecutives.length }));
      const headers = ["Bank CERT", "Bank Name", "Bank Website", "Bank City", "Bank State", "Bank Assets", "Executive Name", "Executive Title", "Source URL"];
      const rows = [headers.join(",")];
      for (const e of allExecutives) {
        rows.push([escapeCSV(e.bankCert), escapeCSV(e.bankName), escapeCSV(e.bankWebsite), escapeCSV(e.bankCity), escapeCSV(e.bankState), escapeCSV(e.bankAssets), escapeCSV(e.executiveName), escapeCSV(e.executiveTitle), escapeCSV(e.sourceUrl)].join(","));
      }
      fs.writeFileSync(csvPath, rows.join("\n"));
    }
  }

  await browser.close();

  const headers = ["Bank CERT", "Bank Name", "Bank Website", "Bank City", "Bank State", "Bank Assets", "Executive Name", "Executive Title", "Source URL"];
  const rows = [headers.join(",")];
  for (const e of allExecutives) {
    rows.push([escapeCSV(e.bankCert), escapeCSV(e.bankName), escapeCSV(e.bankWebsite), escapeCSV(e.bankCity), escapeCSV(e.bankState), escapeCSV(e.bankAssets), escapeCSV(e.executiveName), escapeCSV(e.executiveTitle), escapeCSV(e.sourceUrl)].join(","));
  }
  fs.writeFileSync(csvPath, rows.join("\n"));

  console.log("\n=== Summary ===");
  console.log(`Banks processed: ${processed}`);
  console.log(`Banks with executives: ${withExecs}`);
  console.log(`Total executives: ${allExecutives.length}`);
  console.log(`CSV: ${csvPath}`);
}

main().catch(console.error);
