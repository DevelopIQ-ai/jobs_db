# OpenVC Investor Database

Scrapes investor data from [openvc.app/search](https://www.openvc.app/search).

## Source Details

- **URL**: https://www.openvc.app/search
- **Entity type**: company (investment firms/funds)
- **Volume**: ~10,400 unique investors (16,541 raw with overlapping pages)
- **Pages**: 828 pages, 20 investors per page
- **Auth**: None required

## Approach

Uses Playwright (visible mode) to bypass Cloudflare protection, then parses the server-side rendered HTML with cheerio. Direct HTTP requests return 403 due to Cloudflare, and headless mode triggers unsolvable JS challenges on pages 2+.

## Data Fields

- Company name, profile URL
- Investor type (VC firm, PE fund, Accelerator, Angel network, etc.)
- Countries of operation
- Check size range
- Investment stages
- Investment thesis

## Run

```bash
npx tsx scraper.ts
```

Supports resume via `output/scrape-progress.json`. Takes ~38 minutes for a full run.
