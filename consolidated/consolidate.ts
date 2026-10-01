/**
 * Consolidates every source package's output/leads.jsonl into a single
 * dataset at consolidated/leads.jsonl.
 *
 * - Walks final_data/ and data_in_progress/ (skips template/).
 * - Dedupes on core.primary_key, first occurrence wins.
 * - Malformed lines and records without a primary_key are skipped and counted.
 * - Writes summary.json with per-source and per-entity_type counts.
 *
 * Usage: npx tsx consolidated/consolidate.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const SEARCH_DIRS = ["final_data", "data_in_progress"];
const OUT_FILE = path.join(__dirname, "leads.jsonl");
const SUMMARY_FILE = path.join(__dirname, "summary.json");

interface SourceStats {
  source_dir: string;
  records: number;
  written: number;
  skipped_malformed: number;
  skipped_no_primary_key: number;
}

function findLeadsFiles(): string[] {
  const files: string[] = [];
  for (const dir of SEARCH_DIRS) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    const walk = (p: string) => {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "leads.jsonl") files.push(full);
      }
    };
    walk(dirPath);
  }
  return files.sort();
}

function main() {
  const leadsFiles = findLeadsFiles();
  const seen = new Set<string>();
  const out = fs.createWriteStream(OUT_FILE);
  const stats: SourceStats[] = [];
  const entityCounts: Record<string, number> = {};
  let totalWritten = 0;

  for (const file of leadsFiles) {
    const rel = path.relative(ROOT, path.dirname(path.dirname(file)));
    const s: SourceStats = {
      source_dir: rel,
      records: 0,
      written: 0,
      skipped_malformed: 0,
      skipped_no_primary_key: 0,
    };

    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      s.records++;
      let record: { core?: { primary_key?: string; entity_type?: string } };
      try {
        record = JSON.parse(line);
      } catch {
        s.skipped_malformed++;
        continue;
      }
      const pk = record?.core?.primary_key;
      if (!pk) {
        s.skipped_no_primary_key++;
        continue;
      }
      if (seen.has(pk)) continue;
      seen.add(pk);
      const et = record.core?.entity_type ?? "unknown";
      entityCounts[et] = (entityCounts[et] ?? 0) + 1;
      out.write(line + "\n");
      s.written++;
      totalWritten++;
    }
    stats.push(s);
    console.log(`${rel}: ${s.written}/${s.records} written`);
  }
  out.end();

  const summary = {
    generated_at: new Date().toISOString(),
    total_records: totalWritten,
    unique_primary_keys: seen.size,
    entity_type_counts: entityCounts,
    sources: stats,
    notes:
      "Excludes template/ example data and jobs/hiring_cafe (its ~178k rows live only in the ds_hiring_cafe Supabase table, not as committed files).",
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2) + "\n");
  console.log(`\nTotal: ${totalWritten} records -> ${OUT_FILE}`);
}

main();
