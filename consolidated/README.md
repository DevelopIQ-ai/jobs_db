# consolidated/

One dataset built from every committed source package. `leads.jsonl` merges
all `final_data/` and `data_in_progress/` outputs — each record keeps its
`core.source_id` for provenance and is deduplicated on `core.primary_key`.

- `leads.jsonl` — the merged dataset (~112k records, ~91MB)
- `summary.json` — per-source counts, entity-type breakdown, skip stats
- `consolidate.ts` — regenerates both: `npx tsx consolidated/consolidate.ts`

Not included:

- `template/` — example records, not real data
- `jobs/hiring_cafe` — its ~178k rows are never committed; they live in the
  `ds_hiring_cafe` Supabase table (see the root README's Public API section)
- Records missing `core.primary_key` or malformed JSON — counted in
  `summary.json` under `skipped_*`
