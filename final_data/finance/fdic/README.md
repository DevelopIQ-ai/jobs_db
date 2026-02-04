# FDIC Active Banks Scraper

Fetches all FDIC-insured active banks from the [FDIC API](https://api.fdic.gov/).

## Usage

```bash
# Install dependencies
npm install

# Run scraper
npx tsx scraper.ts
```

## Output

```
output/
  leads.jsonl    # One JSON record per line
  run.json       # Run metadata
```

## Data Format

Each record in `leads.jsonl` follows the ScrappyPuffle data contract:

```json
{
  "core": {
    "source_id": "finance/fdic",
    "entity_type": "company",
    "scraped_at": "2026-01-30T22:52:40.390Z",
    "raw_url": "https://api.fdic.gov/banks/institutions",
    "primary_key": "finance/fdic:cert:628"
  },
  "company": {
    "company_name": "JPMorgan Chase Bank, National Association",
    "domain": "jpmorganchase.com",
    "website": "https://www.jpmorganchase.com",
    "location": { "city": "Columbus", "state": "OH", "zip": "43240", "country": "USA" }
  },
  "contact": {},
  "context": {
    "cert": 628,
    "total_assets_thousands": 3813431000,
    "total_assets_formatted": "$3813.43B",
    "employee_count": 226927,
    "bank_class": "N",
    "established": "01/01/1824"
  }
}
```

## Stats

- ~4,300+ FDIC-insured banks
- Refresh: monthly
- Data source: FDIC public API

## Migration Reflection

### Was it straightforward?

Yes. The original scraper was clean and used the FDIC's public API, which returns structured JSON. The main work was reshaping the flat `BankRecord` interface into the nested contract format.

### Challenges

1. **Primary key selection**: FDIC provides a stable `CERT` number for each bank - perfect for `primary_key`. Format: `finance/fdic:cert:628`.

2. **Domain extraction**: Original had raw website URLs. Added `extractDomain()` to normalize URLs into domain-only format for `company.domain`.

3. **Assets in thousands**: FDIC reports assets in thousands. Preserved both raw value (`total_assets_thousands`) and formatted string (`$3813.43B`) in context.

### What I kept

- API fetching logic with pagination and retry
- Financial data merging (institutions + financials)
- Asset formatting

### What I changed

- Output: CSV → JSONL + run.json
- Structure: flat → core/company/contact/context
- Added domain extraction from website URLs
