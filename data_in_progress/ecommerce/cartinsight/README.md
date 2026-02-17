# CartInsight E-Commerce Store Directory

**Source ID:** `ecommerce/cartinsight`
**Entity type:** company
**URL:** https://app.cartinsight.io/all-carts/
**Records:** ~24,450 unique e-commerce stores with contact info

## About the Source

CartInsight is a directory of e-commerce stores indexed by platform, category, country, and technology. It contains ~148K total stores across 19 platforms (Shopify, WooCommerce, BigCommerce, Magento, etc.).

The site requires a free account (email + password). Each account gets 100 CSV download credits. Page 2+ of any listing is paywalled, so each view yields at most 15 visible rows but up to 100 CSV-exported rows.

## Architecture

The scraper has 5 phases, all in `scraper.ts`:

### Phase 1: Account Creation
- Uses **Playwright** to visit the signup page at `https://www.cartinsight.io/signup/`
- Solves a hex captcha (6-character, `[0-9a-f]`) using **Tesseract.js** OCR with 3 image preprocessing variants (upscaled, inverted, binary threshold)
- Creates disposable inboxes via **AgentMail** on the `developiq.co` domain (note: `agentmail.to` and common disposable domains are blocked)
- Polls for activation email and follows the activation link
- Each account gets 100 download credits

### Phase 2: View Discovery
- Logs in via HTTP (POST to `/account/login` with CSRF token `rset_login_token`)
- Crawls `/all-carts/`, `/all-countries/`, `/all-industries/`, `/all-technologies/`
- Builds a list of ~559 views (platform, category, country, tech, sellers, rankings, specialty)

### Phase 3: CSV Export (costs credits)
- 5 parallel HTTP workers, each with its own session
- For each view: loads the page, extracts `export_query` from JS, POSTs to `/process/export-all-records`
- Downloads the resulting CSV from `/collect/?name=<filename>`
- Rotates to a new account when credits are exhausted
- CSVs saved to `output/csvs/`

### Phase 4: Search Scraping (free, no credits)
- Uses GET requests to `/search/?sn=TERM&pf=1&tab_name=by_alexa&data_type=online_stores&page=1`
- Extracts `data-row_data` JSON attributes embedded in the HTML (15 records per search, no pagination)
- 279 search terms (product categories, materials, business types, cities, platforms, alphabet combos)
- **3-second delay** between requests to avoid rate limiting (302 redirects)
- Re-login + exponential backoff on consecutive failures

### Phase 5: Merge & Deduplicate
- Reads all CSVs from `output/csvs/` (priority source)
- Reads existing `leads.jsonl` for additional records from search
- Deduplicates by domain
- Writes merged `leads.jsonl`, `run.json`, updates `data_as_of`

## Two CSV Formats

**Stores CSV** (15 columns): Company Name, Alexa Rank, Platform Name, URL, Store Url, Phone, Email, Address, City, state, Zip, Country, Industry, Shipping Providers, Instagram URL

**Contacts CSV** (20 columns): Adds First Name, Last Name, Title, Contact Email, Company Phone, Company Email, Company Address, Company City, Company state, Company Zip, Company Country, Company Industry, Contact Li Profile

## Site-Specific Quirks

- **Disposable email blocking**: agentmail.to and common disposable domains are rejected at signup. Must use `developiq.co` or `pufflemail.com` via AgentMail.
- **Rate limiting on search**: Requests faster than ~1/3s trigger 302 redirects to `/`. Sessions recover after re-login + backoff.
- **Page 2+ paywalled**: All listing types (platform, category, country, technology, search) only show page 1 to free accounts. CSV export bypasses this (up to 100 rows per view).
- **CSRF token**: Login requires `rset_login_token` extracted from the homepage HTML.
- **PHP/jQuery stack**: Server-side rendered, no SPA or client-side API to exploit.
- **Captcha charset**: Hex only (`0-9a-f`), 6 characters, red background.

## Environment Requirements

- `AGENTMAIL_API_KEY` in `.env`
- Dependencies: `playwright`, `tesseract.js`, `sharp`, `agentmail`, `dotenv`
- Playwright Chromium must be installed (`npx playwright install chromium`)

## Usage

```bash
# Full pipeline (creates accounts, discovers views, exports CSVs, searches, merges)
npx tsx scraper.ts

# Merge only (re-process existing CSVs + search data into leads.jsonl)
npx tsx scraper.ts --merge-only
```

Resumes automatically from `pipeline-progress.json` and `search-progress.json`.

## Data Quality

- 24,450 unique records (deduplicated by domain)
- 47.2% have email
- 57.5% have phone
- 49.3% have social links
- Primary key: `ecommerce/cartinsight:domain:<domain>`
