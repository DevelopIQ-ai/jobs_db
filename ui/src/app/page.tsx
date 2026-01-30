"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

function DottedDivider() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-12 py-1">
      <div className="border-t-2 border-dotted border-gray-300" />
    </div>
  );
}

const industryDataSources: Record<string, {
  posts: string[];
  organizations: string[];
  people: string[];
  context: string[];
}> = {
  "Credit unions": {
    posts: ["LinkedIn posts from CU executives", "CUNA community discussions", "CU Times articles & comments"],
    organizations: ["NCUA charter database", "State credit union leagues", "CUNA membership lists"],
    people: ["CEOs & Presidents", "Lending officers", "IT directors", "Board members"],
    context: ["Asset size & membership count", "Recent merger activity", "Core system vendor hints", "Branch expansion patterns"],
  },
  "Real estate developers": {
    posts: ["LinkedIn project announcements", "Local news mentions", "Permit application discussions"],
    organizations: ["State contractor registries", "ULI membership", "Local RE associations"],
    people: ["Principals & partners", "Development managers", "Acquisition directors"],
    context: ["Active project pipeline", "Property type focus", "Geographic markets", "Recent capital raises"],
  },
  "SaaS startups": {
    posts: ["Founder Twitter/X threads", "Product Hunt launches", "HN Show posts"],
    organizations: ["YC/Techstars batches", "AngelList profiles", "Crunchbase records"],
    people: ["Founders & co-founders", "Head of Growth", "First sales hires"],
    context: ["Funding stage & runway", "Tech stack signals", "Hiring velocity", "Product launch timing"],
  },
  "Law firms": {
    posts: ["JD Supra articles", "LinkedIn thought leadership", "Legal blog posts"],
    organizations: ["State bar associations", "Am Law rankings", "Practice area directories"],
    people: ["Managing partners", "Practice group heads", "Of counsel", "Associates"],
    context: ["Firm size & structure", "Practice area mix", "Recent lateral moves", "Office expansion"],
  },
  "Local contractors": {
    posts: ["Nextdoor recommendations", "Google review responses", "Facebook project photos"],
    organizations: ["State licensing boards", "BBB listings", "Trade association memberships"],
    people: ["Owners & operators", "Project managers", "Estimators"],
    context: ["Service area radius", "Specialty focus", "Crew size indicators", "Seasonal patterns"],
  },
};

const defaultDataSources = {
  posts: ["LinkedIn posts", "Twitter / X posts", "Comments & engagement", "Job postings"],
  organizations: ["Industry directories", "Local and regional registries", "Regulatory filings", "Trade associations"],
  people: ["Executives & decision-makers", "Department heads", "Recent hires", "Board members"],
  context: ["Company size & region", "Recent changes (hiring, expansion)", "Tech hints from posts and jobs", "Activity patterns"],
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
      transition={{ delay, duration: 0.25 }}
      className="bg-white border border-gray-200 p-6"
    >
      <h4 className="text-xs uppercase tracking-widest text-gray-500 mb-4">{title}</h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="text-gray-900 text-sm">{item}</li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function Home() {
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [customIndustry, setCustomIndustry] = useState("");
  const industries = Object.keys(industryDataSources);

  const currentDataSources = selectedIndustry && industryDataSources[selectedIndustry]
    ? industryDataSources[selectedIndustry]
    : defaultDataSources;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="max-w-4xl mx-auto px-6 md:px-12 py-6">
        <div className="flex items-center gap-3">
          <Puffle className="w-8 h-8" />
          <span className="font-bold">ScrappyPuffle</span>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 md:px-12 pt-12 pb-20 md:pt-20 md:pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight mb-6">
            Early adopters,{" "}
            <span className="hand text-4xl md:text-5xl lg:text-6xl" style={{ color: "#E85D04" }}>
              not cold strangers
            </span>
          </h1>

          <p className="text-gray-600 text-base md:text-lg max-w-xl mb-10">
            We read posts, activity, and local directories before showing you a single name,
            so outreach feels obvious, not awkward.
          </p>

          <div className="flex flex-col sm:flex-row items-start gap-4">
            <button className="bg-gray-900 text-white px-6 py-3 font-bold hover:bg-orange-600 transition-colors">
              Find my early adopters →
            </button>
            <span className="text-gray-500 text-sm py-3">
              Most searches return 10–25 people.
            </span>
          </div>
        </motion.div>
      </section>

      <DottedDivider />

      {/* Data Sources */}
      <section className="max-w-4xl mx-auto px-6 md:px-12 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-14"
        >
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">How we work</p>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            We don&apos;t guess.{" "}
            <span className="hand text-3xl md:text-4xl" style={{ color: "#E85D04" }}>We read.</span>
          </h2>
          <p className="text-gray-600 max-w-lg">
            Pick an industry below. We&apos;ll show you what we actually look at before returning results.
          </p>
        </motion.div>

        {/* Industry selector */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10"
        >
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-4">What do you sell to?</p>

          <div className="flex flex-wrap gap-2 mb-6">
            {industries.map((industry) => (
              <button
                key={industry}
                onClick={() => {
                  setSelectedIndustry(industry);
                  setCustomIndustry("");
                }}
                className={`px-4 py-2 text-sm border transition-colors ${
                  selectedIndustry === industry
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-900 border-gray-300 hover:border-gray-900"
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
            className="w-full max-w-md px-4 py-3 bg-white border border-gray-300 focus:border-gray-900 outline-none placeholder:text-gray-400"
          />
        </motion.div>

        {/* Data sources grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedIndustry || "default"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid md:grid-cols-2 gap-4"
          >
            <DataSourceCard title="Posts & Activity" items={currentDataSources.posts} delay={0} />
            <DataSourceCard title="Organizations & Directories" items={currentDataSources.organizations} delay={0.05} />
            <DataSourceCard title="People" items={currentDataSources.people} delay={0.1} />
            <DataSourceCard title="Context & Signals" items={currentDataSources.context} delay={0.15} />
          </motion.div>
        </AnimatePresence>

        <p className="text-gray-500 text-sm mt-8">
          * Not every source applies to every industry. We adapt signals to what actually matters.
        </p>
      </section>

      <DottedDivider />

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 md:px-12 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-14"
        >
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">Process</p>
          <h2 className="text-2xl md:text-3xl font-bold">
            How it{" "}
            <span className="hand text-3xl md:text-4xl" style={{ color: "#E85D04" }}>works</span>
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-10">
          {[
            { step: "01", title: "You describe your buyer", description: "Tell us who you're looking for. Industry, role, size — whatever matters." },
            { step: "02", title: "We read and cross-check", description: "We scan posts, directories, and signals. Then we throw away the noise." },
            { step: "03", title: "You get a short list", description: "10–25 people who make sense. Not a thousand names you'll never call." },
          ].map((item, index) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <span className="text-gray-400 text-xs tracking-widest">{item.step}</span>
              <h3 className="font-bold text-lg mt-2 mb-3">{item.title}</h3>
              <p className="text-gray-600 text-sm">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <DottedDivider />

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 md:px-12 py-20 md:py-28 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <Puffle className="w-16 h-16 mx-auto mb-8" />

          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to find{" "}
            <span className="hand text-3xl md:text-4xl" style={{ color: "#E85D04" }}>your people?</span>
          </h2>

          <p className="text-gray-600 mb-10 max-w-md mx-auto">
            Stop guessing. Start reaching out to people who actually make sense.
          </p>

          <button className="bg-gray-900 text-white px-8 py-4 font-bold hover:bg-orange-600 transition-colors">
            Get started →
          </button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 md:px-12 py-8 border-t border-gray-200">
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
