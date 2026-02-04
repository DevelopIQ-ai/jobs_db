AGENTS.md

Instructions for AI Agents Working in This Repository

This file defines the required behavior for any AI agent that:
	•	creates scrapers
	•	modifies scrapers
	•	adds data sources
	•	fixes failing sources
	•	participates in the ingestion pipeline

Failure to follow these rules means the output must be rejected.

⸻

1. Your Role (Read This First)

Your job is to:
	•	take a website or dataset
	•	extract structured data
	•	emit records that conform to DATA-RULES.md
	•	fix issues when the pipeline rejects your output

⸻

2. Project Structure

```
scrappypuffle/
├── AGENTS.md              # This file - instructions for AI agents
├── DATA-RULES.md          # Data contract and schema rules
├── CLAUDE.md              # Entry point for Claude Code
├── lib/
│   └── source-config.ts   # Shared utility (ALL scrapers must use this)
├── template/              # Reference implementation - copy this for new scrapers
│   ├── source.yaml
│   ├── scraper.ts
│   └── output/
├── data_in_progress/      # Work in progress scrapers (not yet approved)
│   └── <industry>/
│       └── <source_name>/
│           ├── source.yaml
│           ├── scraper.ts
│           ├── output/
│           └── README.md
├── final_data/            # Approved, production-ready scrapers
│   └── <industry>/
│       └── <source_name>/
│           ├── source.yaml
│           ├── scraper.ts
│           └── output/
└── validator/
    └── validate-scraper-output.ts  # Validation script
```

Key points:
- New scrapers go in `data_in_progress/`
- After human approval, scrapers move to `final_data/`
- All scrapers are 3 levels deep from root (e.g., `final_data/finance/fdic/`)

⸻

3. High-Level Flow (You Must Follow This Order)

When given a new site or source, you must follow this exact sequence:
	1.	Create a new Source Package
	2.	Write a scraper that outputs valid JSONL
	3.	Run the scraper
	4.	Fix errors until the Quality Gate passes
	5.	Produce a small review sample
	6.	Stop and wait for approval

You may NOT skip steps.

⸻

4. Step 1: Create a Source Package

When a new site is provided, you must create a folder with this structure:

```
data_in_progress/<industry>/<source_name>/
  source.yaml
  scraper.ts
  output/
  README.md
```

Naming conventions:
	•	`<industry>` and `<source_name>` must be lowercase with underscores (e.g., `real_estate`, `nyc_dob`)
	•	No spaces, hyphens, or special characters

source.yaml (complete example)

```yaml
source_id: "finance/example_bank"
display_name: "Example Bank Directory"
entity_type: "company"
data_as_of: "2024-01-15"
start_urls:
  - "https://example.com/banks"
run_command: "npx tsx scraper.ts"
refresh: "monthly"
primary_key_strategy:
  type: "stable_id"
  stable_id_context_path:
    - "context"
    - "bank_id"
expected_volume_range:
  min: 100
  max: 10000
notes: "Rate limited to 1 request per second"
```

source.yaml required fields:
	•	source_id - globally unique, format: `<industry>/<source_name>`
	•	display_name - human-readable name
	•	entity_type - "person", "company", or "both"
	•	data_as_of - ISO date (YYYY-MM-DD) when data was scraped
	•	start_urls - list of entry point URLs
	•	run_command - how to execute the scraper
	•	refresh - "daily", "weekly", "monthly", "quarterly", or "yearly"
	•	primary_key_strategy - see below
	•	expected_volume_range - { min, max } expected record count

primary_key_strategy options:

```yaml
# Option 1: stable_id - Use when source has unique IDs
primary_key_strategy:
  type: "stable_id"
  stable_id_context_path:
    - "context"
    - "cert"  # Path to the ID field in your record

# Option 2: url - Use when profile URLs are stable
primary_key_strategy:
  type: "url"
  canonical_url_field: "core.raw_url"

# Option 3: fingerprint - Use when no stable ID exists
primary_key_strategy:
  type: "fingerprint"
  fingerprint_fields:
    - "person.full_name"
    - "person.location.city"
    - "person.location.state"

# Option 4: url_fingerprint - URL + hash for disambiguation
primary_key_strategy:
  type: "url_fingerprint"
  fingerprint_fields:
    - "person.full_name"
```

⸻

5. Step 2: Write the Scraper

Scraper responsibilities

The scraper is responsible ONLY for:
	•	fetching pages
	•	extracting data
	•	mapping extracted data to the contract in DATA-RULES.md
	•	writing output files

The scraper must NOT:
	•	generate UUIDs
	•	dedupe across runs
	•	perform database logic
	•	guess missing information
	•	hardcode source_id, entity_type, or other config values

Scraping approach priority (use the simplest approach that works):
	1.	**Direct HTTP requests** (fetch/axios) - Always try this first
	2.	**API endpoints** - Check for JSON APIs the site uses internally
	3.	**Innovate** - Find creative solutions (cached data, sitemaps, RSS feeds, etc.)
	4.	**Playwright/browser automation** - WORST CASE ONLY

Use Playwright only when:
	•	The site requires JavaScript rendering with no API alternative
	•	Authentication requires browser interaction
	•	Content is loaded dynamically with no fetchable endpoint

Browser automation is slower, more fragile, and harder to maintain. Exhaust simpler options first.

Using lib/source-config.ts (Required)

Every scraper MUST use the shared utility to read configuration.

IMPORTANT: Scrapers are 3 levels deep, so the import path is `../../../lib/source-config`:

```typescript
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);
```

This ensures:
	•	source.yaml is the single source of truth
	•	No hardcoded values that can drift out of sync
	•	data_as_of is automatically updated after successful runs

Minimal Working Scraper Example

```typescript
import * as fs from "fs";
import {
  loadSourceConfig,
  updateDataAsOf,
  getOutputPaths,
  ensureOutputDir,
  generatePrimaryKey,
} from "../../../lib/source-config";

// Load config from source.yaml
const config = loadSourceConfig(__dirname);
const paths = getOutputPaths(__dirname);

interface LeadRecord {
  core: {
    source_id: string;
    entity_type: "person" | "company";
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  company?: { company_name: string };
  person?: { full_name: string };
  contact: Record<string, unknown>;
  context: Record<string, unknown>;
}

async function main() {
  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  console.log(`=== ${config.display_name} Scraper ===`);

  // Ensure output directory exists
  ensureOutputDir(__dirname);

  // TODO: Your scraping logic here
  const records: LeadRecord[] = [];

  // Example record (replace with actual scraped data)
  // const rawUrl = "https://example.com/item/123";
  // const record = {
  //   core: {
  //     source_id: config.source_id,
  //     entity_type: "company",
  //     scraped_at: startTime,
  //     raw_url: rawUrl,
  //     primary_key: "", // Will be set below
  //   },
  //   company: { company_name: "Example Corp", location: { city: "New York", state: "NY" } },
  //   contact: {},
  //   context: { id: "123" }, // Include field needed for primary key
  // };
  // record.core.primary_key = generatePrimaryKey(config, record, rawUrl);
  // records.push(record);

  // Write leads.jsonl
  const jsonlContent = records.map(r => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(paths.leadsFile, jsonlContent);

  // Write run.json
  const endTime = new Date().toISOString();
  const runJson = {
    source_id: config.source_id,
    run_id: runId,
    started_at: startTime,
    ended_at: endTime,
    records_found: records.length,
    records_valid: records.length,
    records_written: records.length,
    error_count: 0,
    errors: [],  // Only populate with unrecoverable errors
  };
  fs.writeFileSync(paths.runFile, JSON.stringify(runJson, null, 2));

  // Update data_as_of in source.yaml
  updateDataAsOf(__dirname);

  console.log(`Done! Wrote ${records.length} records to ${paths.leadsFile}`);
}

main().catch(console.error);
```

⸻

6. Output Rules (Hard Requirement)

The scraper must write the following files:

```
output/
  leads.jsonl              // REQUIRED
  run.json                 // REQUIRED
  scrape-progress.json     // OPTIONAL (for resumable scrapes)
  process_documentation.txt // OPTIONAL (debugging journal)
```

Error handling behavior:
	•	When you encounter errors (404s, rate limits, parse failures), try to fix the scraper
	•	Document each attempt and outcome in process_documentation.txt
	•	Only log truly unrecoverable errors to run.json after exhausting options
	•	See DATA-RULES.md for the detailed error format in run.json

leads.jsonl rules:
	•	One JSON object per line
	•	Each object must include:
		-	core (required)
		-	person (if entity_type is "person") OR company (if entity_type is "company")
		-	contact
		-	context (source-specific data)
	•	Structure must conform to DATA-RULES.md

If you cannot populate a field, omit it or use an empty object {}.
Do NOT invent data.

⸻

7. Primary Key Rules (Critical)

You must generate a deterministic primary_key for every record.

Priority order:
	1.	Stable ID from the source (best) → `source_id:field:value`
	2.	Canonical URL path → `source_id:url:/path/to/resource`
	3.	Fingerprint of stable fields → `source_id:fp:hash`

Examples:
```
finance/fdic:cert:12345
law/skadden:url:/professionals/jane-doe
investors/capboard:slug:sequoia-capital
```

UUIDs are forbidden as primary keys.

If no reasonable primary key exists, you must document this in the README.

⸻

8. Step 3: Run the Scraper

Run with: `npx tsx scraper.ts`

You must ensure:
	•	the scraper runs without crashing
	•	leads.jsonl is generated
	•	run.json contains accurate counts

If the scraper fails, you must fix it before proceeding.

⸻

9. Step 4: Quality Gate (You Do Not Bypass This)

After scraping, run validation:

```bash
npx tsx validator/validate-scraper-output.ts <path-to-scraper-directory>
```

You must fix the scraper if the gate fails due to:
	•	missing required fields
	•	invalid structure
	•	missing or empty primary_key
	•	mismatched entity_type
	•	malformed URLs or emails

You may NOT suppress gate failures.

⸻

10. Step 5: Human Review Sample

Once the gate passes, you must generate:

```
output/review_sample.json
```

This file must contain:
	•	~20 randomly selected records
	•	key fields visible (name, title/company, contact, raw_url)

You must stop here and wait for approval.

After approval, a human will move the entire folder (including output/) from `data_in_progress/` to `final_data/`. Do not move it yourself.

⸻

11. What Goes Where (Non-Negotiable)

| Section | Purpose | Examples |
|---------|---------|----------|
| core | identity + provenance | source_id, primary_key, scraped_at, raw_url |
| person | who the person is + where they are | full_name, title, company_name, website, location |
| company | what the company is + where it is | company_name, domain, industry, website, location |
| contact | direct contact methods | email, phone, socials |
| context | everything else | external IDs, metadata, source-specific fields |

If data does not clearly belong in core/person/company/contact, it goes in context.

⸻

12. What You Must NEVER Do

	•	Do NOT invent emails, phones, socials
	•	Do NOT guess missing values
	•	Do NOT change the contract
	•	Do NOT collapse fields into context to avoid validation
	•	Do NOT hardcode UUIDs
	•	Do NOT hardcode source_id (read from source.yaml)
	•	Do NOT load data into the database yourself

⸻

13. Failure Recovery Rules

If a scraper:
	•	starts returning fewer records
	•	changes structure
	•	fails quality checks

Your job is to:
	1.	Identify what changed
	2.	Update extraction logic
	3.	Re-run until the gate passes

Do not "work around" failures.

⸻

14. Completion Definition

A source is considered complete only when:
	•	scraper runs cleanly
	•	output conforms to DATA-RULES.md
	•	Quality Gate passes
	•	review sample is generated
	•	human approval is received

Until then, the source is not done.

⸻

15. Mental Model (Remember This)

You are not building "a scraper."

You are building a reliable, refreshable data source that must work again tomorrow without human babysitting.

If you are unsure:
	•	prefer correctness over coverage
	•	prefer failing loudly over silently corrupting data