---
name: jobs-data-refresh
description: Refresh the "jobs data" Supabase dataset (ds_hiring_cafe) end-to-end — re-scrape hiring.cafe via the SSR scraper and upsert results. Use when asked to update, reload, or refresh hiring.cafe / jobs data, check its freshness, or work on the scrappypuffle → Supabase jobs pipeline.
---

# Jobs data refresh

The **"jobs data" Supabase project** (`snimonofzyrbsqovpnsq`, us-west-2) is a standalone, publicly readable dataset — no app reads it. It holds exactly one data table, `ds_hiring_cafe` (~178k rows), populated by this repo's scraper at `data_in_progress/jobs/hiring_cafe/`.

## Public API (no auth needed beyond the publishable key)

```
GET https://snimonofzyrbsqovpnsq.supabase.co/rest/v1/ds_hiring_cafe?limit=100
Header: apikey: sb_publishable_TPu8VN6vPj2yKYAG-Z-_fg_LubsqKkn
```

PostgREST filters work (`?title=ilike.*engineer*&salary_min_yearly=gte.100000`). RLS allows anon SELECT only; writes are rejected. The `datasets` catalog table is RLS-locked (not public).

## Scrape: `scrape-ssr.ts`

Cloudflare blocks `hiringcafe.com`'s `/api/search-jobs` on datacenter IPs, so the old API-pagination scrapers (`scrape-full.ts`, `scrape-deduped.ts`, `scrape-chunked.ts`, `scrape-by-industry.ts`) are dead — do NOT use them. `scrape-ssr.ts` instead reads `__NEXT_DATA__.props.pageProps.ssrHits` from public search HTML pages, rotating a fresh Playwright browser context per industry query (each fresh context gets one unchallenged page load).

```bash
cd data_in_progress/jobs/hiring_cafe
npx tsx scrape-ssr.ts [maxIndustries] [daysLookback] [--fresh] [--retry-failed]   # e.g. 1453 30 for a full sweep
```

- Slices one query per industry in `industries.txt` (1,453 entries); ~10–13s each, ~4–5h for a full sweep.
- Output: `output/leads.jsonl` + `run.json`; progress in `output/progress-ssr.json`, failures in `output/failed-ssr.json` — **resumable**, dedupe set rebuilds from the output file on restart.
- **Refresh semantics**: a completed sweep self-archives the old file to `leads-<epoch>.jsonl` and starts fresh on the next launch — periodic relaunches actually re-scrape. `--fresh` forces it; `--retry-failed` re-runs only challenged industries.
- Challenged industries are tracked and retried once automatically at the end of each sweep.
- A PID lock (`output/scrape-ssr.lock`) plus the watchdog's pgrep prevent duplicate concurrent runs.
- Only page 0 per query is SSR'd (~40–140 jobs/slice) → broad-shallow coverage; ~20% of slices get challenged on first pass. The ~6.1M-job deep tail is unreachable without residential IPs.
- Needs a display: headless fails. Use `xvfb-run -a` on headless boxes.

For a long-running sweep with crash/reboot resilience, `run-scrape.sh` relaunches under xvfb if not already running — install it as a cron `@reboot` + periodic job:

```bash
( crontab -l; echo '@reboot /path/to/run-scrape.sh'; echo '*/10 * * * * /path/to/run-scrape.sh' ) | crontab -
```

## Load: `load-to-supabase.ts`

```bash
cd data_in_progress/jobs/hiring_cafe
SUPABASE_URL=https://snimonofzyrbsqovpnsq.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=$JOBS_DATA_SUPABASE_SECRET_KEY \
npx tsx load-to-supabase.ts [input.jsonl]   # defaults to output/leads.jsonl
```

- Upserts on `primary_key` in 500-row batches — safe to rerun; existing rows get fresh `scraped_at`.
- `SUPABASE_SERVICE_ROLE_KEY` = the project's `sb_secret_...` key (Devin secret `JOBS_DATA_SUPABASE_SECRET_KEY`, or dashboard → Project Settings → API Keys). Never commit it.
- The scraper never touches the DB. Loading is a separate ops step the dataset owner runs (or explicitly directs an agent to run) — that's the boundary AGENTS.md's "do not load data yourself" draws.

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
