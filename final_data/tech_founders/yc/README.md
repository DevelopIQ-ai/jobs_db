# Y Combinator Founders Scraper

Scrapes founder profiles from [Y Combinator](https://www.ycombinator.com/companies).

## Usage

```bash
# Install dependencies
npm install

# Full scrape (resumes from checkpoint)
npx tsx scraper.ts

# Test mode (10 companies only)
npx tsx scraper.ts --test
```

## Output

```
output/
  leads.jsonl          # One JSON record per line (founders)
  run.json             # Run metadata
  scrape-progress.json # Checkpoint for resuming
```

## Data Format

Each record in `leads.jsonl` follows the ScrappyPuffle data contract:

```json
{
  "core": {
    "source_id": "tech_founders/yc",
    "entity_type": "person",
    "scraped_at": "2026-01-30T11:49:25.460Z",
    "raw_url": "https://www.ycombinator.com/companies/doordash",
    "primary_key": "tech_founders/yc:founder:doordash:tony-xu"
  },
  "person": {
    "full_name": "Tony Xu",
    "title": "CEO",
    "company_name": "DoorDash",
    "profile_url": "https://www.ycombinator.com/companies/doordash"
  },
  "contact": {
    "website": "https://doordash.com",
    "socials": [
      { "platform": "linkedin", "url": "https://linkedin.com/in/tonyxu" }
    ],
    "location": { "city": "San Francisco", "state": "CA", "country": "USA" }
  },
  "context": {
    "yc_batch": "S13",
    "company_status": "Public",
    "company_one_liner": "On-demand food delivery",
    "company_industries": ["Consumer", "Marketplace"]
  }
}
```

## Stats

- ~11,000+ founder profiles across ~3,000+ companies
- Refresh: monthly
- Rate limit: 2.5 sec/company page

## Migration Reflection

### Was it straightforward?

Mostly yes. The YC directory uses infinite scroll which required scrolling through each batch separately (Summer 2024, Winter 2024, etc.) to collect all companies.

### Challenges

1. **Founders as primary entity**: The source data is company-centric, but the contract requires one entity per record. Since we want founder leads, each company with N founders produces N records.

2. **Primary key for founders**: Used `{company_slug}:{normalized_founder_name}` to ensure uniqueness even if two founders share a name across different companies.

3. **Location parsing**: YC displays location as "San Francisco, CA" or "London" - needed to handle both US (city, state) and international formats.

4. **Failed URLs**: About 2,000 company pages couldn't be scraped (blocked or broken). These are tracked in progress but the scraper still outputs 11,000+ valid founder records.

### What I kept

- Batch-by-batch scrolling strategy
- Progress/checkpoint system
- Rate limiting

### What I changed

- Output format: JSON array → JSONL (one founder per line)
- Added `--test` flag for validation runs
- Entity: company → person (founders)
