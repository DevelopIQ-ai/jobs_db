# NYC DOB BIS Scraper

Scrapes New Building permit applications from NYC Department of Buildings Building Information System (BIS) to extract developer/owner information.

## Data Extracted

For each New Building permit, extracts:

### Owner/Developer Info (Section 26)
- Owner Name (contact person)
- Owner Relationship (Manager, Partner, Principal, etc.)
- Owner Business Name (LLC, Corp, etc.)
- Owner Phone
- Owner Address
- Owner Type (Partnership, Corporation, etc.)

### Property Info
- Job Number
- Address
- Borough, Block, Lot, BIN
- Zip Code
- Community Board

### Additional Contacts
- Applicant (architect/engineer): Name, firm, phone, email
- Filing Representative (expediter): Name, firm, phone, email

### Job Info
- File Date
- Job Status
- Estimated Cost
- Building Type

## Usage

```bash
# Install dependencies
npm install

# Run scraper (defaults to Manhattan, 2024)
npx tsx scraper.ts

# Scrape specific borough
npx tsx scraper.ts --borough 1    # Manhattan
npx tsx scraper.ts --borough 2    # Bronx
npx tsx scraper.ts --borough 3    # Brooklyn
npx tsx scraper.ts --borough 4    # Queens
npx tsx scraper.ts --borough 5    # Staten Island

# Specify date range
npx tsx scraper.ts --borough 3 --start-year 2023 --end-year 2024

# Resume interrupted scrape
npx tsx scraper.ts --resume

# Use npm scripts
npm run scrape:manhattan
npm run scrape:brooklyn
```

## Borough Codes

| Code | Borough |
|------|---------|
| 1 | Manhattan |
| 2 | Bronx |
| 3 | Brooklyn |
| 4 | Queens |
| 5 | Staten Island |

## Output

Files saved to `output/` directory:

- `nyc-developers-{borough}-{date}.json` - Full JSON with all fields
- `nyc-developers-{borough}-{date}.csv` - CSV for spreadsheet import
- `scrape-progress.json` - Progress file for resuming

## Notes

- The scraper uses Playwright with a visible browser window
- Rate limited to ~1-2 seconds between requests
- Takes longer breaks every 50 jobs
- Progress is saved after each job (can resume if interrupted)
- Only extracts jobs that have Owner's Information in Section 26

## Data Source

NYC Department of Buildings - Building Information System (BIS)
https://a810-bisweb.nyc.gov/bisweb
