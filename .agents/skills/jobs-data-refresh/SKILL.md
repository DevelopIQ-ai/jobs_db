---
name: jobs-data-refresh
description: Re-scrape hiring.cafe via the SSR scraper to refresh the "jobs data" Supabase dataset (ds_hiring_cafe), and check its freshness. Use when asked to update, reload, or refresh hiring.cafe / jobs data, or work on the scrappypuffle → Supabase jobs pipeline. The database load itself is owner-run — see the Load section.
---

# Jobs data refresh

The **"jobs data" Supabase project** (`snimonofzyrbsqovpnsq`, us-west-2) is a standalone, publicly readable dataset — no app reads it. It holds exactly one data table, `ds_hiring_cafe` (~178k rows), populated by this repo's scraper at `data_in_progress/jobs/hiring_cafe/`.

## Public API (no auth needed beyond the publishable key)

```
GET https://snimonofzyrbsqovpnsq.supabase.co/rest/v1/ds_hiring_cafe?limit=100
Header: apikey: sb_publishable_TPu8VN6vPj2yKYAG-Z-_fg_LubsqKkn
```

PostgREST filters work (`?title=ilike.*engineer*&salary_min_yearly=gte.100000`). RLS allows anon SELECT only; writes are rejected. The `datasets` catalog table is RLS-locked (not public).

## Scrape: `scraper.ts`

Cloudflare blocks `hiringcafe.com`'s `/api/search-jobs` on datacenter IPs, so the old API-pagination scrapers (`scrape-full.ts`, `scrape-deduped.ts`, `scrape-chunked.ts`, `scrape-by-industry.ts`) are dead — do NOT use them. `scraper.ts` instead reads `__NEXT_DATA__.props.pageProps.ssrHits` from public search HTML pages, rotating a fresh Playwright browser context per industry query (each fresh context gets one unchallenged page load). It emits the LeadRecord contract (core/company/contact/context) via `lib/source-config.ts`.

```bash
cd data_in_progress/jobs/hiring_cafe
npx tsx scraper.ts [maxIndustries] [daysLookback] [--fresh] [--retry-failed]   # e.g. 1453 30 for a full sweep
```

- Slices one query per industry in `industries.txt` (1,453 entries); ~10–13s each, ~4–5h for a full sweep.
- `output/leads.jsonl` always holds the last **completed** snapshot — in-progress rows go to `leads-inprogress.jsonl` and are promoted (old snapshot → `output/archive/`) only when the sweep finishes. Resumable via `output/scrape-progress.json` + dedupe rebuilt from the in-progress file.
- **Refresh semantics**: a completed sweep starts fresh on the next launch — periodic relaunches actually re-scrape. `--fresh` forces it; `--retry-failed` re-runs only the industries in `failed-industries.json` (appending into the current snapshot).
- Challenged industries are tracked by name and retried once automatically at the end of each sweep.
- A PID lock (`output/scrape.lock`, verified against `/proc/<pid>/cmdline`) plus the watchdog's pgrep prevent duplicate concurrent runs.
- `run.json` + `review_sample.json` are written at completion; `updateDataAsOf` bumps `source.yaml`.
- Only page 0 per query is SSR'd (~40–140 jobs/slice) → broad-shallow coverage; ~20% of slices get challenged on first pass. The ~6.1M-job deep tail is unreachable without residential IPs.
- Needs a display: headless fails. Use `xvfb-run -a` on headless boxes.

Quality gate: `npx tsx validator/validate-scraper-output.ts data_in_progress/jobs/hiring_cafe` should pass after a run.

For a long-running sweep with crash/reboot resilience, `run-scrape.sh` relaunches under xvfb if not already running — install it as a cron `@reboot` + periodic job:

```bash
( crontab -l; echo '@reboot /path/to/run-scrape.sh'; echo '*/10 * * * * /path/to/run-scrape.sh' ) | crontab -
```

## Load: `load-to-supabase.ts` — owner-run only

Per AGENTS.md, agents must NOT load data into the database. The load step below is run by the dataset owner (or a human explicitly running it themselves) — document it, do not execute it.

```bash
cd data_in_progress/jobs/hiring_cafe
SUPABASE_URL=https://snimonofzyrbsqovpnsq.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=$JOBS_DATA_SUPABASE_SECRET_KEY \
npx tsx load-to-supabase.ts [input.jsonl]   # defaults to output/leads.jsonl
```

- Unwraps contract records back to flat `ds_hiring_cafe` columns; replaces rows by `collapse_key` (delete + insert, 500-row batches) — reconciles both old job_id-keyed rows and new collapse_key-keyed ones; safe to rerun.
- `SUPABASE_SERVICE_ROLE_KEY` = the project's `sb_secret_...` key (Devin secret `JOBS_DATA_SUPABASE_SECRET_KEY`, or dashboard → Project Settings → API Keys). Never commit it.

After loading, bump the catalog: `UPDATE datasets SET record_count=..., data_as_of='today' WHERE source_id='jobs/hiring_cafe'` (SQL editor or service-key RPC).

## Gotchas (learned the hard way)

- Exact counts via REST time out (statement timeout on ~178k-row scan); count via SQL editor or estimate.
- Executor `leads-db` MCP tool: `selectRows` caps at 1,000 rows; `updateRows`/`deleteRows` key off a literal `id` column → useless on `ds_hiring_cafe` (pk is `primary_key`); `insertRows` is all-or-nothing per batch — prefer the loader script with the secret key.
- Two probe rows (`devin_test___probe___1/2`) may linger; delete via SQL editor only.
- SQL in the Supabase dashboard Monaco editor drops characters when typed programmatically — put SQL on the clipboard and paste it instead.
- The project sits on an over-quota grace period — heavy public traffic may throttle.

## Verify

```bash
curl -s "https://snimonofzyrbsqovpnsq.supabase.co/rest/v1/ds_hiring_cafe?select=scraped_at&order=scraped_at.desc&limit=1" \
  -H "apikey: sb_publishable_TPu8VN6vPj2yKYAG-Z-_fg_LubsqKkn"
```

Latest `scraped_at` = refresh date. Sanity-check row quality (`title`, `company_name`, `apply_url` non-empty) before calling a refresh done.
