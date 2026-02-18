# SEC EDGAR Real Estate Companies

Scrapes SEC EDGAR for public companies classified under real estate and building contractor SIC codes.

## Data Source

- **SEC EDGAR browse-edgar Atom feed**: Lists companies by SIC code with CIK, name, state
- **SEC EDGAR submissions API**: Full company details including address, phone, tickers, filing history

## SIC Codes Covered

| Code | Description |
|------|-------------|
| 6500 | Real Estate |
| 6510 | Real Estate Operators (No Developers) & Lessors |
| 6512 | Operators of Apartment Buildings |
| 6513 | Operators of Real Estate NEC |
| 6519 | Real Property Lessors, NEC |
| 6531 | Real Estate Agents and Managers |
| 6532 | Real Estate Dealers (for Their Own Account) |
| 6552 | Land Subdividers & Developers (No Cemeteries) |
| 6798 | Real Estate Investment Trusts |
| 1520 | General Building Contractors - Residential |
| 1521 | General Contractors - Residential Buildings |
| 1522 | General Contractors - Residential, Other |
| 1531 | Operative Builders |
| 1540 | General Building Contractors - Nonresidential |
| 1541 | General Contractors - Industrial & Commercial |
| 1542 | General Contractors - Nonresidential, Other |

## Rate Limiting

SEC EDGAR requires a User-Agent header and limits to 10 requests/second. This scraper targets ~8 req/sec.

## Expected Volume

~2,000-6,000 unique companies across all SIC codes.

## Resumability

The scraper saves progress to `output/scrape-progress.json` and can resume from where it left off.
