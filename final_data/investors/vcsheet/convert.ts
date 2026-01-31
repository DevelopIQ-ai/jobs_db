/**
 * Converts VCSheet scraped JSON to proper JSONL format per DATA-RULES.md
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE_ID = 'investors/vcsheet';
const INPUT_FILE = '/Users/kushbhuwalka/Documents/developiq/scrappypuffle/industries_in_progress/investors/vcsheet-scraper/output/scrape-progress.json';
const OUTPUT_DIR = path.join(__dirname, 'output');
const LEADS_FILE = path.join(OUTPUT_DIR, 'leads.jsonl');
const RUN_FILE = path.join(OUTPUT_DIR, 'run.json');

interface ScrapedFund {
  name: string;
  slug: string;
  profileUrl: string;
  description: string | null;
  location: string | null;
  website: string | null;
  linkedIn: string | null;
  twitter: string | null;
  crunchbase: string | null;
  email: string | null;
  checkSizeMin: string | null;
  checkSizeMax: string | null;
  checkSizeRaw: string | null;
  investmentStages: string[];
  canLead: boolean | null;
  geographies: string[];
  sectors: string[];
  teamMembers: { name: string; role: string | null }[];
  portfolioCompanies: string[];
  scrapedAt: string;
}

interface LeadRecord {
  core: {
    source_id: string;
    entity_type: 'company';
    scraped_at: string;
    raw_url: string;
    primary_key: string;
  };
  company: {
    company_name: string;
    domain?: string;
    industry?: string;
    profile_url?: string;
  };
  contact: {
    email?: string;
    website?: string;
    socials?: { platform: string; url: string }[];
    location?: {
      city?: string;
      state?: string;
      country?: string;
    };
  };
  context: Record<string, unknown>;
}

function parseLocation(loc: string | null): { city?: string; state?: string; country?: string } {
  if (!loc) return {};
  const parts = loc.split(',').map(p => p.trim());
  if (parts.length === 2) {
    return { city: parts[0], state: parts[1], country: 'USA' };
  } else if (parts.length === 1) {
    return { city: parts[0] };
  }
  return { city: loc };
}

function convertFundToLead(fund: ScrapedFund): LeadRecord {
  const socials: { platform: string; url: string }[] = [];
  if (fund.linkedIn) socials.push({ platform: 'linkedin', url: fund.linkedIn });
  if (fund.twitter) socials.push({ platform: 'twitter', url: fund.twitter });
  if (fund.crunchbase) socials.push({ platform: 'crunchbase', url: fund.crunchbase });

  return {
    core: {
      source_id: SOURCE_ID,
      entity_type: 'company',
      scraped_at: fund.scrapedAt,
      raw_url: fund.profileUrl,
      primary_key: `${SOURCE_ID}:url:${fund.profileUrl}`
    },
    company: {
      company_name: fund.name,
      industry: 'Venture Capital',
      profile_url: fund.profileUrl
    },
    contact: {
      email: fund.email || undefined,
      website: fund.website || undefined,
      socials: socials.length > 0 ? socials : undefined,
      location: parseLocation(fund.location)
    },
    context: {
      slug: fund.slug,
      description: fund.description,
      check_size_raw: fund.checkSizeRaw,
      check_size_min: fund.checkSizeMin,
      check_size_max: fund.checkSizeMax,
      investment_stages: fund.investmentStages,
      can_lead: fund.canLead,
      geographies: fund.geographies,
      sectors: fund.sectors,
      team_members: fund.teamMembers.length > 0 ? fund.teamMembers : undefined,
      portfolio_companies: fund.portfolioCompanies.length > 0 ? fund.portfolioCompanies : undefined
    }
  };
}

function main() {
  const startedAt = new Date().toISOString();

  // Read input
  const rawData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const funds: ScrapedFund[] = rawData.funds;

  console.log(`Converting ${funds.length} funds to JSONL format...`);

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Convert and write JSONL
  const leads: string[] = [];
  let validCount = 0;
  let errorCount = 0;

  for (const fund of funds) {
    try {
      const lead = convertFundToLead(fund);
      leads.push(JSON.stringify(lead));
      validCount++;
    } catch (e) {
      console.error(`Error converting ${fund.name}: ${e}`);
      errorCount++;
    }
  }

  fs.writeFileSync(LEADS_FILE, leads.join('\n'));

  const endedAt = new Date().toISOString();

  // Write run.json
  const runJson = {
    source_id: SOURCE_ID,
    run_id: `run_${Date.now()}`,
    started_at: startedAt,
    ended_at: endedAt,
    records_found: funds.length,
    records_valid: validCount,
    records_written: validCount,
    error_count: errorCount
  };

  fs.writeFileSync(RUN_FILE, JSON.stringify(runJson, null, 2));

  console.log(`Done! Wrote ${validCount} records to ${LEADS_FILE}`);
  console.log(`Run metadata: ${RUN_FILE}`);
}

main();
