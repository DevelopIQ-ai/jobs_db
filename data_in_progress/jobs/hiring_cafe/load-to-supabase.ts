import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as readline from 'readline';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INPUT_FILE = process.argv[2] || `${__dirname}/output/leads.jsonl`;
const BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Rows loaded before the collapse_key keying was adopted carry primary_key =
// job_id, so upserts on primary_key miss them and would duplicate. Upsert
// first (existing rows stay intact if the load fails), then delete only the
// legacy-format rows: collapse_key matches a loaded job but primary_key does
// not, which only the old job_id-keyed rows satisfy.
async function loadBatch(batch: any[], offset: number): Promise<number> {
  const keys = batch.map((row) => row.collapse_key).filter(Boolean);
  const { error } = await supabase
    .from('ds_hiring_cafe')
    .upsert(batch, { onConflict: 'primary_key' });
  if (error) {
    console.error(`Upsert error at ${offset}:`, error.message);
    return 1;
  }
  const { error: deleteError } = await supabase
    .from('ds_hiring_cafe')
    .delete()
    .in('collapse_key', keys)
    .not('primary_key', 'in', `(${keys.map((k) => `"${String(k).replace(/"/g, '\\"')}"`).join(',')})`);
  if (deleteError) {
    console.error(`Legacy-row cleanup error at ${offset}:`, deleteError.message);
    return 1;
  }
  return 0;
}

// leads.jsonl rows follow the LeadRecord contract (core/company/contact/
// context); ds_hiring_cafe stays flat, so unwrap context back to columns.
// primary_key = context.collapse_key so the upsert key is the same identity
// the contract primary_key uses (scraper fills collapse_key from job_id when
// the site omits it).
function transformRecord(record: any) {
  const job = record.context || {};
  return {
    primary_key: job.collapse_key,
    scraped_at: record.core?.scraped_at,
    collapse_key: job.collapse_key,
    source: job.source,
    apply_url: job.apply_url,
    title: job.title,
    description_md: job.description_md,
    workplace_type: job.workplace_type,
    locations: job.locations,
    commitment: job.commitment,
    seniority_level: job.seniority_level,
    salary_min_yearly: job.salary_min_yearly,
    salary_max_yearly: job.salary_max_yearly,
    company_domain: job.company_domain,
    company_name: record.company?.company_name,
    company_industry: job.company_industry,
    company_hq_country: job.company_hq_country,
    company_employee_count: job.company_employee_count,
    company_year_founded: job.company_year_founded,
    company_organization_type: job.company_organization_type,
    funding_type: job.funding_type,
    funding_year: job.funding_year,
    funding_amount: job.funding_amount,
    funding_investors: job.funding_investors,
    stock_exchange: job.stock_exchange,
    stock_symbol: job.stock_symbol,
  };
}

async function main() {
  console.log('Loading jobs into Supabase...');

  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch: any[] = [];
  let total = 0;
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const job = JSON.parse(line);
      batch.push(transformRecord(job));

      if (batch.length >= BATCH_SIZE) {
        errors += await loadBatch(batch, total);
        total += batch.length;
        process.stdout.write(`\rInserted: ${total.toLocaleString()}`);
        batch = [];
      }
    } catch (err) {
      errors++;
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    errors += await loadBatch(batch, total);
    total += batch.length;
  }

  console.log(`\n\nComplete! Loaded ${total.toLocaleString()} jobs with ${errors} errors.`);
}

main().catch(console.error);
