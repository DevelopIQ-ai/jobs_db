import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

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
  status: "final" | "in_progress";
  run: RunData | null;
  readme: string;
  leadsCount: number;
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

      // Count leads
      const leadsPath = path.join(outputPath, "leads.jsonl");
      if (fs.existsSync(leadsPath)) {
        const content = fs.readFileSync(leadsPath, "utf-8");
        leadsCount = content.trim().split("\n").filter(Boolean).length;
      }

      datasets.push({
        industry,
        scraper,
        source_id: run?.source_id || `${industry}/${scraper}`,
        status,
        run,
        readme,
        leadsCount,
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
