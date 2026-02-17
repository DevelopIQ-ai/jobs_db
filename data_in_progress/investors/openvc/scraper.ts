/**
 * OpenVC Investor Database Scraper
 *
 * Scrapes ~16,500 investors from openvc.app/search by paginating through
 * 828 pages of results. No login required.
 *
 * Uses Playwright to bypass Cloudflare, then parses SSR HTML with cheerio.
 *
 * Usage:
 *   npx tsx scraper.ts
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

// =============================================================================
// Config
// =============================================================================

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

const BASE_URL = "https://www.openvc.app";
const SEARCH_URL = `${BASE_URL}/search`;
const PROGRESS_FILE = path.join(paths.outputDir, "scrape-progress.json");

// =============================================================================
// Types
// =============================================================================

interface RawInvestor {
  name: string;
  type: string;
  countries: string[];
  checkSize: string;
  stages: string[];
  thesis: string;
  profilePath: string;
  scrapedAt: string;
}

interface ScrapeProgress {
  lastCompletedPage: number;
  totalPages: number;
  investors: RawInvestor[];
  lastUpdated: string;
}

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanDelay(min: number = 800, max: number = 2000): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

function loadProgress(): ScrapeProgress | null {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveProgress(progress: ScrapeProgress): void {
  ensureOutputDir(__dirname);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// =============================================================================
// HTML Parsing with Cheerio
// =============================================================================

function extractInvestorsFromHTML(html: string): RawInvestor[] {
  const $ = cheerio.load(html);
  const scrapedAt = new Date().toISOString();
  const seenPaths = new Set<string>();
  const results: RawInvestor[] = [];

  $("table tbody tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return; // skip ad rows, etc.

    const nameCell = cells.eq(1);
    // Fund links use relative href "fund/..." (no leading slash)
    const nameLink = nameCell.find('a[href^="fund/"]').first();
    if (!nameLink.length) return;

    const profilePath = nameLink.attr("href") || "";
    if (!profilePath || seenPaths.has(profilePath)) return;
    seenPaths.add(profilePath);

    // Name: the #invOverflow div inside the link, or fallback to link text
    const nameEl = nameLink.find("#invOverflow");
    const name = (nameEl.length ? nameEl.text() : nameLink.text()).trim();
    if (!name || name.length < 2) return;

    // Type: investor-lists link, or the second direct div inside name link
    const typeLink = nameCell.find('a[href*="investor-lists"]');
    let type = typeLink.text().trim();
    if (!type) {
      const typeDivs = nameLink.children("div");
      if (typeDivs.length > 1) {
        type = typeDivs.last().text().trim();
      }
    }

    // Geography: country links
    const geoCell = cells.eq(2);
    const countries: string[] = [];
    geoCell.find('a[href^="country/"]').each((_j, el) => {
      const text = $(el).text().trim();
      if (text && !/^\+\d+$/.test(text)) {
        countries.push(text);
      }
    });

    // Check size
    const checkSize = cells.eq(3).text().trim();

    // Stages
    const stageCell = cells.eq(4);
    const stages: string[] = [];
    stageCell.find("a").each((_j, el) => {
      const text = $(el).text().trim();
      if (text && !/^\+\d+$/.test(text)) {
        stages.push(text);
      }
    });

    // Thesis
    const thesis = cells.eq(5).text().trim();

    results.push({
      name,
      type,
      countries,
      checkSize,
      stages,
      thesis,
      profilePath,
      scrapedAt,
    });
  });

  return results;
}

function getTotalPagesFromHTML(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $('nav[aria-label="Page navigation"] a').each((_i, el) => {
    const text = $(el).text().trim();
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return max;
}

// =============================================================================
// Navigation
// =============================================================================

async function navigateWithRetry(
  page: Page,
  url: string,
  retries: number = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      return await page.content();
    } catch (error) {
      if (attempt < retries) {
        console.log(`  Retry ${attempt}/${retries}...`);
        await delay(5000 * attempt);
      } else {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

// =============================================================================
// Output
// =============================================================================

function convertToLeadRecord(inv: RawInvestor) {
  const rawUrl = `${BASE_URL}/${inv.profilePath.replace(/^\.?\//, "")}`;

  const record: Record<string, unknown> = {
    core: {
      source_id: config.source_id,
      entity_type: "company" as const,
      scraped_at: inv.scrapedAt,
      raw_url: rawUrl,
      primary_key: "",
    },
    company: {
      company_name: inv.name,
      industry: "Venture Capital / Investment",
      profile_url: rawUrl,
    },
    contact: {},
    context: {
      investor_type: inv.type || undefined,
      countries: inv.countries.length > 0 ? inv.countries : undefined,
      check_size: inv.checkSize || undefined,
      stages: inv.stages.length > 0 ? inv.stages : undefined,
      thesis: inv.thesis || undefined,
    },
  };

  (record.core as Record<string, unknown>).primary_key = generatePrimaryKey(
    config,
    record,
    rawUrl
  );

  return record;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const startTime = new Date();

  console.log("\n" + "=".repeat(60));
  console.log("OpenVC Investor Database Scraper");
  console.log("=".repeat(60));

  ensureOutputDir(__dirname);

  // Load progress
  let progress = loadProgress();
  let allInvestors: RawInvestor[] = progress?.investors || [];
  let startPage = (progress?.lastCompletedPage || 0) + 1;

  if (startPage > 1) {
    console.log(
      `Resuming from page ${startPage} (${allInvestors.length} investors so far)`
    );
  }

  // Launch browser (visible mode required to bypass Cloudflare fingerprinting)
  const browser: Browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page: Page = await context.newPage();

  const errors: Array<{
    type: string;
    url: string;
    message: string;
    attempts: number;
    skipped_records: number;
  }> = [];

  try {
    // Get total pages from first page
    console.log("Loading search page...");
    const firstHTML = await navigateWithRetry(page, `${SEARCH_URL}?page=1`);
    const totalPages = getTotalPagesFromHTML(firstHTML);
    console.log(`Total pages: ${totalPages}\n`);

    // Scrape first page if starting fresh
    if (startPage === 1) {
      const pageInvestors = extractInvestorsFromHTML(firstHTML);
      console.log(`Page 1/${totalPages}: ${pageInvestors.length} investors`);
      allInvestors.push(...pageInvestors);

      progress = {
        lastCompletedPage: 1,
        totalPages,
        investors: allInvestors,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);
      startPage = 2;
      await humanDelay(1500, 3000);
    }

    // Scrape remaining pages
    for (let pageNum = startPage; pageNum <= totalPages; pageNum++) {
      try {
        const html = await navigateWithRetry(
          page,
          `${SEARCH_URL}?page=${pageNum}`
        );
        const pageInvestors = extractInvestorsFromHTML(html);

        console.log(
          `Page ${pageNum}/${totalPages}: ${pageInvestors.length} investors (total: ${allInvestors.length + pageInvestors.length})`
        );

        allInvestors.push(...pageInvestors);

        // Save progress every 10 pages
        if (pageNum % 10 === 0) {
          progress = {
            lastCompletedPage: pageNum,
            totalPages,
            investors: allInvestors,
            lastUpdated: new Date().toISOString(),
          };
          saveProgress(progress);
        }

        await humanDelay(1000, 2500);

        // Longer break every 50 pages
        if (pageNum % 50 === 0) {
          const breakTime = 8000 + Math.random() * 7000;
          console.log(
            `  Break (${(breakTime / 1000).toFixed(1)}s) at page ${pageNum}...`
          );
          await delay(breakTime);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  Error on page ${pageNum}: ${msg}`);
        errors.push({
          type: "http_error",
          url: `${SEARCH_URL}?page=${pageNum}`,
          message: msg,
          attempts: 3,
          skipped_records: 20,
        });

        // Save progress and continue
        progress = {
          lastCompletedPage: pageNum,
          totalPages,
          investors: allInvestors,
          lastUpdated: new Date().toISOString(),
        };
        saveProgress(progress);
        await delay(10000);
      }
    }

    // Deduplicate by profile path
    const seen = new Set<string>();
    const uniqueInvestors = allInvestors.filter((inv) => {
      const key = inv.profilePath;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(
      `\nDeduplication: ${allInvestors.length} -> ${uniqueInvestors.length}`
    );

    // Write JSONL
    const records = uniqueInvestors.map((inv) =>
      JSON.stringify(convertToLeadRecord(inv))
    );
    fs.writeFileSync(paths.leadsFile, records.join("\n") + "\n");

    // Write run.json
    const endTime = new Date();
    const runData = {
      source_id: config.source_id,
      run_id: `${config.source_id}:${startTime.toISOString()}`,
      started_at: startTime.toISOString(),
      ended_at: endTime.toISOString(),
      records_found: allInvestors.length,
      records_valid: uniqueInvestors.length,
      records_written: uniqueInvestors.length,
      error_count: errors.length,
      errors,
    };
    fs.writeFileSync(paths.runFile, JSON.stringify(runData, null, 2));

    // Update data_as_of
    updateDataAsOf(__dirname);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SCRAPE COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total investors: ${uniqueInvestors.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(
      `Duration: ${((endTime.getTime() - startTime.getTime()) / 60000).toFixed(1)} minutes`
    );
    console.log(`\nOutput: ${paths.leadsFile}`);

    // Type breakdown
    const byType: Record<string, number> = {};
    for (const inv of uniqueInvestors) {
      const t = inv.type || "Unknown";
      byType[t] = (byType[t] || 0) + 1;
    }
    console.log("\nBy type:");
    const sortedTypes = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [t, count] of sortedTypes) {
      console.log(`  ${t}: ${count}`);
    }
  } catch (error) {
    console.error("\nFatal error:", error);

    // Save partial progress
    if (allInvestors.length > 0) {
      progress = {
        lastCompletedPage: progress?.lastCompletedPage || 0,
        totalPages: progress?.totalPages || 0,
        investors: allInvestors,
        lastUpdated: new Date().toISOString(),
      };
      saveProgress(progress);
      console.log(`Partial progress saved (${allInvestors.length} investors)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
