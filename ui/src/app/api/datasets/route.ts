import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

interface RunData {
  source_id: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  records_found: number;
  records_valid: number;
  records_written: number;
  error_count: number;
}

interface Dataset {
  industry: string;
  scraper: string;
  source_id: string;
  entity_type: "person" | "company" | "both";
  status: "final" | "in_progress";
  run: RunData | null;
  readme: string;
  leadsCount: number;
  contactEnrichment: Record<string, number>; // field -> percentage (0-100) of records that have it
}

function scanDataDirectory(
  baseDir: string,
  status: "final" | "in_progress"
): Dataset[] {
  const datasets: Dataset[] = [];

  if (!fs.existsSync(baseDir)) {
    return datasets;
  }

  const industries = fs.readdirSync(baseDir).filter((f) => {
    const fullPath = path.join(baseDir, f);
    return (
      fs.statSync(fullPath).isDirectory() &&
      !f.startsWith(".") &&
      f !== "template" &&
      f !== "node_modules"
    );
  });

  for (const industry of industries) {
    const industryPath = path.join(baseDir, industry);
    const scrapers = fs.readdirSync(industryPath).filter((f) => {
      const fullPath = path.join(industryPath, f);
      return fs.statSync(fullPath).isDirectory() && !f.startsWith(".");
    });

    for (const scraper of scrapers) {
      const scraperPath = path.join(industryPath, scraper);
      const outputPath = path.join(scraperPath, "output");

      let run: RunData | null = null;
      let readme = "";
      let leadsCount = 0;
      let entityType: "person" | "company" | "both" = "company";
      const contactFieldCounts: Record<string, number> = {};

      // Read source.yaml for entity_type
      const sourceYamlPath = path.join(scraperPath, "source.yaml");
      if (fs.existsSync(sourceYamlPath)) {
        try {
          const yamlContent = yaml.load(
            fs.readFileSync(sourceYamlPath, "utf-8")
          ) as Record<string, unknown>;
          if (yamlContent?.entity_type) {
            entityType = yamlContent.entity_type as "person" | "company" | "both";
          }
        } catch {
          // ignore
        }
      }

      // Read run.json
      const runPath = path.join(outputPath, "run.json");
      if (fs.existsSync(runPath)) {
        try {
          run = JSON.parse(fs.readFileSync(runPath, "utf-8"));
        } catch {
          // ignore
        }
      }

      // Read README
      const readmePath = path.join(scraperPath, "README.md");
      if (fs.existsSync(readmePath)) {
        readme = fs.readFileSync(readmePath, "utf-8");
      }

      // Count leads and compute contact enrichment percentages
      const leadsPath = path.join(outputPath, "leads.jsonl");
      if (fs.existsSync(leadsPath)) {
        const content = fs.readFileSync(leadsPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        leadsCount = lines.length;

        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            const contact = record.contact;
            if (contact) {
              if (contact.email) contactFieldCounts["email"] = (contactFieldCounts["email"] || 0) + 1;
              if (contact.phone) contactFieldCounts["phone"] = (contactFieldCounts["phone"] || 0) + 1;
              if (Array.isArray(contact.socials)) {
                const platforms = new Set<string>();
                for (const s of contact.socials) {
                  if (s.platform) platforms.add(s.platform);
                }
                for (const p of platforms) {
                  contactFieldCounts[p] = (contactFieldCounts[p] || 0) + 1;
                }
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Convert counts to percentages
      const contactEnrichment: Record<string, number> = {};
      if (leadsCount > 0) {
        for (const [field, count] of Object.entries(contactFieldCounts)) {
          contactEnrichment[field] = Math.round((count / leadsCount) * 100);
        }
      }

      datasets.push({
        industry,
        scraper,
        source_id: run?.source_id || `${industry}/${scraper}`,
        entity_type: entityType,
        status,
        run,
        readme,
        leadsCount,
        contactEnrichment,
      });
    }
  }

  return datasets;
}

export async function GET() {
  const rootDir = path.join(process.cwd(), "..");
  const finalDataDir = path.join(rootDir, "final_data");
  const inProgressDir = path.join(rootDir, "data_in_progress");

  const finalDatasets = scanDataDirectory(finalDataDir, "final");
  const inProgressDatasets = scanDataDirectory(inProgressDir, "in_progress");

  const datasets = [...finalDatasets, ...inProgressDatasets];

  return NextResponse.json(datasets);
}
