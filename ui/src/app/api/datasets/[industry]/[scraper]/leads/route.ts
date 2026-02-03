import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface LeadRecord {
  [key: string]: unknown;
}

interface SchemaField {
  path: string;
  type: string;
  example: unknown;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ industry: string; scraper: string }> }
) {
  const { industry, scraper } = await params;
  const limit = 100; // Return first 100 leads

  const rootDir = path.join(process.cwd(), "..");

  // Check both final_data and data_in_progress
  const possiblePaths = [
    path.join(rootDir, "final_data", industry, scraper, "output", "leads.jsonl"),
    path.join(rootDir, "data_in_progress", industry, scraper, "output", "leads.jsonl"),
  ];

  let leadsPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      leadsPath = p;
      break;
    }
  }

  if (!leadsPath) {
    return NextResponse.json({ error: "Leads file not found" }, { status: 404 });
  }

  try {
    const content = fs.readFileSync(leadsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const sampleLines = lines.slice(0, limit);

    const leads: LeadRecord[] = sampleLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { error: "Invalid JSON" };
      }
    });

    // Extract ALL columns and schema from the first lead
    const { columns, schema } = extractColumnsAndSchema(leads[0]);

    return NextResponse.json({
      leads,
      columns,
      schema,
      total: lines.length,
      sample: sampleLines.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read leads file" },
      { status: 500 }
    );
  }
}

function extractColumnsAndSchema(lead: LeadRecord): { columns: string[]; schema: SchemaField[] } {
  if (!lead) return { columns: [], schema: [] };

  const columns: string[] = [];
  const schema: SchemaField[] = [];

  // Recursively flatten the object to get all paths
  function flatten(obj: unknown, prefix: string = "") {
    if (obj === null || obj === undefined) return;

    if (typeof obj !== "object" || Array.isArray(obj)) {
      // Leaf value
      const path = prefix;
      columns.push(path);
      schema.push({
        path,
        type: Array.isArray(obj) ? "array" : typeof obj,
        example: obj,
      });
      return;
    }

    // Object - recurse into each key
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        // Nested object - recurse
        flatten(value, newPrefix);
      } else {
        // Leaf value (primitive or array)
        columns.push(newPrefix);
        schema.push({
          path: newPrefix,
          type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
          example: value,
        });
      }
    }
  }

  flatten(lead);

  // Sort columns: core first, then company, contact, context
  const sectionOrder = ["core", "company", "contact", "context"];
  columns.sort((a, b) => {
    const sectionA = a.split(".")[0];
    const sectionB = b.split(".")[0];
    const orderA = sectionOrder.indexOf(sectionA);
    const orderB = sectionOrder.indexOf(sectionB);
    if (orderA !== orderB) {
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    }
    return a.localeCompare(b);
  });

  // Sort schema the same way
  schema.sort((a, b) => {
    const sectionA = a.path.split(".")[0];
    const sectionB = b.path.split(".")[0];
    const orderA = sectionOrder.indexOf(sectionA);
    const orderB = sectionOrder.indexOf(sectionB);
    if (orderA !== orderB) {
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    }
    return a.path.localeCompare(b.path);
  });

  return { columns, schema };
}
