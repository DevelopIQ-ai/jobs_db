# ICSC Member Directory Scraper

Scrapes Owner/Developer member profiles from [ICSC](https://www.icsc.com/search) (International Council of Shopping Centers).

## Usage

```bash
# Install dependencies
npm install

# Full scrape (resumes from checkpoint)
npx tsx scraper.ts
```

**Note:** Requires ICSC membership login credentials in the scraper.

## Output

```
output/
  leads.jsonl               # One JSON record per line
  run.json                  # Run metadata
  full-scrape-progress.json # Checkpoint for resuming
```

## Data Format

```json
{
  "core": {
    "source_id": "real_estate/icsc",
    "entity_type": "person",
    "scraped_at": "2026-01-30T06:54:36.271Z",
    "raw_url": "https://www.icsc.com/member/profile/852078",
    "primary_key": "real_estate/icsc:profile:852078"
  },
  "person": {
    "full_name": "Andrea Aquadro",
    "title": "Principal",
    "company_name": "Wilson Dam Properties",
    "profile_url": "https://www.icsc.com/member/profile/852078"
  },
  "contact": {
    "email": "andrea@example.com",
    "phone": "555-123-4567",
    "location": { "city": "Birmingham", "state": "Alabama", "country": "USA" }
  },
  "context": {
    "business_type": "Owner/Developer",
    "state": "Alabama"
  }
}
```

## Stats

- ~10,000+ Owner/Developer members
- Refresh: monthly
- Rate limit: 2-4 sec between pages

## Migration Reflection

### Was it straightforward?

No - this was the most complex scraper due to ICSC's search limitations.

### Challenges

1. **1000 result limit**: ICSC caps search results at 1000. Solution: filter by state to get all results in smaller batches.

2. **Authentication required**: Must log in with valid ICSC membership.

3. **Rate limiting & bot detection**: Added random delays, mouse movements, and browser restarts to avoid blocks.

4. **State-by-state scraping**: Iterate through all 50 states + DC + Puerto Rico + Canada + International to capture all members.

5. **Deduplication**: Same member can appear in multiple state searches - dedupe by profile URL.

### What I kept

- Login flow
- State-by-state iteration strategy
- Human-like behavior (random delays, mouse moves)

### What I changed

- Output format: JSON → JSONL
- Simplified data extraction (removed profile detail scraping due to rate limits)
