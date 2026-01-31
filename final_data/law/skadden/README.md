# Skadden Professionals Scraper

Scrapes lawyer profiles from [Skadden, Arps, Slate, Meagher & Flom LLP](https://www.skadden.com/professionals).

## Usage

```bash
# Install dependencies
npm install

# Full scrape (resumes from last checkpoint)
npx tsx scraper.ts

# Test mode (3 profiles only)
npx tsx scraper.ts --test
```

## Output

```
output/
  leads.jsonl          # One JSON record per line
  run.json             # Run metadata
  scrape-progress.json # Checkpoint for resuming
```

## Data Format

Each record in `leads.jsonl` follows the ScrappyPuffle data contract:

```json
{
  "core": {
    "source_id": "law/skadden",
    "entity_type": "person",
    "scraped_at": "2026-01-30T03:52:42.362Z",
    "raw_url": "https://www.skadden.com/professionals/a/adams-nicholas",
    "primary_key": "law/skadden:url:a/adams-nicholas"
  },
  "person": {
    "full_name": "Nicholas Adams",
    "title": "Partner",
    "company_name": "Skadden, Arps, Slate, Meagher & Flom LLP",
    "profile_url": "https://www.skadden.com/professionals/a/adams-nicholas"
  },
  "contact": {
    "email": "nicholas.adams@skadden.com",
    "phone": "442075197286",
    "website": "https://www.skadden.com",
    "location": { "city": "London", "country": "UK" }
  },
  "context": {
    "offices": ["London"],
    "practice_areas": ["Litigation", "International Litigation and Arbitration"],
    "education": [{ "degree": "J.D.", "school": "Harvard", "year": "2008" }],
    "bar_admissions": [],
    "biography": "..."
  }
}
```

## Stats

- ~1,800+ lawyer profiles
- Refresh: monthly
- Rate limit: 1 req/sec

## Notes

- Cookie consent dialog is auto-dismissed
- Scraper paginates A-Z directories
- Progress is saved every 10 profiles for crash recovery

## Migration Reflection

### Was it straightforward?

Mostly yes. The original scraper was well-written with clean extraction logic. The main work was reshaping the output format, not fixing broken scraping.

### Challenges

1. **Flat → nested structure**: The original `LawyerProfile` interface dumped everything at the top level. Had to decide what belongs in `core`, `person`, `contact`, vs `context`. Rule of thumb: if it's standardized across all scrapers, it goes in the fixed sections. Everything source-specific goes in `context`.

2. **Garbage in title field**: The scraper was extracting "Home" as the title for some profiles (from the page's navigation). Added `cleanTitle()` to filter these out.

3. **Location mapping**: Original data had office names like "London", "Tokyo". Needed to map these to `{city, country}` format. Created `INTERNATIONAL_OFFICES` lookup for non-US offices, defaulted others to USA.

4. **Primary key strategy**: Original had no dedupe key. Used URL path (`a/adams-nicholas`) since it's stable and unique. Format: `law/skadden:url:a/adams-nicholas`.

5. **JSON vs JSONL**: Original wrote a single JSON array. Changed to streaming JSONL writes so we don't lose all data on crash.

### What I kept

- All the scraping logic (pagination, cookie dismissal, field extraction)
- The progress/checkpoint system
- Rate limiting

### What I changed

- Output format: `skadden-lawyers.json` → `leads.jsonl` + `run.json`
- Added `--test` flag for quick validation runs
- Added `convertToLeadRecord()` to transform raw profiles to contract format
