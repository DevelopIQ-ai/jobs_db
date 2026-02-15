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
  status: "final" | "in_progress";
  run: RunData | null;
  readme: string;
  leadsCount: number;
}

function Puffle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none">
      <path
        d="M60 90 C25 90 15 60 20 45 C25 25 45 15 60 15 C75 15 95 25 100 45 C105 60 95 90 60 90Z"
        fill="#FF6B00"
        stroke="#FF853380"
        strokeWidth="1.5"
      />
      <ellipse cx="42" cy="40" rx="12" ry="10" fill="#FF8533" opacity="0.25" />
      <ellipse cx="45" cy="50" rx="8" ry="10" fill="#E8E8F0" stroke="#FF853360" strokeWidth="1" />
      <ellipse cx="72" cy="50" rx="8" ry="10" fill="#E8E8F0" stroke="#FF853360" strokeWidth="1" />
      <circle cx="47" cy="52" r="4" fill="#0C0C14" />
      <circle cx="74" cy="52" r="4" fill="#0C0C14" />
      <circle cx="48.5" cy="50.5" r="1.5" fill="white" />
      <circle cx="75.5" cy="50.5" r="1.5" fill="white" />
      <path d="M50 18 Q55 5 60 15 Q62 8 65 18" fill="none" stroke="#FF8533" strokeWidth="2" strokeLinecap="round" />
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
  return labels[industry] || industry.replace(/_/g, " ");
}

function getIndustryAccent(industry: string): string {
  const colors: Record<string, string> = {
    finance: "#00E676",
    investors: "#BB86FC",
    law: "#64B5F6",
    real_estate: "#FFB74D",
    tech_founders: "#FF8A80",
  };
  return colors[industry] || "#FF6B00";
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
  const description = getReadmeDescription(dataset.readme);
  const accentColor = getIndustryAccent(dataset.industry);
  const isFinal = dataset.status === "final";

  return (
    <Link href={`/dashboard/${dataset.industry}/${dataset.scraper}`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.2 }}
        className="bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] transition-all cursor-pointer group relative overflow-hidden"
      >
        {/* top accent strip */}
        <div
          className="h-[2px] w-full"
          style={{ background: accentColor }}
        />

        <div className="p-5">
          {/* status + industry + count */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-2 h-2 rounded-full ${isFinal ? "pulse-dot" : ""}`}
                style={{ color: isFinal ? "var(--success)" : "var(--accent)", backgroundColor: isFinal ? "var(--success)" : "var(--accent)" }}
                title={isFinal ? "Final" : "In Progress"}
              />
              <span
                className="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border"
                style={{
                  color: accentColor,
                  borderColor: accentColor + "40",
                  backgroundColor: accentColor + "10",
                }}
              >
                {getIndustryLabel(dataset.industry)}
              </span>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[var(--accent)]">
                {formatNumber(dataset.leadsCount)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                records
              </div>
            </div>
          </div>

          {/* name + source id */}
          <h3 className="font-bold text-base mb-1 group-hover:text-[var(--accent)] transition-colors">
            {dataset.scraper.replace(/-/g, " ").replace(/scraper/i, "").trim() || dataset.scraper}
          </h3>
          <p className="text-[var(--text-muted)] text-xs font-mono mb-3">
            {dataset.source_id}
          </p>

          {/* description */}
          {description && (
            <p className="text-[var(--text-secondary)] text-xs mb-4 leading-relaxed line-clamp-2">
              {description}
            </p>
          )}

          {/* stats row */}
          {dataset.run && (
            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[var(--border)]">
              <div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                  Valid
                </div>
                <div className="text-sm font-medium text-[var(--success)]">
                  {formatNumber(dataset.run.records_valid)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                  Errors
                </div>
                <div
                  className={`text-sm font-medium ${
                    dataset.run.error_count > 0
                      ? "text-[var(--error)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  {formatNumber(dataset.run.error_count)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                  Last Run
                </div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">
                  {formatDate(dataset.run.ended_at)}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
}

export default function Dashboard() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
  const filteredDatasets = datasets.filter((d) => {
    const matchesIndustry = industryFilter === "all" || d.industry === industryFilter;
    const matchesStatus = statusFilter === "all" || d.status === statusFilter;
    return matchesIndustry && matchesStatus;
  });

  const totalRecords = datasets.reduce((sum, d) => sum + d.leadsCount, 0);
  const totalErrors = datasets.reduce((sum, d) => sum + (d.run?.error_count || 0), 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <Puffle className="w-7 h-7" />
            <span className="font-bold text-sm tracking-wide">ScrappyPuffle</span>
          </Link>
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.2em]">
            Data Dashboard
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 md:px-10 py-8">
        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"
        >
          {[
            { label: "Scrapers", value: datasets.length, color: "var(--text-primary)" },
            { label: "Total Records", value: formatNumber(totalRecords), color: "var(--accent)" },
            { label: "Industries", value: industries.length, color: "var(--text-primary)" },
            {
              label: "Errors",
              value: formatNumber(totalErrors),
              color: totalErrors > 0 ? "var(--error)" : "var(--text-primary)",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-[var(--bg-surface)] border border-[var(--border)] p-5"
            >
              <div
                className="text-2xl md:text-3xl font-bold"
                style={{ color: stat.color }}
              >
                {stat.value}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.15em] mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-8">
          {/* Status */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.15em] mr-1 w-14">
              Status
            </span>
            {[
              { key: "all", label: "All" },
              { key: "final", label: "Final" },
              { key: "in_progress", label: "In Progress" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 text-xs border transition-all ${
                  statusFilter === f.key
                    ? "bg-[var(--accent)] text-[var(--bg-primary)] border-[var(--accent)] font-bold"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Industry */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.15em] mr-1 w-14">
              Industry
            </span>
            <button
              onClick={() => setIndustryFilter("all")}
              className={`px-3 py-1.5 text-xs border transition-all ${
                industryFilter === "all"
                  ? "bg-[var(--accent)] text-[var(--bg-primary)] border-[var(--accent)] font-bold"
                  : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]"
              }`}
            >
              All
            </button>
            {industries.map((industry) => (
              <button
                key={industry}
                onClick={() => setIndustryFilter(industry)}
                className={`px-3 py-1.5 text-xs border transition-all ${
                  industryFilter === industry
                    ? "bg-[var(--accent)] text-[var(--bg-primary)] border-[var(--accent)] font-bold"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]"
                }`}
              >
                {getIndustryLabel(industry)}
              </button>
            ))}
          </div>
        </div>

        {/* Dataset cards */}
        {loading ? (
          <div className="text-center py-20 text-[var(--text-muted)]">
            <span className="blink">Loading datasets...</span>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filteredDatasets.map((dataset, i) => (
              <DatasetCard
                key={`${dataset.industry}/${dataset.scraper}`}
                dataset={dataset}
                delay={i * 0.04}
              />
            ))}
          </div>
        )}

        {!loading && filteredDatasets.length === 0 && (
          <div className="text-center py-20">
            <p className="text-[var(--text-muted)]">No datasets match your filters</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] mt-10">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puffle className="w-5 h-5" />
            <span className="text-xs text-[var(--text-muted)]">ScrappyPuffle</span>
          </div>
          <span className="text-[var(--text-muted)] text-xs">2025</span>
        </div>
      </footer>
    </div>
  );
}
