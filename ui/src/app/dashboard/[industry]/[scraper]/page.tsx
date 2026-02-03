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

function Puffle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none">
      <path
        d="M60 90 C25 90 15 60 20 45 C25 25 45 15 60 15 C75 15 95 25 100 45 C105 60 95 90 60 90Z"
        fill="#E85D04"
        stroke="#1a1a1a"
        strokeWidth="2"
      />
      <ellipse cx="42" cy="40" rx="12" ry="10" fill="#FDBA74" opacity="0.5" />
      <ellipse cx="45" cy="50" rx="8" ry="10" fill="white" stroke="#1a1a1a" strokeWidth="1.5" />
      <ellipse cx="72" cy="50" rx="8" ry="10" fill="white" stroke="#1a1a1a" strokeWidth="1.5" />
      <circle cx="47" cy="52" r="4" fill="#1a1a1a" />
      <circle cx="74" cy="52" r="4" fill="#1a1a1a" />
      <circle cx="48" cy="50" r="1.5" fill="white" />
      <circle cx="75" cy="50" r="1.5" fill="white" />
      <path
        d="M50 18 Q55 5 60 15 Q62 8 65 18"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
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
  if (value === null || value === undefined) return "—";
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

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    string: "bg-blue-100 text-blue-800",
    number: "bg-green-100 text-green-800",
    boolean: "bg-purple-100 text-purple-800",
    array: "bg-amber-100 text-amber-800",
    object: "bg-rose-100 text-rose-800",
    null: "bg-gray-100 text-gray-500",
  };
  return colors[type] || "bg-gray-100 text-gray-800";
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

  const displayName = scraper.replace(/-/g, " ").replace(/scraper/i, "").trim() || scraper;

  // Group schema by section
  const schemaBySection = data?.schema.reduce((acc, field) => {
    const section = getSectionFromPath(field.path);
    if (!acc[section]) acc[section] = [];
    acc[section].push(field);
    return acc;
  }, {} as Record<string, SchemaField[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <Puffle className="w-8 h-8" />
              <span className="font-bold">ScrappyPuffle</span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-gray-500">{getIndustryLabel(industry)}</span>
            <span className="text-gray-300">/</span>
            <span className="font-medium">{displayName}</span>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center py-20 text-gray-500">Loading leads...</div>
        )}

        {error && (
          <div className="text-center py-20 text-red-500">{error}</div>
        )}

        {data && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Header with tabs */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <h1 className="text-2xl font-bold">{displayName}</h1>
                <div className="flex border border-gray-200 rounded overflow-hidden">
                  <button
                    onClick={() => setActiveTab("data")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === "data"
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Data
                  </button>
                  <button
                    onClick={() => setActiveTab("schema")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === "schema"
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Schema
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-medium text-gray-900">{formatNumber(data.total)}</span> records
                {" · "}
                <span className="font-medium text-gray-900">{data.columns.length}</span> fields
              </div>
            </div>

            {/* Data Tab */}
            {activeTab === "data" && (
              <>
                <div className="bg-white border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs w-12 sticky left-0 bg-gray-50">#</th>
                          {data.columns.map((col) => (
                            <th
                              key={col}
                              className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap"
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
                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-4 py-3 text-gray-400 text-xs sticky left-0 bg-white">{i + 1}</td>
                            {data.columns.map((col) => (
                              <td
                                key={col}
                                className="px-4 py-3 text-gray-700 max-w-[300px] truncate"
                                title={formatCellValue(getNestedValue(lead, col))}
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
                  <div className="mt-4 text-center text-sm text-gray-500">
                    Showing {data.sample} of {formatNumber(data.total)} records
                  </div>
                )}
              </>
            )}

            {/* Schema Tab */}
            {activeTab === "schema" && schemaBySection && (
              <div className="space-y-6">
                {Object.entries(schemaBySection).map(([section, fields]) => (
                  <div key={section} className="bg-white border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
                      <h3 className="font-semibold text-gray-900 capitalize">{section}</h3>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-1/3">Field</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-24">Type</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Example</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field) => (
                          <tr key={field.path} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <code className="text-sm text-gray-800 font-mono">{field.path}</code>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block text-xs px-2 py-1 rounded ${getTypeColor(field.type)}`}>
                                {field.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600 max-w-md truncate font-mono text-xs" title={formatCellValue(field.example)}>
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
