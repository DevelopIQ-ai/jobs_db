# AllPropertyManagement.com Scraper

Scrapes property management company profiles from [AllPropertyManagement.com](https://www.allpropertymanagement.com).

## Usage

```bash
# Install dependencies
npm install

# Full scrape
npx tsx scraper.ts

# Filter by property type
npx tsx scraper.ts --type multifamily
npx tsx scraper.ts --type commercial
npx tsx scraper.ts --type hoa

# Test mode (first 10 managers only)
npx tsx scraper.ts --test
```

## Output

```
output/
  leads.jsonl          # One JSON record per line
  run.json             # Run metadata
```

## Data Format

```json
{
  "core": {
    "source_id": "real_estate/all_property_management",
    "entity_type": "company",
    "scraped_at": "2026-01-30T01:30:28.213Z",
    "raw_url": "https://www.allpropertymanagement.com/property-managers/195",
    "primary_key": "real_estate/all_property_management:id:195"
  },
  "company": {
    "company_name": "Great North Property Management",
    "domain": "greatnorth.net"
  },
  "contact": {
    "email": "justin.gargiulo@greatnorth.net",
    "phone": "(800) 639-7309",
    "website": "https://greatnorth.net",
    "location": { "city": "Exeter", "state": "NH", "zip": "03833", "country": "USA" }
  },
  "context": {
    "street": "3 Holland Way",
    "contact_name": "Justin Gargiulo",
    "tagline": "Locally Owned and Locally Controlled. A Family Company!",
    "property_types": "Office; Homeowners Association; Condominium Association",
    "property_type_categories": "commercial; hoa",
    "is_featured": false
  }
}
```

## Stats

- ~2,700 property management companies
- Refresh: monthly
- Data source: Public API

## Migration Reflection

### Was it straightforward?

Yes - AllPropertyManagement has a public API that returns structured JSON.

### Challenges

1. **CSV source data**: Original output was enriched CSV with website metadata. Had to parse CSV and convert to JSONL.

2. **Domain extraction**: Website URLs needed to be parsed to extract domain for the company record.

3. **Contact info**: Primary contact name was split across multiple fields (first, last, full).

### What I kept

- API-based data fetching
- Enrichment with website metadata

### What I changed

- Output format: CSV → JSONL
- Simplified property type handling
