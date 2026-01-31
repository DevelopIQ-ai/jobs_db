"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

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
  run: RunData | null;
  readme: string;
  leadsCount: number;
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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getIndustryLabel(industry: string): string {
  const labels: Record<string, string> = {
    finance: "Finance",
    investors: "Investors",
    law: "Law",
    real_estate: "Real Estate",
    tech_founders: "Tech Founders",
  };
  return labels[industry] || industry;
}

function getIndustryColor(industry: string): string {
  const colors: Record<string, string> = {
    finance: "bg-emerald-100 text-emerald-800",
    investors: "bg-purple-100 text-purple-800",
    law: "bg-blue-100 text-blue-800",
    real_estate: "bg-amber-100 text-amber-800",
    tech_founders: "bg-rose-100 text-rose-800",
  };
  return colors[industry] || "bg-gray-100 text-gray-800";
}

function getReadmeDescription(readme: string): string {
  const lines = readme.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```")) {
      return trimmed;
    }
  }
  return "";
}

function DatasetCard({ dataset, delay }: { dataset: Dataset; delay: number }) {
  const [expanded, setExpanded] = useState(false);
  const description = getReadmeDescription(dataset.readme);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className="bg-white border border-gray-200 hover:border-gray-400 transition-colors"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <span className={`inline-block text-xs px-2 py-1 rounded mb-2 ${getIndustryColor(dataset.industry)}`}>
              {getIndustryLabel(dataset.industry)}
            </span>
            <h3 className="font-bold text-lg">{dataset.scraper.replace(/-/g, " ").replace(/scraper/i, "").trim() || dataset.scraper}</h3>
            <p className="text-gray-500 text-sm font-mono">{dataset.source_id}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{formatNumber(dataset.leadsCount)}</div>
            <div className="text-xs text-gray-500">records</div>
          </div>
        </div>

        {description && (
          <p className="text-gray-600 text-sm mb-4">{description}</p>
        )}

        {dataset.run && (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-500 text-xs mb-1">Valid</div>
              <div className="font-medium">{formatNumber(dataset.run.records_valid)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">Errors</div>
              <div className={`font-medium ${dataset.run.error_count > 0 ? "text-red-600" : "text-gray-900"}`}>
                {formatNumber(dataset.run.error_count)}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">Last Run</div>
              <div className="font-medium">{formatDate(dataset.run.ended_at)}</div>
            </div>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-4 text-xs text-gray-500 hover:text-gray-900 transition-colors"
        >
          {expanded ? "Hide README" : "Show README"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto">
            {dataset.readme}
          </pre>
        </div>
      )}
    </motion.div>
  );
}

export default function Dashboard() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/datasets")
      .then((res) => res.json())
      .then((data) => {
        setDatasets(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const industries = [...new Set(datasets.map((d) => d.industry))];
  const filteredDatasets = filter === "all" ? datasets : datasets.filter((d) => d.industry === filter);

  const totalRecords = datasets.reduce((sum, d) => sum + d.leadsCount, 0);
  const totalErrors = datasets.reduce((sum, d) => sum + (d.run?.error_count || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Puffle className="w-8 h-8" />
            <span className="font-bold">ScrappyPuffle</span>
          </Link>
          <span className="text-sm text-gray-500">Data Dashboard</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10"
        >
          <div className="bg-white border border-gray-200 p-6">
            <div className="text-3xl font-bold text-gray-900">{datasets.length}</div>
            <div className="text-sm text-gray-500">Scrapers</div>
          </div>
          <div className="bg-white border border-gray-200 p-6">
            <div className="text-3xl font-bold text-gray-900">{formatNumber(totalRecords)}</div>
            <div className="text-sm text-gray-500">Total Records</div>
          </div>
          <div className="bg-white border border-gray-200 p-6">
            <div className="text-3xl font-bold text-gray-900">{industries.length}</div>
            <div className="text-sm text-gray-500">Industries</div>
          </div>
          <div className="bg-white border border-gray-200 p-6">
            <div className={`text-3xl font-bold ${totalErrors > 0 ? "text-red-600" : "text-gray-900"}`}>
              {formatNumber(totalErrors)}
            </div>
            <div className="text-sm text-gray-500">Total Errors</div>
          </div>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 text-sm border transition-colors ${
              filter === "all"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-900 border-gray-300 hover:border-gray-900"
            }`}
          >
            All
          </button>
          {industries.map((industry) => (
            <button
              key={industry}
              onClick={() => setFilter(industry)}
              className={`px-4 py-2 text-sm border transition-colors ${
                filter === industry
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-900 border-gray-300 hover:border-gray-900"
              }`}
            >
              {getIndustryLabel(industry)}
            </button>
          ))}
        </div>

        {/* Dataset Cards */}
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading datasets...</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filteredDatasets.map((dataset, i) => (
              <DatasetCard
                key={`${dataset.industry}/${dataset.scraper}`}
                dataset={dataset}
                delay={i * 0.05}
              />
            ))}
          </div>
        )}

        {!loading && filteredDatasets.length === 0 && (
          <div className="text-center py-20 text-gray-500">No datasets found</div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-8 border-t border-gray-200 mt-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puffle className="w-5 h-5" />
            <span className="text-sm">ScrappyPuffle</span>
          </div>
          <span className="text-gray-500 text-sm">2025</span>
        </div>
      </footer>
    </div>
  );
}
