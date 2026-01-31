# NCUA Credit Unions Scraper

Parses NCUA Call Report data to extract all federally-insured credit unions.

## Prerequisites

Download the quarterly Call Report data from [NCUA](https://ncua.gov/analysis/credit-union-corporate-call-report-data) and extract to `extracted/` folder:

```
extracted/
  FOICU.txt      # Credit union info
  FS220.txt      # Financial data (assets, members)
  FS220A.txt     # Employee counts
```

## Usage

```bash
# Install dependencies
npm install

# Run scraper (requires extracted data files)
npx tsx scraper.ts
```

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
    "source_id": "finance/ncua",
    "entity_type": "company",
    "scraped_at": "2026-01-30T22:52:42.800Z",
    "raw_url": "https://ncua.gov/analysis/credit-union-corporate-call-report-data",
    "primary_key": "finance/ncua:cu_number:5536"
  },
  "company": {
    "company_name": "NAVY FEDERAL CREDIT UNION"
  },
  "contact": {
    "location": { "city": "VIENNA", "state": "VA", "zip": "22180", "country": "USA" }
  },
  "context": {
    "cu_number": 5536,
    "total_assets": 194179276274,
    "member_count": 14998804,
    "total_employees": 25114,
    "year_opened": 1947,
    "peer_group": 6
  }
}
```

## Stats

- ~4,400+ credit unions
- Refresh: quarterly (when NCUA publishes new data)
- Data source: NCUA Call Report files

## Migration Reflection

### Was it straightforward?

Mostly. The scraper reads from extracted text files (CSV-like format), not a live API. The parsing logic was already solid.

### Challenges

1. **Primary key selection**: NCUA provides `CU_NUMBER` as a stable identifier. Format: `finance/ncua:cu_number:5536`.

2. **Multi-file joins**: Data comes from 3 files (FOICU, FS220, FS220A) that need to be joined on CU_NUMBER. Original handled this well.

3. **No website/domain**: Unlike FDIC banks, credit unions don't have website URLs in this dataset. `contact.website` is omitted.

### What I kept

- CSV parsing logic for the NCUA text files
- Multi-file data merging
- Asset and employee aggregation

### What I changed

- Output: CSV → JSONL + run.json
- Structure: flat → core/company/contact/context
- Removed formatted asset string from company (kept in context)
