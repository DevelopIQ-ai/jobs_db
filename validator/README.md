# Validator

Validates scraper output against the ScrappyPuffle data contract.

## Usage

```bash
npx tsx validator/index.ts <path-to-scraper-folder>

# Examples
npx tsx validator/index.ts final_data/finance/fdic
npx tsx validator/index.ts data_in_progress/real_estate/nyc-dob-scraper
```

## Structure

```
validator/
├── index.ts              # Main entry point - runs all validators
├── types.ts              # Shared TypeScript types
├── README.md             # This file
└── validators/
    ├── index.ts          # Re-exports all validators
    ├── folder-structure.ts   # Validates folder structure
    ├── source-yaml.ts        # Validates source.yaml
    ├── leads-jsonl.ts        # Validates output/leads.jsonl records
    ├── run-json.ts           # Validates output/run.json
    └── primary-key.ts        # Validates primary_key format
```

## Validation Tests

### 1. Folder Structure (`folder-structure.ts`)

Checks that required files/directories exist:

| Check | Description |
|-------|-------------|
| `output/` | Directory must exist |
| `output/leads.jsonl` | File must exist |
| `output/run.json` | File must exist |

### 2. Source YAML (`source-yaml.ts`)

Validates `source.yaml` configuration:

| Field | Validation |
|-------|------------|
| `source_id` | Required, string |
| `display_name` | Required, string |
| `entity_type` | Required, must be `person`, `company`, or `both` |
| `data_as_of` | Required, format `YYYY-MM-DD` |
| `start_urls` | Required, non-empty array |
| `run_command` | Required, string |
| `refresh` | Required, one of: `daily`, `weekly`, `monthly`, `quarterly`, `yearly` |
| `primary_key_strategy` | Required object with valid `type` |
| `primary_key_strategy.type` | One of: `stable_id`, `url`, `fingerprint`, `url_fingerprint` |
| `expected_volume_range` | Required object with `min` and `max` numbers |

### 3. Leads JSONL (`leads-jsonl.ts`)

Validates each record in `output/leads.jsonl`:

| Check | Description |
|-------|-------------|
| JSON validity | Each line must be valid JSON |
| `core.source_id` | Required, string |
| `core.entity_type` | Required, must be `person` or `company` |
| `core.scraped_at` | Required, valid ISO timestamp |
| `core.raw_url` | Required, string |
| `core.primary_key` | Required, non-empty string |
| Entity section | Must have exactly one of `person` or `company` |
| Entity match | Entity section must match `core.entity_type` |
| `person.full_name` | Required if entity_type is `person` |
| `company.company_name` | Required if entity_type is `company` |
| `contact` | Required (can be `{}`) |
| `context` | Required (can be `{}`) |

### 4. Primary Key Format (`primary-key.ts`)

Validates that `primary_key` format matches `primary_key_strategy` in source.yaml:

| Strategy | Expected Format | Example |
|----------|-----------------|---------|
| `stable_id` | `source_id:<field>:<value>` | `finance/fdic:cert:12345` |
| `url` | `source_id:url:<path>` | `investors/vcsheet:url:/fund/abc` |
| `fingerprint` | `source_id:fp:<hash>` | `tech_founders/yc:fp:59ee7684c564` |
| `url_fingerprint` | `source_id:<url>:<hash>` | `source:http://example.com:abc123` |

### 5. Run JSON (`run-json.ts`)

Validates `output/run.json`:

| Field | Validation |
|-------|------------|
| `source_id` | Required, string |
| `run_id` | Required, string |
| `started_at` | Required, valid ISO timestamp |
| `ended_at` | Required, valid ISO timestamp |
| `records_found` | Required, number |
| `records_valid` | Required, number |
| `records_written` | Required, number |
| `error_count` | Required, number |

## Programmatic Usage

```typescript
import { validate, ValidationResult } from "./validator";

const result: ValidationResult = validate("final_data/finance/fdic");

if (result.valid) {
  console.log("All checks passed!");
} else {
  console.log("Errors:", result.errors);
}

console.log("Stats:", result.stats);
// { recordsChecked: 4337, recordsValid: 4337, recordsInvalid: 0 }
```

## Error Types

- `structure` - Missing files or directories
- `format` - Invalid JSON or YAML syntax
- `schema` - Missing or invalid fields
