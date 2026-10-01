# jobs_db

A collection of scraper "source packages" that extract structured business data from public websites, plus the pipeline that feeds the public **jobs db** dataset (`ds_hiring_cafe` on Supabase, ~178k hiring.cafe jobs).

Formerly `scrappypuffle` — renamed to match the dataset it primarily maintains.

## Layout

```
├── AGENTS.md            # Required workflow for anyone (human or agent) adding scrapers
├── DATA-RULES.md        # The data contract every record must conform to
├── ONBOARDING.md        # Walkthrough of the hiring.cafe pipeline
├── lib/source-config.ts # Shared config/output helpers — all scrapers must use this
├── template/            # Reference source package; copy this to start a new scraper
├── validator/           # Quality gate: npx tsx validator/validate-scraper-output.ts <dir>
├── data_in_progress/    # In-development scrapers (<industry>/<source>/)
│   └── jobs/hiring_cafe/      # The active hiring.cafe scraper + loader
├── final_data/          # Approved, production scrapers (moved by a human after review)
├── consolidated/        # Merged dataset of all committed sources (see consolidated/README.md)
├── ui/                  # Small dashboard for browsing scraped entities
└── datasets_to_scrape.md
```

Each source package contains `source.yaml` (config: source_id, entity_type, run_command, primary_key strategy), `scraper.ts`, `output/` (`leads.jsonl`, `run.json`, progress files), and a `README.md`.

## The data contract

Every scraper emits `output/leads.jsonl` — one JSON object per line with `core` (source_id, entity_type, scraped_at, raw_url, deterministic `primary_key`), exactly one of `person`/`company`, `contact`, and `context`. See **DATA-RULES.md** for the full schema and **AGENTS.md** for the end-to-end workflow (new source → `data_in_progress/` → validator gate → review sample → human promotes to `final_data/`).

## hiring.cafe → jobs db

`data_in_progress/jobs/hiring_cafe/` is the pipeline that refreshes `ds_hiring_cafe`:

- `scraper.ts` — SSR scraper. Cloudflare blocks hiring.cafe's JSON API from datacenter IPs, so it loads the public search page in a fresh Playwright context per industry and reads `__NEXT_DATA__.ssrHits` (~20k jobs per full 1,453-industry sweep). Resumable via progress files.
- `run-scrape.sh` — idempotent watchdog wrapper (needs `xvfb-run -a` on headless boxes).
- `load-to-supabase.ts` — owner-run loader; upserts `leads.jsonl` into `ds_hiring_cafe` in batches of 500 on `primary_key`.
- `.agents/skills/jobs-data-refresh/` — runbook skill covering the full refresh.

```bash
cd data_in_progress/jobs/hiring_cafe
xvfb-run -a npx tsx scraper.ts 1453 30        # full sweep, last-30-days filter
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=$JOBS_DATA_SUPABASE_SECRET_KEY \
  npx tsx load-to-supabase.ts                  # owner-run only
```

### Public read API

`ds_hiring_cafe` is a standalone, publicly readable dataset (RLS-enabled, read-only via the publishable key):

```bash
curl "https://snimonofzyrbsqovpnsq.supabase.co/rest/v1/ds_hiring_cafe?select=*&limit=10" \
  -H "apikey: sb_publishable_TPu8VN6vPj2yKYAG-Z-_fg_LubsqKkn"
```

## Setup

```bash
npm install
npx playwright install chromium   # browser scrapers only
```

Copy `.env.local.example` → `.env` (loaded as `.env` from repo root) and fill in what the source needs:

| Variable | Used by |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `load-to-supabase.ts` (the project's `sb_secret_...` key — never commit it) |
| `BRIGHTDATA_API_KEY` | legacy BrightData-based scrapers |
| `AGENTMAIL_API_KEY` | scrapers that create accounts / receive magic links |
| `ICSC_EMAIL`, `ICSC_PASSWORD` | `final_data/real_estate/icsc/` |

## Rules of thumb

- Never commit credentials — `.env`, `.env.local`, and `.worktrees/` are gitignored; keep it that way. Account passwords used by scrapers must be generated per-account or read from env, never hardcoded.
- Prefer HTTP/API over Playwright; browser automation is the last resort.
- Deterministic `primary_key` from a stable source ID — never UUIDs.
- Don't load data into the database yourself; loading is an owner-directed ops step.
