# jobs/hiring_cafe — Hiring Cafe US jobs (SSR)

Scrapes hiring.cafe job listings into the standalone `ds_hiring_cafe` Supabase
table (the public "jobs data" dataset).

## Why SSR

Cloudflare challenges `hiringcafe.com/api/search-jobs` from datacenter IPs, so
the old API-pagination scrapers in this folder (`scrape-full.ts`,
`scrape-deduped.ts`, `scrape-chunked.ts`, `scrape-by-industry.ts`,
`explore.ts`, `test-*.ts`) no longer work — keep them for reference only.

`scraper.ts` instead loads the public search page `?searchState={...}` in a
fresh Playwright context per industry and reads
`__NEXT_DATA__.props.pageProps.ssrHits`. Each fresh context gets exactly one
unchallenged page load; only page 0 is SSR'd (~40–140 jobs per industry
slice). Slicing across `industries.txt` (1,453 industries) gives broad,
shallow coverage (~20k jobs per full sweep).

## Run

```bash
npx tsx scraper.ts 1453 30            # full sweep, last-30-days filter
npx tsx scraper.ts 1453 30 --fresh    # force restart even if incomplete
npx tsx scraper.ts --retry-failed     # retry challenged industries only
```

Needs a display (`xvfb-run -a` on headless boxes); `run-scrape.sh` is the
idempotent watchdog wrapper for cron.

## Output

- `output/leads.jsonl` — last **completed** snapshot only (in-progress rows go
  to `leads-inprogress.jsonl` and are promoted on sweep completion; the old
  snapshot moves to `output/archive/`)
- `output/run.json`, `output/scrape-progress.json`,
  `output/failed-industries.json`, `output/review_sample.json`,
  `output/process_documentation.txt`

## Loading

Loading into `ds_hiring_cafe` is a separate ops step run by the dataset owner
(`load-to-supabase.ts`, upserts on `primary_key`). Agents must not run the
loader — see AGENTS.md.
