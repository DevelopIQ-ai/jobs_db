# NYC DOB BIS Scraper (Legacy System)

Scrapes property owner information from NYC Department of Buildings Building Information System (BIS) - the legacy permit system.

## Usage

```bash
npm install
npx tsx scraper.ts
npx tsx scraper.ts --borough 1  # Manhattan only
```

Borough codes: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island

## Output

```
output/
  leads.jsonl    # One JSON record per line
  run.json       # Run metadata
```

## Data Format

```json
{
  "core": {
    "source_id": "real_estate/nyc_dob_bis",
    "entity_type": "company",
    "scraped_at": "2026-01-30T13:59:00.000Z",
    "raw_url": "https://a810-bisweb.nyc.gov/bisweb/PropertyBrowseByBINServlet?allbin=1090447",
    "primary_key": "real_estate/nyc_dob_bis:job:121332673"
  },
  "company": {
    "company_name": "W29 534 HIGHLINE OWNERS, LLC",
    "location": { "city": "NEW YORK", "state": "NY", "zip": "10022", "country": "USA" }
  },
  "contact": {
    "phone": "2127582089"
  },
  "context": {
    "job_number": "121332673",
    "job_type": "NB",
    "permit_status": "ISSUED",
    "property_address": "534 WEST 29TH STREET 10001",
    "borough": "Manhattan",
    "neighborhood": "Chelsea"
  }
}
```

## Stats

- ~42,000 permit records
- Refresh: weekly
- Data source: NYC DOB BIS web scraper

## Notes

This scraper uses the legacy BIS system. For newer permits filed through DOB NOW, see the DOB NOW scraper in `industries_in_progress/real_estate/nyc-dob-scraper/`.
