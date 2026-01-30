import { chromium } from "playwright";

const TEST_BANKS = [
  { name: "Bar Harbor Bank & Trust", url: "https://www.barharbor.bank" },
  { name: "John Deere Financial", url: "https://www.deere.com" },
  { name: "Vantage Bank Texas", url: "https://www.vantage.bank" },
];

const LEADERSHIP_PATHS = [
  "/about/leadership",
  "/about-us/leadership",
  "/leadership",
  "/about/our-team",
  "/about-us/our-team",
  "/our-team",
  "/about/management",
  "/management",
  "/about/executive-team",
  "/executive-team",
  "/about/board",
  "/board-of-directors",
  "/about/officers",
  "/officers",
  "/team",
  "/about",
  "/about-us",
];

const TARGET_TITLES = [
  "ceo", "chief executive", "president", "cfo", "coo", "cto", "cio",
  "vice president", "vp", "svp", "evp", "chairman", "director",
  "officer", "treasurer", "secretary"
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const bank of TEST_BANKS) {
    console.log(`\n========== ${bank.name} ==========`);
    console.log(`Base URL: ${bank.url}\n`);

    // Try to find leadership page
    let foundPage = "";
    for (const path of LEADERSHIP_PATHS) {
      try {
        const url = new URL(path, bank.url).href;
        console.log(`Trying: ${url}`);
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 });

        if (response && response.ok()) {
          const content = await page.content();
          const lower = content.toLowerCase();

          if (lower.includes("president") || lower.includes("ceo") ||
              lower.includes("executive") || lower.includes("officer")) {
            console.log(`  ✓ FOUND leadership page!`);
            foundPage = url;
            break;
          } else {
            console.log(`  - OK but no leadership keywords`);
          }
        } else {
          console.log(`  - HTTP ${response?.status()}`);
        }
      } catch (e) {
        console.log(`  - Error: ${e}`);
      }
    }

    if (!foundPage) {
      console.log("\nNo leadership page found via paths, trying homepage links...");
      try {
        await page.goto(bank.url, { waitUntil: "domcontentloaded", timeout: 10000 });
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("a"))
            .filter(a => {
              const text = (a.textContent || "").toLowerCase();
              const href = (a.href || "").toLowerCase();
              return ["leadership", "team", "about", "management", "executive", "board"]
                .some(k => text.includes(k) || href.includes(k));
            })
            .map(a => ({ text: a.textContent?.trim().substring(0, 50), href: a.href }))
            .slice(0, 10);
        });
        console.log("Found links:", links);
        if (links.length > 0) {
          foundPage = links[0].href;
        }
      } catch (e) {
        console.log("Error finding links:", e);
      }
    }

    if (foundPage) {
      console.log(`\nExtracting from: ${foundPage}`);
      await page.goto(foundPage, { waitUntil: "networkidle", timeout: 15000 });

      const text = await page.evaluate(() => document.body.innerText);
      const lines = text.split("\n").map(l => l.trim()).filter(l => l && l.length > 2 && l.length < 150);

      console.log(`\nPage has ${lines.length} lines. First 50 lines:`);
      lines.slice(0, 50).forEach((line, i) => {
        const hasTitle = TARGET_TITLES.some(t => line.toLowerCase().includes(t));
        const marker = hasTitle ? " <<< TITLE" : "";
        console.log(`  ${i}: ${line.substring(0, 80)}${marker}`);
      });

      // Try extraction
      console.log("\n--- Attempting extraction ---");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];

        // Check if next line has title
        const nextHasTitle = TARGET_TITLES.some(t => nextLine.toLowerCase().includes(t));

        if (nextHasTitle) {
          // Check if current line looks like a name
          const words = line.split(/\s+/);
          const isName = words.length >= 2 && words.length <= 5 &&
                        /^[A-Z]/.test(words[0]) &&
                        !/\d/.test(line) &&
                        !line.toLowerCase().includes("bank") &&
                        !line.toLowerCase().includes("click");

          if (isName) {
            console.log(`  FOUND: "${line}" -> "${nextLine}"`);
          }
        }
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
