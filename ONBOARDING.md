# Onboarding: Automating the Hiring.cafe Scraper

Welcome! Your job is to take our existing hiring.cafe scraper and make it run automatically on a schedule using Trigger.dev. This doc walks you through everything in order. Complete each milestone before moving on.

---

## What does this scraper do?

It pulls US job listings from [hiring.cafe](https://hiring.cafe) and saves them as a file. Then a separate script loads that data into our database (Supabase). Right now, someone has to manually run it. Your job is to make it run on its own.

---

## The files you'll be working with

Everything lives in `data_in_progress/jobs/hiring_cafe/`. Here are the files that matter:

| File | What it does |
|---|---|
| `scrape-full.ts` | **The main scraper.** Opens hiring.cafe in a headless browser, calls their API to fetch US jobs page by page, and writes results to a JSONL file. |
| `load-to-supabase.ts` | **The database loader.** Reads the JSONL file and inserts the jobs into our Supabase database (table: `ds_hiring_cafe`). |
| `test-api.ts` | **A test script.** Hits the hiring.cafe API with a small query so you can verify it's working. |
| `output/` | Where scraped data gets saved. |

Ignore the other files (`scrape-by-industry.ts`, `scrape-chunked.ts`, etc.) — those were experiments.

### How the scraper works

The scraper sends a filter to hiring.cafe's API as a base64-encoded JSON object. The key parameter is `dateFetchedPastNDays` — this controls how far back to look for jobs. The current scraper sets it to `120` (4 months worth = ~158k jobs). You'll be changing this value as you go.

### How the database works

We use **Supabase** (a hosted Postgres database).

- **Table name:** `ds_hiring_cafe`
- **How data gets there:** `load-to-supabase.ts` reads the JSONL output and inserts each job as a row (batches of 500)
- **Primary key:** The Supabase column is called `primary_key`. It stores the `job_id` value from hiring.cafe — this is what uniquely identifies each job.
- **Connection:** Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your `.env` file

The table already exists — you don't need to set it up.

---

## Milestone 1: Get set up locally

**Goal:** Install everything and confirm you can connect to the API and the database.

### 1a. Install Node.js

You need Node.js (v18 or newer). Download it from [nodejs.org](https://nodejs.org) — pick the LTS version.

Check that it worked:

```bash
node --version
```

You should see something like `v20.x.x`.

### 1b. Clone the repo and install dependencies

```bash
git clone <repo-url>
cd scrappypuffle
npm install
```

(Ask Evan for the repo URL if you don't have it.)

### 1c. Install the Playwright browser

The scraper uses Playwright to control a headless browser (a browser that runs without a visible window). Run:

```bash
npx playwright install chromium
```

### 1d. Set up environment variables

Create a file called `.env` in the project root (not `.env.local` — that's a Next.js thing and won't work here). Evan will give you the values:

```
SUPABASE_URL=<ask Evan>
SUPABASE_SERVICE_ROLE_KEY=<ask Evan>
```

**Important:** `load-to-supabase.ts` needs to load this file. Open it and add this line at the very top:

```ts
import 'dotenv/config';
```

This tells Node.js to read your `.env` file and make those values available. Without this line, the Supabase connection will silently fail.

### 1e. Test the API connection

```bash
cd data_in_progress/jobs/hiring_cafe
npx tsx test-api.ts
```

You should see JSON with job listings printed in your terminal. If you do, the API works.

### Milestone 1 is done when:
- `npm install` ran without errors
- `npx tsx test-api.ts` prints job data

---

## Milestone 2: Scrape the last 24 hours of jobs

**Goal:** Run a small scrape (last 24 hours, ~6k jobs) and load it into Supabase.

### 2a. Edit the scraper to only pull the last 24 hours

Open `scrape-full.ts`. Near the top, find this line:

```ts
dateFetchedPastNDays: 120,  // Last 4 months of jobs
```

Change it to:

```ts
dateFetchedPastNDays: 1,  // Last 24 hours of jobs
```

Also fix the hardcoded output path at the top of the file. Change:

```ts
const OUTPUT_DIR = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output';
```

To a relative path:

```ts
const OUTPUT_DIR = './output';
```

### 2b. Run the scraper

```bash
npx tsx scrape-full.ts
```

This should be much faster than the full scrape (~6k jobs instead of 158k). You'll see progress like:

```
Page 0/150: +40 jobs | Total: 40 | ETA: 1min
```

### 2c. Verify the output

> **Note:** These commands assume macOS or Linux. If you're on Windows, use Git Bash or WSL.

```bash
# Count how many jobs were scraped
wc -l output/us-jobs-full.jsonl

# Look at the first job
head -1 output/us-jobs-full.jsonl
```

Each job looks roughly like:

```json
{
  "job_id": "abc123",
  "title": "Software Engineer",
  "company_name": "Acme Corp",
  "workplace_type": "Remote",
  "locations": ["San Francisco, CA"],
  "salary_min_yearly": 120000,
  "salary_max_yearly": 180000,
  "scraped_at": "2026-03-28T12:00:00.000Z"
}
```

### 2d. Load into the database

You'll need to also fix the hardcoded path in `load-to-supabase.ts`. Change:

```ts
const INPUT_FILE = '/Users/evanbrooks/Desktop/scrappypuffle/data_in_progress/jobs/hiring_cafe/output/us-jobs-final.jsonl';
```

To:

```ts
const INPUT_FILE = './output/us-jobs-full.jsonl';
```

Then run it:

```bash
npx tsx load-to-supabase.ts
```

You should see a counter as it inserts rows in batches of 500.

### Milestone 2 is done when:
- The scraper ran and produced a JSONL file with ~6k jobs
- `load-to-supabase.ts` inserted them into Supabase without errors
- **You've checked in with Evan before moving on.** Show him your output and get the green light before starting Milestone 3.

---

## Milestone 3: Scale up the time window

**Goal:** Get comfortable adjusting `dateFetchedPastNDays` and understand how job volume scales with time.

Now that you've done a 24-hour scrape, try increasing the window. For each one, run the scraper and note how many jobs you get and how long it takes:

| `dateFetchedPastNDays` | Rough time window | Expected jobs | What this will become |
|---|---|---|---|
| `1` | Last 24 hours | ~6k | Daily automated task |
| `7` | Last week | ~30-40k | Weekly automated task |
| `30` | Last month | ~80-100k | Monthly automated task |
| `120` | Last 4 months | ~158k | Full backfill (one-time) |

For each test:

1. Change `dateFetchedPastNDays` in `scrape-full.ts`
2. Delete `output/progress.json` if it exists (so it starts fresh)
3. Run `npx tsx scrape-full.ts`
4. Note the job count and time taken

The numbers above are estimates — write down the actual numbers you get. You'll need them to set timeouts in Milestone 4.

### Milestone 3 is done when:
- You've run at least the 1-day and 7-day scrapes
- You have a rough sense of how long each takes and how many jobs each returns

---

## Milestone 4: Automate with Trigger.dev

**Goal:** Set up Trigger.dev and create scheduled tasks that run the scraper automatically.

### 4a. What is Trigger.dev?

Trigger.dev lets you run background jobs on a schedule. You write a "task" in TypeScript, deploy it, and it runs on their servers at whatever interval you set — no manual work needed.

### 4b. Set up Trigger.dev in this project

Follow their setup guide: https://trigger.dev/docs/manual-setup

This will walk you through:
- Creating a Trigger.dev account
- Installing the Trigger.dev SDK
- Adding a `trigger.config.ts` to the project
- Connecting the project to Trigger.dev

### 4c. Create the scheduled tasks

You'll create separate tasks for different frequencies:

| Task | Schedule | `dateFetchedPastNDays` |
|---|---|---|
| Daily job scrape | Once per day | `1` |
| Weekly job scrape | Once per week | `7` |

Each task needs to:
1. Scrape jobs from hiring.cafe (the logic from `scrape-full.ts`)
2. Load the results into Supabase (the logic from `load-to-supabase.ts`)

### 4d. Things you'll need to figure out

- **Playwright on Trigger.dev:** The scraper uses a headless browser. Trigger.dev supports this but you may need to configure it — search their docs for Playwright / browser support.
- **No local files:** The current scraper writes to a file on disk. On Trigger.dev's servers you won't have a persistent filesystem. You'll need to refactor the scraper to keep jobs in memory (an array) and pass them directly to the Supabase insert logic instead of writing/reading a file.
- **Environment variables:** You'll need to add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to your Trigger.dev project settings.
- **Timeouts:** Use your timing data from Milestone 3 to set appropriate timeouts for each task. A daily scrape (~6k jobs) is much faster than a weekly one (~30k+).

### 4e. Start small

Don't try to automate the full 120-day scrape first. Start with:

1. A Trigger.dev task that scrapes just 1 page (40 jobs) and inserts into Supabase
2. Once that works, expand to the full daily scrape (`dateFetchedPastNDays: 1`)
3. Then add the weekly task

### Milestone 4 is done when:
- Trigger.dev is set up and connected to this project
- A daily task runs automatically and inserts new jobs into `ds_hiring_cafe`
- A weekly task runs automatically on a weekly schedule
- Both work without anyone pressing a button

---

## Quick reference

| What | Command |
|---|---|
| Install dependencies | `npm install` |
| Install browser | `npx playwright install chromium` |
| Test the API | `cd data_in_progress/jobs/hiring_cafe && npx tsx test-api.ts` |
| Run scraper | `cd data_in_progress/jobs/hiring_cafe && npx tsx scrape-full.ts` |
| Load to database | `cd data_in_progress/jobs/hiring_cafe && npx tsx load-to-supabase.ts` |
| Trigger.dev setup docs | https://trigger.dev/docs/manual-setup |

---

## Who to ask for help

- **Evan** — for Supabase credentials, repo access, and any questions about the project
