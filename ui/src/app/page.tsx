"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

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
      <ellipse
        cx="45"
        cy="50"
        rx="8"
        ry="10"
        fill="#E8E8F0"
        stroke="#FF853360"
        strokeWidth="1"
      />
      <ellipse
        cx="72"
        cy="50"
        rx="8"
        ry="10"
        fill="#E8E8F0"
        stroke="#FF853360"
        strokeWidth="1"
      />
      <circle cx="47" cy="52" r="4" fill="#0C0C14" />
      <circle cx="74" cy="52" r="4" fill="#0C0C14" />
      <circle cx="48.5" cy="50.5" r="1.5" fill="white" />
      <circle cx="75.5" cy="50.5" r="1.5" fill="white" />
      <path
        d="M50 18 Q55 5 60 15 Q62 8 65 18"
        fill="none"
        stroke="#FF8533"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Terminal animation ──────────────────────────────────── */

const terminalLines = [
  { type: "cmd", text: "> scanning linkedin.com/posts..." },
  { type: "ok", text: "  ✓ 847 posts from CU executives" },
  { type: "cmd", text: "> cross-referencing ncua.gov..." },
  { type: "ok", text: "  ✓ 23 active credit unions matched" },
  { type: "cmd", text: "> analyzing hiring signals..." },
  { type: "ok", text: "  ✓ 8 expanding, 3 switching vendors" },
  { type: "cmd", text: "> building target list..." },
  { type: "ok", text: "  ✓ 12 qualified leads ready" },
];

function TerminalDemo() {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible >= terminalLines.length) return;
    const delay = terminalLines[visible]?.type === "cmd" ? 700 : 400;
    const timer = setTimeout(() => setVisible((v) => v + 1), delay);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <div className="terminal rounded-none">
      {/* title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] relative z-10">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FF4444]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#FFB800]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[var(--success)]" />
        <span className="ml-3 text-[var(--text-muted)] text-xs">
          scrappypuffle v0.1
        </span>
      </div>

      {/* body */}
      <div className="p-5 font-mono text-[13px] leading-relaxed relative z-10 min-h-[260px]">
        {terminalLines.slice(0, visible).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className={
              line.type === "cmd"
                ? "text-[var(--accent)]"
                : "text-[var(--success)]"
            }
          >
            {line.text}
          </motion.div>
        ))}
        {visible < terminalLines.length && (
          <span className="text-[var(--accent)] blink">█</span>
        )}
        {visible >= terminalLines.length && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-4 pt-3 border-t border-[var(--border)]"
          >
            <span className="text-[var(--text-muted)]">
              ─── complete ──────────
            </span>
            <div className="text-[var(--accent-bright)] mt-1 font-bold">
              12 leads ready &middot; avg confidence 87%
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ── Data source cards ───────────────────────────────────── */

const industryDataSources: Record<
  string,
  { posts: string[]; organizations: string[]; people: string[]; context: string[] }
> = {
  "Credit unions": {
    posts: [
      "LinkedIn posts from CU executives",
      "CUNA community discussions",
      "CU Times articles & comments",
    ],
    organizations: [
      "NCUA charter database",
      "State credit union leagues",
      "CUNA membership lists",
    ],
    people: [
      "CEOs & Presidents",
      "Lending officers",
      "IT directors",
      "Board members",
    ],
    context: [
      "Asset size & membership count",
      "Recent merger activity",
      "Core system vendor hints",
      "Branch expansion patterns",
    ],
  },
  "Real estate developers": {
    posts: [
      "LinkedIn project announcements",
      "Local news mentions",
      "Permit application discussions",
    ],
    organizations: [
      "State contractor registries",
      "ULI membership",
      "Local RE associations",
    ],
    people: [
      "Principals & partners",
      "Development managers",
      "Acquisition directors",
    ],
    context: [
      "Active project pipeline",
      "Property type focus",
      "Geographic markets",
      "Recent capital raises",
    ],
  },
  "SaaS startups": {
    posts: [
      "Founder Twitter/X threads",
      "Product Hunt launches",
      "HN Show posts",
    ],
    organizations: [
      "YC/Techstars batches",
      "AngelList profiles",
      "Crunchbase records",
    ],
    people: [
      "Founders & co-founders",
      "Head of Growth",
      "First sales hires",
    ],
    context: [
      "Funding stage & runway",
      "Tech stack signals",
      "Hiring velocity",
      "Product launch timing",
    ],
  },
  "Law firms": {
    posts: [
      "JD Supra articles",
      "LinkedIn thought leadership",
      "Legal blog posts",
    ],
    organizations: [
      "State bar associations",
      "Am Law rankings",
      "Practice area directories",
    ],
    people: [
      "Managing partners",
      "Practice group heads",
      "Of counsel",
      "Associates",
    ],
    context: [
      "Firm size & structure",
      "Practice area mix",
      "Recent lateral moves",
      "Office expansion",
    ],
  },
  "Local contractors": {
    posts: [
      "Nextdoor recommendations",
      "Google review responses",
      "Facebook project photos",
    ],
    organizations: [
      "State licensing boards",
      "BBB listings",
      "Trade association memberships",
    ],
    people: ["Owners & operators", "Project managers", "Estimators"],
    context: [
      "Service area radius",
      "Specialty focus",
      "Crew size indicators",
      "Seasonal patterns",
    ],
  },
};

const defaultDataSources = {
  posts: [
    "LinkedIn posts",
    "Twitter / X posts",
    "Comments & engagement",
    "Job postings",
  ],
  organizations: [
    "Industry directories",
    "Local and regional registries",
    "Regulatory filings",
    "Trade associations",
  ],
  people: [
    "Executives & decision-makers",
    "Department heads",
    "Recent hires",
    "Board members",
  ],
  context: [
    "Company size & region",
    "Recent changes (hiring, expansion)",
    "Tech hints from posts and jobs",
    "Activity patterns",
  ],
};

function DataSourceCard({
  title,
  items,
  delay,
}: {
  title: string;
  items: string[];
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className="bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] transition-all group"
    >
      {/* card header bar */}
      <div className="px-5 py-2.5 border-b border-[var(--border)] flex items-center gap-2 group-hover:border-[var(--accent)] transition-colors">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
          {title}
        </span>
      </div>
      <ul className="p-5 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="text-[var(--text-secondary)] text-[13px] flex items-start gap-2"
          >
            <span className="text-[var(--text-muted)] mt-0.5 shrink-0">
              &rsaquo;
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */

export default function Home() {
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [customIndustry, setCustomIndustry] = useState("");
  const industries = Object.keys(industryDataSources);

  const currentDataSources =
    selectedIndustry && industryDataSources[selectedIndustry]
      ? industryDataSources[selectedIndustry]
      : defaultDataSources;

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────── */}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Puffle className="w-7 h-7" />
            <span className="font-bold text-sm tracking-wide">
              ScrappyPuffle
            </span>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors tracking-wide uppercase"
          >
            Dashboard &rarr;
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pt-16 pb-24 md:pt-24 md:pb-32">
        <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
          {/* left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-6">
              Outreach Intelligence
            </p>

            <h1 className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold leading-[1.15] mb-6">
              Early adopters,{" "}
              <span
                className="hand text-4xl md:text-5xl lg:text-[3.5rem]"
                style={{ color: "var(--accent)" }}
              >
                not cold strangers
              </span>
            </h1>

            <p className="text-[var(--text-secondary)] text-sm md:text-base max-w-md mb-10 leading-relaxed">
              We scan posts, directories, and signals across the web before
              showing you a single name &mdash; so outreach feels{" "}
              <em>obvious</em>, not awkward.
            </p>

            <div className="flex flex-col sm:flex-row items-start gap-4">
              <button className="bg-[var(--accent)] text-[var(--bg-primary)] px-6 py-3 font-bold text-sm hover:bg-[var(--accent-bright)] transition-all glow-sm hover:glow-md">
                Find my early adopters &rarr;
              </button>
              <span className="text-[var(--text-muted)] text-xs py-3">
                Most searches return 10&ndash;25 people.
              </span>
            </div>
          </motion.div>

          {/* right: terminal */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <TerminalDemo />
          </motion.div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="gradient-divider" />
      </div>

      {/* ── Data Sources ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-24 md:py-32">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-14"
        >
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-3">
            What we read
          </p>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            We don&apos;t guess.{" "}
            <span
              className="hand text-3xl md:text-4xl"
              style={{ color: "var(--accent)" }}
            >
              We read.
            </span>
          </h2>
          <p className="text-[var(--text-secondary)] max-w-lg text-sm">
            Pick an industry below. We&apos;ll show you what we actually look at
            before returning results.
          </p>
        </motion.div>

        {/* industry selector */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4">
            What do you sell to?
          </p>

          <div className="flex flex-wrap gap-2 mb-6">
            {industries.map((industry) => (
              <button
                key={industry}
                onClick={() => {
                  setSelectedIndustry(industry);
                  setCustomIndustry("");
                }}
                className={`px-4 py-2 text-xs border transition-all ${
                  selectedIndustry === industry
                    ? "bg-[var(--accent)] text-[var(--bg-primary)] border-[var(--accent)] glow-sm font-bold"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                }`}
              >
                {industry}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Or type your industry..."
            value={customIndustry}
            onChange={(e) => {
              setCustomIndustry(e.target.value);
              setSelectedIndustry("");
            }}
            className="w-full max-w-md px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm transition-colors"
          />
        </motion.div>

        {/* data sources grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedIndustry || "default"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid md:grid-cols-2 gap-4"
          >
            <DataSourceCard
              title="Posts & Activity"
              items={currentDataSources.posts}
              delay={0}
            />
            <DataSourceCard
              title="Orgs & Directories"
              items={currentDataSources.organizations}
              delay={0.05}
            />
            <DataSourceCard
              title="People"
              items={currentDataSources.people}
              delay={0.1}
            />
            <DataSourceCard
              title="Context & Signals"
              items={currentDataSources.context}
              delay={0.15}
            />
          </motion.div>
        </AnimatePresence>

        <p className="text-[var(--text-muted)] text-xs mt-8">
          * Not every source applies to every industry. We adapt signals to what
          actually matters.
        </p>
      </section>

      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="gradient-divider" />
      </div>

      {/* ── How it works ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-24 md:py-32">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-14"
        >
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-3">
            Process
          </p>
          <h2 className="text-2xl md:text-3xl font-bold">
            How it{" "}
            <span
              className="hand text-3xl md:text-4xl"
              style={{ color: "var(--accent)" }}
            >
              works
            </span>
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-0">
          {[
            {
              step: "01",
              title: "You describe your buyer",
              description:
                "Tell us who you're looking for. Industry, role, company size — whatever matters.",
            },
            {
              step: "02",
              title: "We read and cross-check",
              description:
                "We scan posts, directories, and signals. Then we throw away the noise.",
            },
            {
              step: "03",
              title: "You get a short list",
              description:
                "10–25 people who make sense. Not a thousand names you'll never call.",
            },
          ].map((item, index) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative p-8 border border-[var(--border)] bg-[var(--bg-surface)]"
            >
              <span className="text-[var(--accent)] text-3xl font-bold block mb-4">
                {item.step}
              </span>
              <h3 className="font-bold text-base mb-3">{item.title}</h3>
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                {item.description}
              </p>
              {/* connector arrow (hidden on last + mobile) */}
              {index < 2 && (
                <span className="hidden md:block absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 text-[var(--accent)] text-lg z-10">
                  &rarr;
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="gradient-divider" />
      </div>

      {/* ── CTA ────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-24 md:py-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div className="inline-block mb-8" style={{ filter: "drop-shadow(0 0 20px rgba(255,107,0,0.3))" }}>
            <Puffle className="w-16 h-16" />
          </div>

          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to find{" "}
            <span
              className="hand text-3xl md:text-4xl"
              style={{ color: "var(--accent)" }}
            >
              your people?
            </span>
          </h2>

          <p className="text-[var(--text-secondary)] mb-10 max-w-md mx-auto text-sm">
            Stop guessing. Start reaching out to people who actually make sense.
          </p>

          <button className="bg-[var(--accent)] text-[var(--bg-primary)] px-8 py-4 font-bold text-sm hover:bg-[var(--accent-bright)] transition-all glow-sm hover:glow-md">
            Get started &rarr;
          </button>
        </motion.div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puffle className="w-5 h-5" />
            <span className="text-xs text-[var(--text-muted)]">
              ScrappyPuffle
            </span>
          </div>
          <span className="text-[var(--text-muted)] text-xs">2025</span>
        </div>
      </footer>
    </div>
  );
}
