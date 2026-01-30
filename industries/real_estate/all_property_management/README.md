# AllPropertyManagement.com Scraper

Scrapes all property managers from [AllPropertyManagement.com](https://www.allpropertymanagement.com) via their public API.

## Usage

```bash
# Scrape all managers
npx tsx scraper.ts

# Filter by property type
npx tsx scraper.ts --type multifamily
npx tsx scraper.ts --type commercial
npx tsx scraper.ts --type hoa
npx tsx scraper.ts --type single-family
npx tsx scraper.ts --type vacation

# Test mode (first 10 managers only)
npx tsx scraper.ts --test

# Combine flags
npx tsx scraper.ts --type multifamily --test
```

## Available Filters

| Filter | Description |
|--------|-------------|
| `all` | All property managers (default) |
| `multifamily` | Multi-family properties (2-4, 5-19, 20-99, 100+ units) |
| `single-family` | Single homes and condos |
| `commercial` | Office, retail, manufacturing, warehouse |
| `hoa` | Homeowner and condo associations |
| `vacation` | Vacation rentals |

## Output

Results are saved to `output/`:

- `property-managers-{filter}-{date}.json` - Full data with metadata
- `property-managers-{filter}-{date}.csv` - Spreadsheet-friendly format

## Data Extracted

| Field | Description |
|-------|-------------|
| `id` | Unique manager ID |
| `name` | Company name |
| `street`, `city`, `state`, `zip` | Primary address |
| `additionalOffices` | Secondary office locations |
| `email` | Contact email |
| `tagline` | Short company description |
| `htmlProfile` | Full HTML biography |
| `logoUrl` | Company logo URL |
| `propertyTypes` | List of property types managed (with category) |
| `isFeatured` | Whether featured on the site |
| `scrapedAt` | Timestamp when scraped |

## API Details

The scraper uses the public API at `https://api.allpropertymanagement.com/public/v1/`.

- Total managers: ~2,700
- Rate limiting: Built-in with retry logic
- Batch processing: 20 concurrent requests

## Sample Output

```json
{
  "id": 875,
  "name": "Cervelli Property Management",
  "street": "1 Marine Plaza, Suite 304",
  "city": "North Bergen",
  "state": "NJ",
  "zip": "07047",
  "email": "james@realestatenj.com",
  "propertyTypes": [
    { "id": 50, "name": "Multi-Family (2-4 units)", "category": "multifamily" },
    { "id": 51, "name": "Multi-Family (5-19 units)", "category": "multifamily" }
  ],
  "scrapedAt": "2026-01-29T22:34:54.378Z"
}
```
