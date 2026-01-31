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

2. High-Level Flow (You Must Follow This Order)

When given a new site or source, you must follow this exact sequence:
	1.	Create a new Source Package
	2.	Write a scraper that outputs valid JSONL
	3.	Run the scraper
	4.	Fix errors until the Quality Gate passes
	5.	Produce a small review sample
	6.	Stop and wait for approval

You may NOT skip steps.

⸻

3. Step 1: Create a Source Package

When a new site is provided, you must create a folder with this structure:

data_in_progress/<industry>/<segment>/<source_name>/
  source.yaml
  scraper.ts
  output/
  README.md

source.yaml (required fields)

You must define:
	•	source_id (globally unique, stable)
	•	display_name (human-readable name)
	•	entity_type (person, company, or both)
	•	start_urls
	•	run_command
	•	refresh (daily, weekly, monthly, quarterly, yearly)
	•	primary_key_strategy
	•	expected_volume_range
	•	data_as_of

	

⸻

4. Step 2: Write the Scraper

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

⸻

5. Output Rules (Hard Requirement)

The scraper must write the following files:

output/
  leads.jsonl          // REQUIRED
  run.json             // REQUIRED
  scrape-progress.json // OPTIONAL

leads.jsonl rules
	•	One JSON object per line
	•	Each object must include:
	•	core
	•	person (if entity_type is "person") OR company (if entity_type is "company")
	•	contact
	•	whatever context you can find
	•	Structure must conform to DATA-RULES.md

If you cannot populate a field, omit it or leave the object empty.
Do NOT invent data.

⸻

6. Primary Key Rules (Critical)

You must generate a deterministic primary_key for every record.

Priority order:
	1.	Stable ID from the source (best)
	2.	Canonical full URL
	3.	URL + fingerprint (hash of stable fields)

UUIDs are forbidden as primary keys.

If no reasonable primary key exists, you must document this in the README.

⸻

7. Step 3: Run the Scraper

You must ensure:
	•	the scraper runs without crashing
	•	leads.jsonl is generated
	•	run.json contains accurate counts

If the scraper fails, you must fix it before proceeding. While scraping, you can create and iterate on different versions, but at the end, you must consolidate into one scraper file.

⸻

8. Step 4: Quality Gate (You Do Not Bypass This)

After scraping, the pipeline will run a Quality Gate.

You must fix the scraper if the gate fails due to:
	•	missing required fields
	•	invalid structure
	•	missing or empty primary_key
	•	mismatched entity_type
	•	malformed URLs or emails

You may NOT suppress gate failures.

⸻

9. Step 5: Human Review Sample

Once the gate passes, you must generate:

output/review_sample.json

This file must contain:
	•	~20 randomly selected records
	•	key fields visible (name, title/company, contact, raw_url)

You must stop here and wait for approval.

⸻

10. What Goes Where (Non-Negotiable)
	•	core → identity and provenance
	•	person / company → what the entity is
	•	contact → how to reach it
	•	context → everything else

If data does not clearly belong in core/person/company/contact, it goes in context.

⸻

11. What You Must NEVER Do
	•	Do NOT invent emails, phones, socials
	•	Do NOT guess missing values
	•	Do NOT change the contract
	•	Do NOT collapse fields into context to avoid validation
	•	Do NOT hardcode UUIDs
	•	Do NOT load data into the database yourself

⸻

12. Failure Recovery Rules

If a scraper:
	•	starts returning fewer records
	•	changes structure
	•	fails quality checks

Your job is to:
	1.	Identify what changed
	2.	Update extraction logic
	3.	Re-run until the gate passes

Do not “work around” failures.

⸻

13. Completion Definition

A source is considered complete only when:
	•	scraper runs cleanly
	•	output conforms to DATA-RULES.md
	•	Quality Gate passes
	•	review sample is generated
	•	human approval is received

Until then, the source is not done.

⸻

14. Mental Model (Remember This)

You are not building “a scraper.”

You are building a reliable, refreshable data source that must work again tomorrow without human babysitting.

If you are unsure:
	•	prefer correctness over coverage
	•	prefer failing loudly over silently corrupting data