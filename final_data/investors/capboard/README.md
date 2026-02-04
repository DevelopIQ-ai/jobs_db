# Capboard Investors Scraper

Scrapes investor profiles from [Capboard.io](https://www.capboard.io/en/investors).

## Usage

```bash
# Install dependencies
npm install

# Full scrape (resumes from checkpoint)
npx tsx scraper.ts
```

## Output

```
output/
  leads.jsonl          # One JSON record per line
  run.json             # Run metadata
  scrape-progress.json # Checkpoint for resuming
```

## Data Format

```json
{
  "core": {
    "source_id": "investors/capboard",
    "entity_type": "company",
    "scraped_at": "2026-01-30T08:41:14.423Z",
    "raw_url": "https://www.capboard.io/en/investor/black-pearls-vc",
    "primary_key": "investors/capboard:slug:black-pearls-vc"
  },
  "company": {
    "company_name": "Black Pearls VC",
    "domain": "blackpearls.vc",
    "industry": "VC",
    "website": "https://blackpearls.vc"
  },
  "contact": {
    "socials": [
      { "platform": "linkedin", "url": "https://www.linkedin.com/company/black-pearls-vc/" }
    ]
  },
  "context": {
    "check_size_raw": "100K - 1M",
    "investment_stages": ["Seed", "Series A"],
    "interests": ["SaaS", "Enterprise", "Machine Learning"],
    "firm_type": "VC",
    "operating_countries": ["Germany", "Austria"]
  }
}
```

## Stats

- ~1,400 investor profiles
- Refresh: monthly
- Rate limit: 2.5 sec/profile

## Migration Reflection

### Was it straightforward?

Yes. Capboard has paginated list pages and individual profile pages, which is a standard pattern.

### Challenges

1. **Cookie consent**: Had to handle Capboard's cookie banner which blocks page content.

2. **Website extraction**: Many profiles have Google Privacy URL instead of actual firm website - had to filter these out.

3. **Check size parsing**: Format varies (100K - 1M, $1M+, etc.) - stored raw string plus parsed min/max.

### What I kept

- Paginated scraping logic
- Browser restart every 100 profiles (memory management)
- Progress/checkpoint system

### What I changed

- Output format: JSON → JSONL
- Added proper domain extraction
