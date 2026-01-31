DATA-RULES.md

ScrappyPuffle Data Contract & Pipeline Rules

This repository enforces a single, canonical data model and ingestion process for all scrapers.
Automation depends on strict consistency. If a rule is violated, the data must not be loaded.

⸻

1. Core Principles (Non-Negotiable)
	1.	JSONL is the source of truth
	•	Every scraper outputs JSON Lines (.jsonl)
	•	CSV is optional and may only be generated from JSONL
	•	Pipelines, gates, and loaders operate on JSONL only
	2.	Every record follows the same top-level structure
	•	core
	•	contact
	•	exactly one of: person OR company
	•	context
	3.	Every record must be upsertable
	•	Deterministic primary_key is required
	•	UUID is used internally for database identity
	•	Raw names are never used for dedupe

⸻

2. Top-Level Record Structure

Every JSONL line must look like this:

{
  "core": { ... },
  "person": { ... } | "company": { ... },
  "contact": { ... },
  "context": { ... }
}

If a section has no data, it must be an empty object {}.

⸻

3. Core Section (Required for All Records)

The core block defines identity and provenance.

Required fields

core = {
  source_id: string;        // e.g. "finance/fdic"
  entity_type: "person" | "company";
  scraped_at: string;       // ISO timestamp
  raw_url: string;          // exact URL scraped
  primary_key: string;      // deterministic, stable
}

Rules
	•	primary_key must be stable across runs
	•	primary_key must be source-scoped
	•	UUIDs are NOT used as primary_key
	•	Example valid primary keys:
	•	finance/fdic:cert:12345
	•	law/skadden:url:/professionals/jane-doe
	•	real_estate/icsc:profile:abc123

⸻

4. Person Entity Section

Used only when entity_type = "person".

Required

person = {
  full_name: string;
}

Optional (best-effort parsing)

person = {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  suffix?: string;          // Jr, Sr, III, Esq, etc
  title?: string;
  company_name?: string;
  profile_url?: string;     // canonical profile page
  name_raw?: string;        // unmodified source text
}

Rules
	•	full_name is always required
	•	Parsed name fields may be empty if ambiguous
	•	Dedupe must NEVER rely on full_name alone

⸻

5. Company Entity Section

Used only when entity_type = "company".

Required

company = {
  company_name: string;
}

Optional

company = {
  legal_name?: string;
  domain?: string;          // example.com (no scheme)
  industry?: string;
  size?: number;            // employee count if known
  founded_year?: number;
  profile_url?: string;
  name_raw?: string;
}


⸻

6. Contact Section (Optional but Standardized)

The contact block is shared across all entities.

contact = {
  email?: string;
  phone?: string;
  website?: string;   // full URL

  socials?: SocialLink[];

  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}


7. Context Section (Source-Specific Data)

The context block holds all non-standard fields.

context = Record<string, any>;

Rules
	•	Context must not duplicate core, contact, person, or company fields
	•	Context keys should be flat whenever possible
	•	Context is never validated beyond JSON validity
	•	Examples:
	•	FDIC: cert, total_assets, insured_date
	•	NYC DOB: job_number, estimated_cost
	•	YC: batch, one_liner, team_size

⸻

8. IDs, UUIDs, and External Identifiers

Required behavior
	•	Every database row has an internal id = UUID
	•	UUID is generated at insert time
	•	UUID is NEVER used for dedupe

External IDs
	•	Source identifiers (CERT, CU Number, etc) must be preserved
	•	These belong in context
	•	They should be used to build primary_key

⸻

9. Dedupe Rules (Hard Rules)
	1.	Dedupe is based ONLY on primary_key
	2.	primary_key must be deterministic
	3.	primary_key must not depend on:
	•	raw name alone
	•	scraped_at
	•	random UUIDs

If no stable ID exists, fallback is:

source_id + ":" + hash(normalized(name + company + location))

This fallback should be rare.

⸻

10. Output Rules (Scrapers)

Every scraper must output:

output/
  leads.jsonl          // REQUIRED
  run.json             // REQUIRED
  scrape-progress.json // OPTIONAL

run.json must include

{
  "source_id": "...",
  "run_id": "...",
  "started_at": "...",
  "ended_at": "...",
  "records_found": 0,
  "records_valid": 0,
  "records_written": 0,
  "error_count": 0
}

⸻

10b. Source Metadata (source.yaml)

Every scraper directory MUST contain a source.yaml file.

Required fields

source_id: string           # e.g. "finance/fdic"
display_name: string        # human-readable name
entity_type: string         # "person" | "company" | "both"
data_as_of: string          # REQUIRED: ISO date (YYYY-MM-DD) of data snapshot
start_urls: string[]        # entry point URLs
run_command: string         # how to execute the scraper
refresh: string             # "daily" | "weekly" | "monthly" | "quarterly" | "yearly"
primary_key_strategy: object
expected_volume_range: { min: number, max: number }

Rules
	•	data_as_of is MANDATORY - it pins the exact data snapshot
	•	data_as_of must be updated after every successful scrape
	•	For live APIs (FDIC), use the date the scrape was run
	•	For versioned data (NCUA quarterly), use the data release date
	•	For static data (CSBS), use the last verification date
	•	Without data_as_of, reproducibility cannot be verified


⸻

11. Quality Gate (Enforced)

Data must NOT be loaded if:
	•	required core fields are missing
	•	entity block does not match entity_type
	•	primary_key is missing or empty
	•	JSON is malformed

Context is never a reason to fail a record.

⸻

12. Non-Goals (Explicit)

This system does NOT:
	•	enforce a single schema across industries
	•	attempt perfect name parsing
	•	guess missing contact info
	•	dedupe across different sources automatically (yet)

⸻

13. Mental Model (Read This Once)
	•	core = identity + provenance
	•	person/company = what the thing is
	•	contact = how to reach it
	•	context = why it matters

If it doesn’t fit cleanly, it goes in context.
