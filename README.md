# jobs_db

A scraper monorepo that produces structured job-posting data — its main output is
the public **jobs db** on Supabase (`ds_hiring_cafe`, ~178k US jobs from
hiring.cafe).

> **Split note:** lead datasets (ICSC, YC founders, CartInsight, investors, real
> estate, finance) now live in `DevelopIQ-ai/leads_db_scraped`. This repo is the
> hiring.cafe jobs pipeline plus the shared scraper framework it runs on.

## Layout

```
├── AGENTS.md            # Rules for AI agents building scrapers (required reading)
├── CLAUDE.md            # Entry point for Claude Code
├── ONBOARDING.md        # Walkthrough of the hiring.cafe pipeline
├── DATA-RULES.md        # The data contract every record must satisfy
├── lib/source-config.ts # Shared config/output helpers — all scrapers must use this
├── template/            # Reference source package; copy this to start a new scraper
├── validator/           # Quality gate: npx tsx validator/validate-scraper-output.ts <dir>
├── data_in_progress/
│   └── jobs/hiring_cafe/      # The active hiring.cafe scraper + loader
└── .agents/skills/jobs-data-refresh/  # Playbook for refresh runs
```

The `data_in_progress/jobs/hiring_cafe/` package contains `source.yaml` (config:
source_id, entity_type, run_command, primary_key strategy), `scraper.ts`,
`output/` (`leads.jsonl`, `run.json`, progress files), `load-to-supabase.ts`,
`run-scrape.sh`, and a `README.md`.

## How it works (the contract)

Every record is one JSON line shaped:

- `core` — `source_id`, `entity_type` (`person`/`company`/`job`), `scraped_at`,
  `raw_url`, deterministic `primary_key` (UUIDs forbidden)
- one of `person`, `company`, or `job`
- `contact` — emails, phones, socials
- `context` — source-specific extras

See DATA-RULES.md for the full contract and AGENTS.md for the agent workflow.

## The hiring.cafe pipeline

`data_in_progress/jobs/hiring_cafe/`:

- `scraper.ts` — Playwright-based SSR scraper. hiring.cafe renders its first
  page server-side into `__NEXT_DATA__.props.pageProps.ssrHits`, which
  sidesteps the Cloudflare challenge that blocks the public
  `/api/search-jobs` endpoint on datacenter IPs. Slices a full sweep across
  `industries.txt` (~20k jobs per run), with a fresh browser context per
  industry and resumable progress.
- `run-scrape.sh` — watchdog wrapper that restarts the scraper until the sweep
  finishes.
- `load-to-supabase.ts` — owner-run loader that upserts `output/leads.jsonl`
  into the `ds_hiring_cafe` table on `primary_key` in batches of 500.
- `output/` — `leads.jsonl` (scraped jobs), `run.json`, progress files.
  Not committed (too large).

```bash
cd data_in_progress/jobs/hiring_cafe
xvfb-run -a npx tsx scraper.ts            # fresh sweep (needs xvfb for headful browsers)
# or: ./run-scrape.sh                     # watchdog version
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx load-to-supabase.ts
```

## Public read API

The jobs db is readable with the publishable anon key (RLS-protected, read-only
— verified GET 200 / POST 401):

```bash
curl 'https://snimonofzyrbsqovpnsq.supabase.co/rest/v1/ds_hiring_cafe?select=*&limit=10' \
  -H 'apikey: sb_publishable_TPu8VN6vPj2yKYAG-Z-_fg_LubsqKkn'
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | `data_in_progress/jobs/hiring_cafe/.env` | Supabase project URL for the loader |
| `SUPABASE_SERVICE_ROLE_KEY` | `data_in_progress/jobs/hiring_cafe/.env` | Service-role key for upserts — never committed |
| `BRIGHTDATA_API_KEY` | `.env` | Proxy for scrapers that need it |
| `AGENTMAIL_API_KEY` | `.env` | Disposable inboxes for account-required scrapers |
| `ICSC_EMAIL` / `ICSC_PASSWORD` | `.env` | Legacy ICSC login (scraper moved to leads_db) |

## Rules of thumb

- JSONL is the source of truth — no inventing values; omit fields you can't fill.
- Prefer HTTP/API over Playwright; browser automation is the last resort.
- Account passwords used by scrapers must be generated per-account or read from
  env, never hardcoded. `.env` is gitignored — never commit real credentials.
