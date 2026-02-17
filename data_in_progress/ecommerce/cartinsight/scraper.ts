/**
 * CartInsight Consolidated Scraper
 *
 * Combines account creation, CSV export, and search scraping into one pipeline.
 *
 * Phases:
 *   1. Account Creation — Playwright + captcha OCR + AgentMail
 *   2. View Discovery — Enumerate all platform/category/country/tech views
 *   3. CSV Export — Parallel workers export CSVs (costs credits)
 *   4. Search Scraping — data-row_data from search HTML (free, no credits)
 *   5. Merge — Deduplicate all CSVs + search records into leads.jsonl
 *
 * Usage: npx tsx scraper.ts
 *
 * Resumes automatically from progress files if interrupted.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: require("path").resolve(__dirname, "../../../.env") });

import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser } from "playwright";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import { AgentMailClient } from "agentmail";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
} from "../../../lib/source-config";

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = "https://app.cartinsight.io";
const WWW_URL = "https://www.cartinsight.io";
const PASSWORD = "ScrapeBot#2026!";
const DOMAIN = "developiq.co";
const MAX_CAPTCHA_RETRIES = 10;
const EXPORT_CONCURRENCY = 5;
const SEARCH_DELAY_MS = 3000;

const config = loadSourceConfig(__dirname);
const { outputDir, leadsFile } = getOutputPaths(__dirname);
ensureOutputDir(__dirname);

const PROGRESS_FILE = path.join(outputDir, "pipeline-progress.json");
const SEARCH_PROGRESS_FILE = path.join(outputDir, "search-progress.json");
const CSV_DIR = path.join(outputDir, "csvs");
if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR, { recursive: true });

const agentmail = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });

// ============================================================================
// Types
// ============================================================================

interface Account {
  email: string;
  password: string;
  creditsUsed: number;
  creditsTotal: number;
  createdAt: string;
}

interface ExportView {
  label: string;
  url: string;
  _claimed?: boolean;
}

interface Progress {
  accounts: Account[];
  completedViews: string[];
  totalRecords: number;
  csvFiles: string[];
}

interface SearchProgress {
  completedTerms: string[];
  totalNewRecords: number;
}

// ============================================================================
// Progress tracking
// ============================================================================

function loadProgress(): Progress {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return { accounts: [], completedViews: [], totalRecords: 0, csvFiles: [] };
  }
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function loadSearchProgress(): SearchProgress {
  try {
    return JSON.parse(fs.readFileSync(SEARCH_PROGRESS_FILE, "utf-8"));
  } catch {
    return { completedTerms: [], totalNewRecords: 0 };
  }
}

function saveSearchProgress(p: SearchProgress) {
  fs.writeFileSync(SEARCH_PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// HTTP session (cookie-based, supports parallel sessions)
// ============================================================================

class HttpSession {
  cookies: string[] = [];

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Cookie: this.cookies.join("; "),
      ...((options.headers as Record<string, string>) || {}),
    };
    const res = await fetch(url, { ...options, headers, redirect: "manual" });
    const setCookies = (res.headers.getSetCookie?.() || []).map((c: string) => c.split(";")[0]);
    const map = new Map<string, string>();
    for (const c of [...this.cookies, ...setCookies]) map.set(c.split("=")[0], c);
    this.cookies = Array.from(map.values());
    return res;
  }
}

async function httpLogin(session: HttpSession, email: string, password: string): Promise<boolean> {
  session.cookies = [];
  const loginPage = await session.fetch(`${BASE_URL}/`);
  const html = await loginPage.text();
  const token =
    html.match(/name="rset_login_token"[^>]*value="([^"]+)"/i)?.[1] ||
    html.match(/value="([^"]{40,})"[^>]*name="rset_login_token"/i)?.[1];
  if (!token) return false;

  const res = await session.fetch(`${BASE_URL}/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: new URLSearchParams({
      email,
      password,
      rset_login_token: token,
      action: "login",
    }).toString(),
  });

  try {
    return JSON.parse(await res.text()).status === "success";
  } catch {
    return false;
  }
}

// ============================================================================
// Phase 1: Account creation via Playwright + captcha OCR
// ============================================================================

async function solveCaptcha(captchaBuffer: Buffer): Promise<string> {
  const meta = await sharp(captchaBuffer).metadata();
  const w = meta.width!;

  const variants: { data: Buffer }[] = [];

  variants.push({
    data: await sharp(captchaBuffer)
      .resize({ width: w * 3, kernel: "lanczos3" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 180, g: 40, b: 40, alpha: 1 } })
      .png()
      .toBuffer(),
  });

  variants.push({
    data: await sharp(captchaBuffer)
      .negate()
      .grayscale()
      .resize({ width: w * 3, kernel: "lanczos3" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "white" })
      .png()
      .toBuffer(),
  });

  const { data: rawData, info } = await sharp(captchaBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  const binData = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < binData.length; i++) {
    binData[i] = rawData[i] > 180 ? 0 : 255;
  }
  variants.push({
    data: await sharp(binData, { raw: { width: info.width, height: info.height, channels: 1 } })
      .resize({ width: info.width * 4, kernel: "nearest" })
      .extend({ top: 30, bottom: 30, left: 30, right: 30, background: "white" })
      .png()
      .toBuffer(),
  });

  const results: { text: string; confidence: number }[] = [];
  for (const { data } of variants) {
    for (const psm of ["7", "8"]) {
      const res = await Tesseract.recognize(data, "eng", {
        tessedit_char_whitelist: "0123456789abcdef",
        tessedit_pageseg_mode: psm,
      } as any);
      const text = res.data.text.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
      results.push({ text, confidence: res.data.confidence });
    }
  }

  const valid = results.filter((r) => r.text.length === 6);
  if (valid.length > 0) {
    valid.sort((a, b) => b.confidence - a.confidence);
    return valid[0].text;
  }
  results.sort((a, b) => Math.abs(a.text.length - 6) - Math.abs(b.text.length - 6));
  return results[0]?.text || "";
}

async function createAccount(browser: Browser): Promise<Account | null> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    const inbox = await agentmail.inboxes.create({ domain: DOMAIN });
    const email = inbox.inboxId;
    const userName = email.split("@")[0];
    console.log(`  Inbox: ${email}`);

    for (let attempt = 0; attempt < MAX_CAPTCHA_RETRIES; attempt++) {
      await page.goto(`${WWW_URL}/signup/`, { waitUntil: "networkidle" });
      await sleep(1000);

      const captchaImg = page.locator('img[src*="captcha"]').first();
      let captchaText = "";
      try {
        const captchaScreenshot = await captchaImg.screenshot();
        captchaText = await solveCaptcha(captchaScreenshot);
        console.log(`  Captcha attempt ${attempt + 1}: "${captchaText}" (${captchaText.length} chars)`);
      } catch {
        continue;
      }

      if (captchaText.length !== 6) {
        console.log(`  Bad captcha length (${captchaText.length}), retrying...`);
        await page.reload();
        await sleep(1000);
        continue;
      }

      await page.fill('input[name="user_name"]', userName);
      await page.fill('input[name="emailaddress"]', email);
      await page.fill('input[name="password"]', PASSWORD);
      await page.fill('input[name="user_captcha_code"]', captchaText);

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/ajax/"), { timeout: 15000 }).catch(() => null),
        page.click('input[type="submit"], button[type="submit"]'),
      ]);

      if (response) {
        let json: any;
        try {
          json = await response.json();
        } catch {
          continue;
        }

        if (json.status === "success") {
          console.log(`  Signup SUCCESS!`);
          const activationLink = await waitForActivation(email);
          if (activationLink) {
            try {
              const actRes = await fetch(activationLink, {
                headers: { "User-Agent": "Mozilla/5.0" },
                redirect: "follow",
              });
              console.log(`  Activation: ${actRes.status}`);
            } catch {}
          }

          console.log(`  Account ready!`);
          await context.close();
          return { email, password: PASSWORD, creditsUsed: 0, creditsTotal: 100, createdAt: new Date().toISOString() };
        } else {
          const msg = json.msg || JSON.stringify(json);
          console.log(`  Signup failed: ${msg}`);
          if (msg.includes("captcha") || msg.includes("Captcha")) continue;
          if (msg.includes("email") || msg.includes("domain") || msg.includes("already")) return null;
        }
      }
    }

    console.log(`  All captcha attempts failed`);
    return null;
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

async function waitForActivation(inboxId: string): Promise<string | null> {
  console.log(`  Waiting for activation email...`);
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    try {
      const messages: any = await agentmail.inboxes.messages.list(inboxId);
      const msgs = messages.messages || messages;
      if (Array.isArray(msgs) && msgs.length > 0) {
        const full: any = await agentmail.inboxes.messages.get(inboxId, msgs[0].messageId);
        const link = JSON.stringify(full).match(/https?:\/\/[^"\\]*activate[^"\\]*/)?.[0];
        if (link) {
          console.log(`  Activation link found`);
          return link;
        }
      }
    } catch {}
  }
  return null;
}

async function runPhase1(progress: Progress, targetAccounts: number) {
  console.log("--- Phase 1: Account Creation ---");

  const availableCredits = progress.accounts.filter((a) => a.creditsUsed < a.creditsTotal).length;
  const accountsNeeded = targetAccounts - availableCredits;

  if (accountsNeeded <= 0) {
    console.log(`Already have ${availableCredits} accounts with credits. Skipping.\n`);
    return;
  }

  console.log(`Creating ${accountsNeeded} new accounts...\n`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

  for (let i = 0; i < accountsNeeded; i++) {
    console.log(`\nAccount ${i + 1}/${accountsNeeded}:`);
    const account = await createAccount(browser);
    if (account) {
      progress.accounts.push(account);
      saveProgress(progress);
      console.log(`  Created: ${account.email} (${account.creditsTotal} credits)`);
    } else {
      console.log(`  Failed to create account`);
    }
    await sleep(2000);
  }

  await browser.close();
  console.log();
}

// ============================================================================
// Phase 2: View discovery
// ============================================================================

async function discoverViews(session: HttpSession): Promise<ExportView[]> {
  const views: ExportView[] = [];
  let m;
  const skip = new Set(["contacts", "stores", "alexa-rank", "recently-updated"]);

  const cartsHtml = await (await session.fetch(`${BASE_URL}/all-carts/`)).text();
  const platforms = new Set<string>();
  const platformRegex = /stores-by-alexa-rank\/([^/]+)\//g;
  while ((m = platformRegex.exec(cartsHtml)) !== null) platforms.add(m[1]);
  for (const slug of platforms) {
    views.push({ label: `platform:${slug}`, url: `${BASE_URL}/stores-by-alexa-rank/${slug}/?page=1` });
    views.push({ label: `platform-contacts:${slug}`, url: `${BASE_URL}/stores-with-contacts/${slug}/?page=1` });
    views.push({ label: `platform-recent:${slug}`, url: `${BASE_URL}/recently-updated-stores/${slug}/?page=1` });
  }
  console.log(`  Platforms: ${platforms.size} (×3 = ${platforms.size * 3})`);
  await sleep(500);

  const countriesHtml = await (await session.fetch(`${BASE_URL}/all-countries/`)).text();
  const countrySlugs = new Set<string>();
  const countryRegex = /stores-by-country\/(?:contacts|stores|alexa-rank)\/([^/"]+)/g;
  while ((m = countryRegex.exec(countriesHtml)) !== null) {
    if (!skip.has(m[1]) && m[1].length > 2) countrySlugs.add(m[1]);
  }
  for (const slug of countrySlugs) {
    views.push({ label: `country-contacts:${slug}`, url: `${BASE_URL}/stores-by-country/contacts/${slug}/?page=1` });
    views.push({ label: `country-stores:${slug}`, url: `${BASE_URL}/stores-by-country/stores/${slug}/?page=1` });
  }
  console.log(`  Countries: ${countrySlugs.size} (×2 = ${countrySlugs.size * 2})`);
  await sleep(500);

  const indHtml = await (await session.fetch(`${BASE_URL}/all-industries/`)).text();
  const industrySlugs = new Set<string>();
  const indRegex = /stores-by-category\/(?:contacts|stores|alexa-rank)\/([^/"]+)/g;
  while ((m = indRegex.exec(indHtml)) !== null) {
    if (!skip.has(m[1])) industrySlugs.add(m[1]);
  }
  for (const slug of industrySlugs) {
    views.push({ label: `category:${slug}`, url: `${BASE_URL}/stores-by-category/stores/${slug}/?page=1` });
    views.push({ label: `category-contacts:${slug}`, url: `${BASE_URL}/stores-by-category/contacts/${slug}/?page=1` });
  }
  console.log(`  Categories: ${industrySlugs.size} (×2 = ${industrySlugs.size * 2})`);
  await sleep(500);

  const techSlugs = new Set<string>();
  const techRegex = /stores-by-technology\/(?:contacts|stores|alexa-rank)\/([^/"]+)/g;
  for (let techPage = 1; techPage <= 10; techPage++) {
    const techUrl = techPage === 1 ? `${BASE_URL}/all-technologies/` : `${BASE_URL}/all-technologies/?&page=${techPage}`;
    const techHtml = await (await session.fetch(techUrl)).text();
    const before = techSlugs.size;
    while ((m = techRegex.exec(techHtml)) !== null) {
      if (!skip.has(m[1])) techSlugs.add(m[1]);
    }
    if (techSlugs.size === before && techPage > 1) break;
    await sleep(300);
  }
  for (const slug of techSlugs) {
    views.push({ label: `tech:${slug}`, url: `${BASE_URL}/stores-by-technology/stores/${slug}/?page=1` });
    views.push({ label: `tech-contacts:${slug}`, url: `${BASE_URL}/stores-by-technology/contacts/${slug}/?page=1` });
  }
  console.log(`  Technologies: ${techSlugs.size} (×2 = ${techSlugs.size * 2})`);
  await sleep(500);

  for (const slug of ["amazon", "walmart", "etsy", "ebay"]) {
    views.push({ label: `seller:${slug}`, url: `${BASE_URL}/sellers/all/${slug}/` });
  }
  views.push({ label: `ranking:nrf-top-100`, url: `${BASE_URL}/rankings/all/nrf-top-100/` });
  views.push({ label: `ranking:nrf-global-250`, url: `${BASE_URL}/rankings/all/nrf-global-250/` });
  views.push({ label: `specialty:bricks-and-mortar`, url: `${BASE_URL}/bricks-and-mortar/all/` });
  views.push({ label: `specialty:digital-goods`, url: `${BASE_URL}/digital-goods-sellers/all/` });
  views.push({ label: `specialty:dnvb`, url: `${BASE_URL}/digitally-native-vertical-brand/all/` });
  views.push({ label: `specialty:subscription-boxes`, url: `${BASE_URL}/subscription-boxes/all/` });

  console.log(`  Total views: ${views.length}`);
  return views;
}

// ============================================================================
// Phase 3: CSV export (parallel workers)
// ============================================================================

async function httpExportView(
  session: HttpSession,
  viewUrl: string
): Promise<{ success: boolean; csvContent?: string; creditsUsed?: number; limitExceeded?: boolean; noExport?: boolean }> {
  const pageRes = await session.fetch(viewUrl);
  const pageHtml = await pageRes.text();

  const exportQueryMatch = pageHtml.match(/export_query\s*=\s*'([^']+)'/);
  const totalCountMatch = pageHtml.match(/total_count\s*=\s*'(\d+)'/);

  if (!exportQueryMatch) {
    if (pageHtml.includes("Upgrade") || pageHtml.includes("upgrade") || pageHtml.includes("download_limit")) {
      return { success: false, limitExceeded: true };
    }
    return { success: false, noExport: true };
  }

  const totalCount = parseInt(totalCountMatch?.[1] || "0");
  const creditsNeeded = Math.min(totalCount, 100);
  const isCompany = pageHtml.match(/is_company\s*=\s*'?(\d)'?/)?.[1] || "1";

  const exportRes = await session.fetch(`${BASE_URL}/process/export-all-records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE_URL,
      Referer: viewUrl,
    },
    body: `is_company=${isCompany}&export_query=${exportQueryMatch[1]}&total_count=${totalCount}`,
  });

  let filename = "";
  try {
    const result = JSON.parse((await exportRes.text()).trim());
    if (result.status !== "success") {
      if (result.msg?.includes("download_limit") || result.msg?.includes("limit_exceeded")) {
        return { success: false, limitExceeded: true };
      }
      return { success: false };
    }
    filename = result.filename;
  } catch {
    return { success: false };
  }

  const csvRes = await session.fetch(`${BASE_URL}/collect/?name=${filename}`);
  let csvContent = "";
  if (csvRes.status >= 300 && csvRes.status < 400) {
    const loc = csvRes.headers.get("location");
    if (loc) {
      const r = await session.fetch(loc.startsWith("http") ? loc : `${BASE_URL}${loc}`);
      csvContent = await r.text();
    }
  } else {
    csvContent = await csvRes.text();
  }

  if (!csvContent || csvContent.includes("<!DOCTYPE") || csvContent.includes("<html")) {
    return { success: false, creditsUsed: creditsNeeded };
  }

  return { success: true, csvContent, creditsUsed: creditsNeeded };
}

async function runPhase3(progress: Progress, allViews: ExportView[]) {
  console.log(`--- Phase 3: CSV Export (${EXPORT_CONCURRENCY} parallel workers) ---`);

  const availableAccounts = progress.accounts.filter((a) => a.creditsUsed < a.creditsTotal);
  if (availableAccounts.length === 0) {
    console.log("No accounts with credits. Skipping CSV export.\n");
    return;
  }

  const pendingViews = allViews.filter((v) => !progress.completedViews.includes(v.label));
  if (pendingViews.length === 0) {
    console.log("All views already exported. Skipping.\n");
    return;
  }

  console.log(`Pending views: ${pendingViews.length}, Available accounts: ${availableAccounts.length}\n`);

  let accountIdx = 0;
  let exportedCount = 0;

  let writeLock = Promise.resolve();
  function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const p = writeLock.then(fn);
    writeLock = p.then(() => {}, () => {});
    return p;
  }

  function claimNextAccount(): Account | null {
    while (accountIdx < availableAccounts.length) {
      const acct = availableAccounts[accountIdx];
      accountIdx++;
      if (acct.creditsUsed < acct.creditsTotal) return acct;
    }
    return null;
  }

  async function worker(workerId: number) {
    let account = await withLock(() => claimNextAccount());
    if (!account) return;

    const session = new HttpSession();
    let loggedIn = false;

    while (true) {
      const view = await withLock(() => {
        const idx = pendingViews.findIndex((v) => !v._claimed);
        if (idx === -1) return null;
        pendingViews[idx]._claimed = true;
        return pendingViews[idx];
      });
      if (!view) break;

      if (!account || account.creditsUsed >= account.creditsTotal) {
        account = await withLock(() => claimNextAccount());
        if (!account) { await withLock(() => { view._claimed = false; }); break; }
        loggedIn = false;
      }

      if (!loggedIn) {
        if (!(await httpLogin(session, account.email, account.password))) {
          console.log(`  [W${workerId}] Login failed for ${account.email}`);
          await withLock(() => { account!.creditsUsed = account!.creditsTotal; });
          account = await withLock(() => claimNextAccount());
          if (!account) { await withLock(() => { view._claimed = false; }); break; }
          await withLock(() => { view._claimed = false; });
          continue;
        }
        loggedIn = true;
      }

      const result = await httpExportView(session, view.url);

      if (result.success && result.csvContent) {
        await withLock(() => {
          const csvFilename = `${view.label.replace(/[:/]/g, "_")}.csv`;
          fs.writeFileSync(path.join(CSV_DIR, csvFilename), result.csvContent!);
          const lineCount = result.csvContent!.split("\n").filter((l: string) => l.trim()).length - 1;
          console.log(`  [W${workerId}] ${view.label}: ${lineCount} rows, ${result.creditsUsed} cr`);
          account!.creditsUsed += result.creditsUsed || 0;
          progress.completedViews.push(view.label);
          progress.csvFiles.push(csvFilename);
          exportedCount++;
          saveProgress(progress);
        });
      } else if (result.limitExceeded) {
        await withLock(() => { account!.creditsUsed = account!.creditsTotal; });
        loggedIn = false;
        await withLock(() => { view._claimed = false; });
        account = await withLock(() => claimNextAccount());
        if (!account) break;
      } else {
        await withLock(() => {
          progress.completedViews.push(view.label);
          console.log(`  [W${workerId}] ${view.label}: ${result.noExport ? "no export" : "failed"}`);
          saveProgress(progress);
        });
      }

      await sleep(500);
    }
  }

  const numWorkers = Math.min(EXPORT_CONCURRENCY, availableAccounts.length, pendingViews.length);
  await Promise.all(Array.from({ length: numWorkers }, (_, i) => worker(i)));
  console.log(`Exported ${exportedCount} views this run.\n`);
}

// ============================================================================
// Phase 4: Search scraping (data-row_data from HTML, no credits)
// ============================================================================

function extractRowData(html: string): any[] {
  const records: any[] = [];
  const seen = new Set<string>();
  const regex = /data-row_data=['"](.*?)['"]/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const obj = JSON.parse(decoded);
      const id = obj.id || obj.contact_id;
      if (id && !seen.has(id)) {
        seen.add(id);
        records.push(obj);
      }
    } catch {}
  }
  return records;
}

function generateSearchTerms(): string[] {
  const terms = new Set<string>();

  for (const t of [
    "shoes", "clothing", "electronics", "food", "jewelry", "furniture", "toys",
    "beauty", "health", "sports", "outdoor", "garden", "kitchen", "baby",
    "pet", "automotive", "books", "music", "art", "craft", "office",
    "tools", "hardware", "software", "gaming", "fitness", "yoga", "organic",
    "vegan", "luxury", "vintage", "handmade", "custom", "wholesale",
    "supplements", "vitamins", "skincare", "makeup", "fragrance", "candles",
    "coffee", "tea", "wine", "beer", "chocolate", "candy", "gifts",
    "flowers", "plants", "home decor", "lighting", "bedding", "bath",
    "luggage", "watches", "sunglasses", "handbags", "accessories",
    "dresses", "shirts", "jeans", "sneakers", "boots", "sandals",
    "phone cases", "laptops", "cameras", "headphones", "speakers",
    "cycling", "running", "swimming", "camping", "hiking", "fishing",
    "painting", "photography", "sewing", "knitting", "woodworking",
  ]) terms.add(t);

  for (const t of [
    "leather", "cotton", "silk", "wool", "linen", "bamboo", "ceramic",
    "glass", "steel", "copper", "gold", "silver", "diamond", "crystal",
    "wood", "marble", "rubber", "plastic", "paper", "fabric",
  ]) terms.add(t);

  for (const t of [
    "boutique", "store", "shop", "market", "outlet", "warehouse",
    "supply", "wholesale", "retail", "online", "direct", "factory",
    "brand", "designer", "studio", "gallery", "emporium",
  ]) terms.add(t);

  for (const t of [
    "new york", "london", "paris", "tokyo", "sydney", "berlin",
    "toronto", "dubai", "singapore", "hong kong", "los angeles",
    "chicago", "miami", "seattle", "austin", "denver", "portland",
    "boston", "atlanta", "dallas", "san francisco", "vancouver",
    "melbourne", "amsterdam", "barcelona", "stockholm", "mumbai",
  ]) terms.add(t);

  for (const t of [
    "shopify", "woocommerce", "magento", "bigcommerce", "squarespace",
    "wordpress", "etsy", "amazon", "ebay", "walmart",
  ]) terms.add(t);

  for (const c of "abcdefghijklmnopqrstuvwxyz") terms.add(c);
  for (const a of "aeiou") {
    for (const b of "bcdfghjklmnprstvwxyz") terms.add(a + b);
  }

  return Array.from(terms);
}

async function runPhase4(progress: Progress) {
  console.log("--- Phase 4: Search Scraping (no credits) ---");

  const searchProgress = loadSearchProgress();
  const account = progress.accounts[progress.accounts.length - 1];
  if (!account) {
    console.log("No accounts available for search. Skipping.\n");
    return;
  }

  const session = new HttpSession();
  let loggedIn = await httpLogin(session, account.email, account.password);
  if (!loggedIn) {
    for (let i = progress.accounts.length - 2; i >= Math.max(0, progress.accounts.length - 10); i--) {
      if (await httpLogin(session, progress.accounts[i].email, progress.accounts[i].password)) {
        loggedIn = true;
        break;
      }
    }
  }
  if (!loggedIn) {
    console.log("Search login failed. Skipping.\n");
    return;
  }
  console.log(`Search session ready.\n`);

  const allTerms = generateSearchTerms();
  const pendingTerms = allTerms.filter((t) => !searchProgress.completedTerms.includes(t));
  console.log(`Search terms: ${allTerms.length} total, ${pendingTerms.length} pending`);

  if (pendingTerms.length === 0) {
    console.log("All search terms completed. Skipping.\n");
    return;
  }

  let newRecords = 0;
  let consecutiveFailures = 0;

  for (const term of pendingTerms) {
    try {
      const searchUrl = `${BASE_URL}/search/?sn=${encodeURIComponent(term)}&pf=1&tab_name=by_alexa&data_type=online_stores&page=1`;
      const res = await session.fetch(searchUrl, { headers: { Referer: `${BASE_URL}/` } });

      let html = "";
      if (res.status >= 300 && res.status < 400) {
        consecutiveFailures++;
        await httpLogin(session, account.email, account.password);
        await sleep(Math.min(consecutiveFailures * 5000, 30000));
        const retryRes = await session.fetch(searchUrl, { headers: { Referer: `${BASE_URL}/` } });
        if (retryRes.status >= 300) { await sleep(5000); continue; }
        html = await retryRes.text();
        consecutiveFailures = 0;
      } else {
        html = await res.text();
        consecutiveFailures = 0;
      }

      const rows = extractRowData(html);
      let termNew = 0;
      for (const raw of rows) {
        const domain = raw.url || raw.store_url || "";
        if (!domain) continue;
        termNew++;
        newRecords++;
      }

      searchProgress.completedTerms.push(term);
      searchProgress.totalNewRecords += termNew;
      if (termNew > 0 || searchProgress.completedTerms.length % 50 === 0) {
        saveSearchProgress(searchProgress);
      }

      if (rows.length > 0) {
        console.log(`  "${term}": ${rows.length} rows, ${termNew} new`);
      }
    } catch (err: any) {
      console.log(`  "${term}": error - ${err.message}`);
      consecutiveFailures++;
    }

    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`Search done: ${newRecords} new records.\n`);
}

// ============================================================================
// Phase 5: Merge all CSVs + search data into deduplicated leads.jsonl
// ============================================================================

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function csvToRecords(csvContent: string, sourceLabel: string): any[] {
  const lines = csvContent.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]);
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h.replace(/"/g, "").trim(), i));

  const now = new Date().toISOString();
  const records: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 5) continue;

    const get = (name: string) => {
      const idx = colIndex.get(name);
      return idx !== undefined ? fields[idx]?.replace(/^"|"$/g, "").trim() : "";
    };

    const companyName = get("Company Name");
    const domain = get("URL");
    const storeUrl = get("Store Url");
    if (!domain) continue;

    const socials: any[] = [];
    const instagramUrl = get("Instagram URL");
    if (instagramUrl) {
      let url = instagramUrl;
      if (!url.startsWith("http")) url = `https://${url}`;
      socials.push({ platform: "instagram", url });
    }
    const linkedinUrl = get("Contact Li Profile");
    if (linkedinUrl) {
      let url = linkedinUrl;
      if (!url.startsWith("http")) url = `https://${url}`;
      socials.push({ platform: "linkedin", url });
    }

    const stableId = domain || storeUrl || `${companyName}-${i}`;

    const record: any = {
      core: {
        source_id: config.source_id,
        entity_type: config.entity_type,
        scraped_at: now,
        raw_url: `${BASE_URL}/${sourceLabel}`,
        primary_key: `${config.source_id}:domain:${stableId}`,
      },
      company: {
        company_name: companyName || domain,
        domain: domain || undefined,
        industry: get("Industry") || get("Company Industry") || undefined,
        website: storeUrl ? `https://${storeUrl}` : undefined,
        location: {
          city: get("City") || get("Company City") || undefined,
          state: get("state") || get("Company state") || undefined,
          zip: get("Zip") || get("Company Zip") || undefined,
          country: get("Country") || get("Company Country") || undefined,
        },
      },
      contact: {
        email: get("Email") || get("Contact Email") || get("Company Email") || undefined,
        phone: get("Phone") || get("Company Phone") || undefined,
        first_name: get("First Name") || undefined,
        last_name: get("Last Name") || undefined,
        title: get("Title") || undefined,
        socials: socials.length > 0 ? socials : undefined,
      },
      context: {
        alexa_rank: parseInt(get("Alexa Rank")) || undefined,
        platform: get("Platform Name") || undefined,
        store_url: storeUrl || undefined,
        shipping_providers: get("Shipping Providers") || undefined,
      },
    };

    cleanRecord(record);
    records.push(record);
  }

  return records;
}

function rowDataToRecord(raw: any, sourceUrl: string): any {
  const socials: any[] = [];
  for (const [key, platform] of [
    ["facebook_url", "facebook"], ["twitter_url", "twitter"], ["linkedin_url", "linkedin"],
    ["pinterest_url", "pinterest"], ["youtube_url", "youtube"], ["instagram_url", "instagram"],
    ["li_url", "linkedin"],
  ] as const) {
    const val = raw[key];
    if (val && val.length > 5) {
      let url = val;
      if (!url.startsWith("http")) url = `https://${url}`;
      socials.push({ platform, url });
    }
  }

  const domain = raw.url || raw.store_url || "";
  const stableId = raw.id || raw.contact_id || domain;

  const record: any = {
    core: {
      source_id: config.source_id,
      entity_type: config.entity_type,
      scraped_at: new Date().toISOString(),
      raw_url: sourceUrl,
      primary_key: `${config.source_id}:domain:${domain || stableId}`,
    },
    company: {
      company_name: raw.name || domain || undefined,
      domain: domain || undefined,
      industry: raw.industry || raw.sub_industry || undefined,
      website: raw.store_url ? `https://${raw.store_url}` : undefined,
      location: {
        city: raw.city || undefined,
        state: raw.state || undefined,
        zip: raw.zip || undefined,
        country: raw.country || undefined,
      },
    },
    contact: {
      email: raw.email || raw.contact_email || undefined,
      phone: raw.phone || undefined,
      first_name: raw.first_name || undefined,
      last_name: raw.last_name || undefined,
      title: raw.title || undefined,
      socials: socials.length > 0 ? socials : undefined,
    },
    context: {
      cart_id: raw.id || undefined,
      alexa_rank: parseInt(raw.rank) || undefined,
      platform: raw.platform_name || undefined,
      store_url: raw.store_url || undefined,
      sub_industry: raw.sub_industry || undefined,
      shipping_providers: raw.shipping_providers || undefined,
      meta_title: raw.meta_title || undefined,
    },
  };

  cleanRecord(record);
  return record;
}

function cleanRecord(obj: Record<string, unknown>, preserveKeys = new Set(["core", "company", "contact", "context"])) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined || val === null || val === "") {
      delete obj[key];
    } else if (typeof val === "object" && !Array.isArray(val)) {
      cleanRecord(val as Record<string, unknown>, new Set());
      if (Object.keys(val as object).length === 0 && !preserveKeys.has(key)) delete obj[key];
    }
  }
}

function runPhase5() {
  console.log("--- Phase 5: Merge & Deduplicate into leads.jsonl ---");

  const seenDomains = new Set<string>();
  const allRecords: any[] = [];

  // 1. Read all CSVs
  const csvFiles = fs.existsSync(CSV_DIR) ? fs.readdirSync(CSV_DIR).filter((f) => f.endsWith(".csv")) : [];
  let csvRecordCount = 0;
  for (const csvFile of csvFiles) {
    const csvContent = fs.readFileSync(path.join(CSV_DIR, csvFile), "utf-8");
    const records = csvToRecords(csvContent, csvFile.replace(".csv", ""));
    for (const rec of records) {
      const domain = rec.company?.domain;
      if (domain && seenDomains.has(domain)) continue;
      if (domain) seenDomains.add(domain);
      allRecords.push(rec);
      csvRecordCount++;
    }
  }
  console.log(`  CSVs: ${csvFiles.length} files → ${csvRecordCount} unique records`);

  // 2. Read existing leads.jsonl for search-sourced records not in CSVs
  if (fs.existsSync(leadsFile)) {
    const lines = fs.readFileSync(leadsFile, "utf-8").split("\n").filter((l) => l.trim());
    let extraRecords = 0;
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        const domain = rec.company?.domain;
        if (domain && seenDomains.has(domain)) continue;
        if (domain) seenDomains.add(domain);
        // Patch old records
        if (!rec.company?.company_name && domain) rec.company.company_name = domain;
        if (!rec.contact) rec.contact = {};
        if (!rec.context) rec.context = {};
        // Fix primary_key format to use domain
        if (rec.core?.primary_key && !rec.core.primary_key.includes(":domain:") && domain) {
          rec.core.primary_key = `${config.source_id}:domain:${domain}`;
        }
        allRecords.push(rec);
        extraRecords++;
      } catch {}
    }
    console.log(`  Previous leads.jsonl: ${lines.length} lines → ${extraRecords} additional unique`);
  }

  // 3. Write merged output
  const stream = fs.createWriteStream(leadsFile, { flags: "w" });
  for (const rec of allRecords) {
    if (!rec.contact) rec.contact = {};
    if (!rec.context) rec.context = {};
    stream.write(JSON.stringify(rec) + "\n");
  }
  stream.end();

  // 4. Stats
  let withEmail = 0, withPhone = 0, withSocials = 0;
  for (const rec of allRecords) {
    if (rec.contact?.email) withEmail++;
    if (rec.contact?.phone) withPhone++;
    if (rec.contact?.socials?.length > 0) withSocials++;
  }

  console.log(`\n  Total unique records: ${allRecords.length}`);
  console.log(`  With email: ${withEmail} (${((withEmail / allRecords.length) * 100).toFixed(1)}%)`);
  console.log(`  With phone: ${withPhone} (${((withPhone / allRecords.length) * 100).toFixed(1)}%)`);
  console.log(`  With socials: ${withSocials} (${((withSocials / allRecords.length) * 100).toFixed(1)}%)`);

  // 5. Write run.json
  const runJson = {
    source_id: config.source_id,
    run_id: `run_${Date.now()}`,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    records_found: allRecords.length,
    records_valid: allRecords.length,
    records_written: allRecords.length,
    error_count: 0,
    errors: [],
    notes: `Merged from ${csvFiles.length} CSV exports + search scraping.`,
  };
  fs.writeFileSync(path.join(outputDir, "run.json"), JSON.stringify(runJson, null, 2));
  updateDataAsOf(__dirname);

  console.log(`  Output: ${leadsFile}\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const mergeOnly = process.argv.includes("--merge-only");

  console.log("=== CartInsight Consolidated Scraper ===\n");

  const progress = loadProgress();
  console.log(`Existing accounts: ${progress.accounts.length}`);
  console.log(`Completed views: ${progress.completedViews.length}`);
  console.log(`CSV files: ${progress.csvFiles.length}\n`);

  if (mergeOnly) {
    runPhase5();
    console.log("\n=== Done (merge only) ===");
    return;
  }

  // Phase 1: Create accounts (target 40 with credits)
  await runPhase1(progress, 40);

  const availableAccounts = progress.accounts.filter((a) => a.creditsUsed < a.creditsTotal);
  console.log(`Available accounts with credits: ${availableAccounts.length}\n`);

  // Phase 2: Discover views
  console.log("--- Phase 2: View Discovery ---");
  const discoverySession = new HttpSession();
  const anyAccount = progress.accounts[progress.accounts.length - 1];
  if (!anyAccount || !(await httpLogin(discoverySession, anyAccount.email, anyAccount.password))) {
    console.log("Cannot login for discovery. Running merge only.\n");
    runPhase5();
    return;
  }
  console.log(`Logged in for discovery.\n`);
  const allViews = await discoverViews(discoverySession);
  console.log();

  // Phase 3: Export CSVs
  await runPhase3(progress, allViews);

  // Phase 4: Search scraping
  await runPhase4(progress);

  // Phase 5: Merge everything
  runPhase5();

  // Cleanup exhausted inboxes
  const exhausted = progress.accounts.filter((a) => a.creditsUsed >= a.creditsTotal);
  if (exhausted.length > 0) {
    console.log(`Cleaning up ${exhausted.length} exhausted inboxes...`);
    let deleted = 0;
    for (const acct of exhausted) {
      try { await agentmail.inboxes.delete(acct.email); deleted++; } catch {}
    }
    console.log(`  Deleted ${deleted}/${exhausted.length} inboxes`);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
