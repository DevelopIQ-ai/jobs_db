# NYC DOB Permit Owners Scraper

Scrapes property owner information from NYC Department of Buildings permit data via NYC Open Data and BIS (Building Information System).

## Usage

```bash
# Install dependencies
npm install

# Full scrape
npx tsx scraper.ts

# Scrape specific borough (1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island)
npx tsx scraper.ts --borough 1
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
    "source_id": "real_estate/nyc_dob",
    "entity_type": "person",
    "scraped_at": "2026-01-30T18:59:25.569Z",
    "raw_url": "https://a810-bisweb.nyc.gov/bisweb/PropertyBrowseByBINServlet?allbin=3102988",
    "primary_key": "real_estate/nyc_dob:job:B01309817-I1"
  },
  "person": {
    "full_name": "MAUREEN BROWN",
    "company_name": "PR"
  },
  "contact": {
    "location": { "city": "New York", "state": "NY", "zip": "11203", "country": "USA" }
  },
  "context": {
    "job_filing_number": "B01309817-I1",
    "work_type": "General Construction",
    "job_description": "Minor fire damaged restoration",
    "permit_status": "Permit Issued",
    "estimated_cost": "130049",
    "property_address": "298 EAST 54 STREET 11203",
    "borough": "Brooklyn",
    "block": "4701",
    "lot": "21",
    "bin": "3102988",
    "neighborhood": "East Flatbush-Rugby",
    "approved_date": "2026-01-28T00:00:00.000",
    "applicant_name": "DAVID SCHUBERG",
    "applicant_business": "5 BORO BOARDING INC"
  }
}
```

## Stats

- ~54,000 permit records
- Refresh: weekly (new permits issued daily)
- Data sources: NYC Open Data API + BIS web scraping

## Migration Reflection

### Was it straightforward?

Moderately complex - combines multiple data sources with different formats.

### Challenges

1. **Multiple data sources**: NYC Open Data (API) vs BIS (web scraping) - had to merge results.

2. **Owner identification**: Some records have business name, others have person name. Used business name when >2 chars and not "PR" (which means Private Residence).

3. **No direct profile URL**: NYC DOB doesn't have stable URLs per permit. Constructed BIS lookup URL from BIN or BBL.

4. **Entity type determination**: Owner could be company or person - dynamic based on available data.

### What I kept

- Multi-source data merging
- Borough-by-borough processing

### What I changed

- Output format: JSON → JSONL
- Simplified owner extraction logic
- Added proper entity_type detection
