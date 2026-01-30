# Skadden Law Firm Professionals Scraper

Scrapes all lawyer profiles from [https://www.skadden.com/professionals](https://www.skadden.com/professionals).

## Prerequisites

- Node.js 18+
- Playwright installed (`npm install` from project root will install it)

## Usage

### Quick Test (5 profiles)

```bash
npx tsx test-suite/law/skadden-scraper/test-scraper.ts
```

This will scrape 5 profiles from letter "A" to verify the scraper works.

### Full Scrape (all 1700+ lawyers)

```bash
npx tsx test-suite/law/skadden-scraper/skadden-scraper.ts
```

**Note:** A full scrape will take several hours due to rate limiting (1 second between profiles).

## Output

Results are saved to `test-suite/law/skadden-scraper/output/`:

- `test-results.json` - Test run output (5 profiles)
- `skadden-lawyers.json` - Full scrape output
- `scrape-progress.json` - Progress file (allows resuming interrupted scrapes)

## Data Extracted

For each lawyer, the scraper extracts:

| Field | Description |
|-------|-------------|
| `name` | Full name |
| `profileUrl` | URL to their profile page |
| `photoUrl` | URL to their profile photo |
| `email` | Email address |
| `phone` | Primary phone number |
| `secondaryPhone` | Secondary phone (if available) |
| `offices` | List of office locations |
| `practiceAreas` | List of practice areas |
| `industries` | List of industries |
| `education` | Education history (degree, school, year, honors) |
| `barAdmissions` | Bar admissions |
| `courtAdmissions` | Court admissions |
| `affiliations` | Professional affiliations |
| `languages` | Languages spoken |
| `clerkships` | Clerkship history |
| `biography` | Full biography text |
| `rankings` | Awards and rankings |
| `scrapedAt` | Timestamp when scraped |

## Sample Output

```json
{
  "name": "Nicholas Adams",
  "profileUrl": "https://www.skadden.com/professionals/a/adams-nicholas",
  "photoUrl": "https://www.skadden.com/-/media/images/professionals/a/adams-nicholas/detail/adams_nick_1440x600.jpg",
  "email": "nicholas.adams@skadden.com",
  "phone": "442075197286",
  "offices": ["London"],
  "practiceAreas": ["Litigation", "International Litigation and Arbitration"],
  "education": ["LL.B., University of Oxford, 2007", "B.A., University College London, 2004"],
  "biography": "Mr. Adams has extensive experience working on prominent matters...",
  "scrapedAt": "2026-01-29T22:11:37.217Z"
}
```

## Resuming Interrupted Scrapes

The scraper saves progress to `scrape-progress.json`. If interrupted, simply run the scraper again and it will resume from where it left off.

## Rate Limiting

The scraper includes built-in rate limiting:
- 1 second delay between profile pages
- 2 seconds delay between letter pages

This is to be respectful to the server and avoid getting blocked.
