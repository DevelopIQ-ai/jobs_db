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
  entity_type: "person" | "company" | "both";
  status: "final" | "in_progress";
  run: RunData | null;
  readme: string;
  leadsCount: number;
  contactEnrichment: Record<string, number>;
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

/* ── Icons ───────────────────────────────────────────── */

function EmailIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
    </svg>
  );
}

function PhoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
    </svg>
  );
}

function LinkedinIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function TwitterIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function CrunchbaseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.6 0H2.4A2.4 2.4 0 000 2.4v19.2A2.4 2.4 0 002.4 24h19.2a2.4 2.4 0 002.4-2.4V2.4A2.4 2.4 0 0021.6 0zM7.045 14.465A2.11 2.11 0 019.84 13.42h.075a2.11 2.11 0 011.84-1.065c1.17 0 2.115.945 2.115 2.11s-.945 2.115-2.115 2.115a2.11 2.11 0 01-1.84-1.065H9.84a2.11 2.11 0 01-2.795-1.05zm9.91 2.115a2.11 2.11 0 01-2.115-2.115c0-1.17.945-2.11 2.115-2.11s2.115.94 2.115 2.11-.945 2.115-2.115 2.115z" />
    </svg>
  );
}

function PersonIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
    </svg>
  );
}

function CompanyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
    </svg>
  );
}

const contactIconMap: Record<string, { icon: React.FC<{ className?: string }>; label: string; color: string }> = {
  email: { icon: EmailIcon, label: "Email", color: "#f97316" },
  phone: { icon: PhoneIcon, label: "Phone", color: "#22c55e" },
  linkedin: { icon: LinkedinIcon, label: "LinkedIn", color: "#0a66c2" },
  twitter: { icon: TwitterIcon, label: "X", color: "#fff" },
  crunchbase: { icon: CrunchbaseIcon, label: "Crunchbase", color: "#ff6550" },
};

/* ── Entity type colors ──────────────────────────────── */

const entityBorderColor: Record<string, string> = {
  person: "#22c55e",
  company: "#eab308",
  both: "#a855f7",
};

/* ── Components ──────────────────────────────────────── */

function ContactEnrichmentRow({ enrichment }: { enrichment: Record<string, number> }) {
  const entries = Object.entries(enrichment);
  if (entries.length === 0) return null;

  const order = ["email", "phone", "linkedin", "twitter", "crunchbase"];
  const sorted = entries.sort(([a], [b]) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {sorted.map(([field, pct]) => {
        const entry = contactIconMap[field];
        const Icon = entry?.icon;
        const label = entry?.label || field;
        const color = entry?.color || "#888";
        const dim = pct < 5 ? 0.3 : pct < 25 ? 0.5 : 1;

        return (
          <span
            key={field}
            title={`${label}: ${pct}%`}
            className="inline-flex items-center gap-1"
            style={{ opacity: dim }}
          >
            {Icon ? (
              <span style={{ color }}>
                <Icon className="w-3.5 h-3.5" />
              </span>
            ) : (
              <span className="text-[10px]" style={{ color }}>{field}</span>
            )}
            <span className="text-[10px] text-[#666] font-mono">{pct}%</span>
          </span>
        );
      })}
    </div>
  );
}

function DatasetCard({ dataset, delay }: { dataset: Dataset; delay: number }) {
  const isFinal = dataset.status === "final";
  const hasEnrichment = Object.keys(dataset.contactEnrichment).length > 0;
  const topColor = entityBorderColor[dataset.entity_type] || "#888";

  return (
    <Link href={`/dashboard/${dataset.industry}/${dataset.scraper}`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.2 }}
        className="bg-[#111] border border-[#333] hover:border-[#555] transition-all cursor-pointer group"
        style={{ borderTopColor: topColor, borderTopWidth: 2 }}
      >
        <div className="p-4">
          {/* Row 1: name + count */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-bold text-sm text-white group-hover:text-[#ccc] transition-colors truncate flex-1">
              {dataset.scraper.replace(/-/g, " ").replace(/scraper/i, "").trim() || dataset.scraper}
            </h3>
            <span className="text-lg font-bold text-white shrink-0">
              {formatNumber(dataset.leadsCount)}
            </span>
          </div>

          {/* Row 2: industry + wip */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] uppercase tracking-[0.15em] text-[#666] border border-[#333] px-2 py-0.5">
              {getIndustryLabel(dataset.industry)}
            </span>
            {!isFinal && (
              <span className="text-[10px] uppercase tracking-[0.15em] text-[#555] border border-[#333] border-dashed px-2 py-0.5">
                WIP
              </span>
            )}
          </div>

          {/* Row 3: enrichment + error % */}
          {(hasEnrichment || (dataset.run && dataset.run.records_found > 0)) && (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#222]">
              {hasEnrichment ? (
                <ContactEnrichmentRow enrichment={dataset.contactEnrichment} />
              ) : (
                <span />
              )}
              {dataset.run && dataset.run.records_found > 0 && (
                <span className={`text-[10px] font-mono shrink-0 ${
                  dataset.run.error_count > 0 ? "text-[#888]" : "text-[#444]"
                }`}>
                  {Math.round((dataset.run.error_count / dataset.run.records_found) * 100)}% err
                </span>
              )}
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

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-[#222]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <span className="font-bold text-sm tracking-wide text-white">ScrappyPuffle</span>
          <span className="text-[10px] text-[#555] uppercase tracking-[0.2em]">
            {formatNumber(totalRecords)} records
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 md:px-10 py-6">
        {/* Filters */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[#555] uppercase tracking-[0.15em] mr-1 w-14">
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
                    ? "bg-white text-black border-white font-bold"
                    : "bg-[#111] text-[#888] border-[#333] hover:border-[#666]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[#555] uppercase tracking-[0.15em] mr-1 w-14">
              Industry
            </span>
            <button
              onClick={() => setIndustryFilter("all")}
              className={`px-3 py-1.5 text-xs border transition-all ${
                industryFilter === "all"
                  ? "bg-white text-black border-white font-bold"
                  : "bg-[#111] text-[#888] border-[#333] hover:border-[#666]"
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
                    ? "bg-white text-black border-white font-bold"
                    : "bg-[#111] text-[#888] border-[#333] hover:border-[#666]"
                }`}
              >
                {getIndustryLabel(industry)}
              </button>
            ))}
          </div>
        </div>

        {/* Dataset cards */}
        {loading ? (
          <div className="text-center py-20 text-[#555]">
            Loading datasets...
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredDatasets.map((dataset, i) => (
              <DatasetCard
                key={`${dataset.industry}/${dataset.scraper}`}
                dataset={dataset}
                delay={i * 0.03}
              />
            ))}
          </div>
        )}

        {!loading && filteredDatasets.length === 0 && (
          <div className="text-center py-20">
            <p className="text-[#555]">No datasets match your filters</p>
          </div>
        )}
      </main>
    </div>
  );
}
