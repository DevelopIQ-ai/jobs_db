"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { use } from "react";

interface LeadRecord {
  [key: string]: unknown;
}

interface SchemaField {
  path: string;
  type: string;
  example: unknown;
}

interface LeadsResponse {
  leads: LeadRecord[];
  columns: string[];
  schema: SchemaField[];
  total: number;
  sample: number;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatColumnName(path: string): string {
  const parts = path.split(".");
  const lastPart = parts[parts.length - 1];
  return lastPart
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function getIndustryLabel(industry: string): string {
  const labels: Record<string, string> = {
    finance: "Finance",
    investors: "Investors",
    law: "Law",
    real_estate: "Real Estate",
    tech_founders: "Tech Founders",
  };
  return labels[industry] || industry.replace(/_/g, " ");
}

function getSectionFromPath(path: string): string {
  return path.split(".")[0];
}

export default function LeadsPage({
  params,
}: {
  params: Promise<{ industry: string; scraper: string }>;
}) {
  const { industry, scraper } = use(params);
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"data" | "schema">("data");

  useEffect(() => {
    fetch(`/api/datasets/${industry}/${scraper}/leads`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch leads");
        return res.json();
      })
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [industry, scraper]);

  const displayName =
    scraper.replace(/-/g, " ").replace(/scraper/i, "").trim() || scraper;

  const schemaBySection = data?.schema.reduce(
    (acc, field) => {
      const section = getSectionFromPath(field.path);
      if (!acc[section]) acc[section] = [];
      acc[section].push(field);
      return acc;
    },
    {} as Record<string, SchemaField[]>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-[#222]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/dashboard"
              className="font-bold tracking-wide hover:opacity-80 transition-opacity"
            >
              ScrappyPuffle
            </Link>
            <span className="text-[#555]">/</span>
            <span className="text-[#555]">
              {getIndustryLabel(industry)}
            </span>
            <span className="text-[#555]">/</span>
            <span className="text-white">{displayName}</span>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-[#555] hover:text-white transition-colors"
          >
            &larr; Back
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-10 py-8">
        {loading && (
          <div className="text-center py-20 text-[#555]">
            Loading leads...
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-white">{error}</div>
        )}

        {data && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Title bar + tabs */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-5">
                <h1 className="text-xl font-bold">{displayName}</h1>
                <div className="flex border border-[#333] overflow-hidden">
                  <button
                    onClick={() => setActiveTab("data")}
                    className={`px-4 py-1.5 text-xs font-medium transition-all ${
                      activeTab === "data"
                        ? "bg-white text-black"
                        : "bg-[#111] text-[#888] hover:text-white"
                    }`}
                  >
                    Data
                  </button>
                  <button
                    onClick={() => setActiveTab("schema")}
                    className={`px-4 py-1.5 text-xs font-medium transition-all ${
                      activeTab === "schema"
                        ? "bg-white text-black"
                        : "bg-[#111] text-[#888] hover:text-white"
                    }`}
                  >
                    Schema
                  </button>
                </div>
              </div>
              <div className="text-xs text-[#555]">
                <span className="text-white font-bold">
                  {formatNumber(data.total)}
                </span>{" "}
                records &middot;{" "}
                <span className="text-[#888] font-bold">
                  {data.columns.length}
                </span>{" "}
                fields
              </div>
            </div>

            {/* Data Tab */}
            {activeTab === "data" && (
              <>
                <div className="bg-[#111] border border-[#333] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-[#333]">
                          <th className="text-left px-4 py-3 text-[#555] text-[10px] uppercase tracking-wider w-12 sticky left-0 bg-[#1a1a1a]">
                            #
                          </th>
                          {data.columns.map((col) => (
                            <th
                              key={col}
                              className="text-left px-4 py-3 text-[#555] text-[10px] uppercase tracking-wider whitespace-nowrap bg-[#1a1a1a]"
                              title={col}
                            >
                              {formatColumnName(col)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.leads.map((lead, i) => (
                          <tr
                            key={i}
                            className={`border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors ${
                              i % 2 === 0 ? "" : "bg-[#0a0a0a]"
                            }`}
                          >
                            <td className="px-4 py-2.5 text-[#555] text-xs sticky left-0 bg-inherit">
                              {i + 1}
                            </td>
                            {data.columns.map((col) => (
                              <td
                                key={col}
                                className="px-4 py-2.5 text-[#888] max-w-[280px] truncate"
                                title={formatCellValue(
                                  getNestedValue(lead, col)
                                )}
                              >
                                {formatCellValue(getNestedValue(lead, col))}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {data.total > data.sample && (
                  <div className="mt-4 text-center text-xs text-[#555]">
                    Showing {data.sample} of {formatNumber(data.total)} records
                  </div>
                )}
              </>
            )}

            {/* Schema Tab */}
            {activeTab === "schema" && schemaBySection && (
              <div className="space-y-4">
                {Object.entries(schemaBySection).map(([section, fields]) => (
                  <div
                    key={section}
                    className="bg-[#111] border border-[#333] overflow-hidden"
                  >
                    <div className="bg-[#1a1a1a] border-b border-[#333] px-5 py-3 flex items-center gap-2">
                      <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#888] font-bold">
                        {section}
                      </h3>
                      <span className="text-[10px] text-[#555] ml-auto">
                        {fields.length} fields
                      </span>
                    </div>
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-[#1a1a1a]">
                          <th className="text-left px-5 py-2 text-[#555] text-[10px] uppercase tracking-wider w-1/3">
                            Field
                          </th>
                          <th className="text-left px-5 py-2 text-[#555] text-[10px] uppercase tracking-wider w-24">
                            Type
                          </th>
                          <th className="text-left px-5 py-2 text-[#555] text-[10px] uppercase tracking-wider">
                            Example
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field) => (
                          <tr
                            key={field.path}
                            className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors"
                          >
                            <td className="px-5 py-2.5">
                              <code className="text-[13px] text-white font-mono">
                                {field.path}
                              </code>
                            </td>
                            <td className="px-5 py-2.5">
                              <span className="inline-block text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider border border-[#333] text-[#888]">
                                {field.type}
                              </span>
                            </td>
                            <td
                              className="px-5 py-2.5 text-[#555] max-w-md truncate font-mono text-xs"
                              title={formatCellValue(field.example)}
                            >
                              {formatCellValue(field.example)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
