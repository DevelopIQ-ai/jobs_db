# ScrappyPuffle - AI Scraping Pipeline

You are an agent that writes code to scrape data from given websites in a methodical way.

## Project Structure

```
scrappypuffle/
├── AGENTS.md              # Detailed instructions for AI agents (READ THIS)
├── DATA-RULES.md          # Data contract and schema rules
├── CLAUDE.md              # This file
├── lib/
│   └── source-config.ts   # Shared utility - ALL scrapers must use this
├── template/              # Reference implementation
│   ├── source.yaml        # Example config
│   ├── scraper.ts         # Example scraper
│   └── output/
├── data_in_progress/      # YOUR WORKSPACE - create new scrapers here
│   └── <industry>/
│       └── <source_name>/
├── final_data/            # Approved scrapers (do not modify without approval)
│   └── <industry>/
│       └── <source_name>/
└── validator/
    └── validate-scraper-output.ts  # Validation script
```

## Quick Start

1. **Read the rules**: `AGENTS.md` and `DATA-RULES.md`
2. **Look at the template**: `template/` shows the expected file structure
3. **Look at examples**: `final_data/` contains working scrapers
4. **Create your scraper** in `data_in_progress/<industry>/<source_name>/`

## Key Files to Create

For each new scraper, create:

```
data_in_progress/<industry>/<source_name>/
├── source.yaml    # Metadata (source_id, entity_type, etc.)
├── scraper.ts     # Your scraping code
├── output/        # Will contain leads.jsonl and run.json
└── README.md      # Notes about the source
```

## Critical Rules

1. **Never hardcode values** - Read source_id, entity_type from source.yaml
2. **Use lib/source-config.ts** - Import path is `../../../lib/source-config`
3. **Output JSONL** - One JSON object per line in `output/leads.jsonl`
4. **Call updateDataAsOf()** - After successful scrape to update source.yaml

## Workflow

```
User gives website URL
        │
        ▼
Create source package in data_in_progress/
        │
        ▼
Write scraper using lib/source-config.ts
        │
        ▼
Run scraper → generates output/leads.jsonl
        │
        ▼
Run validation → fix until it passes
        │
        ▼
Generate review sample → STOP and wait for human approval
        │
        ▼
After approval → move to final_data/
```

## Reference Documents

- **AGENTS.md** - Step-by-step instructions, source.yaml format, scraper template
- **DATA-RULES.md** - Record structure, required fields, validation rules
- **template/** - Copy this to start a new scraper
- **final_data/** - Working examples to reference
