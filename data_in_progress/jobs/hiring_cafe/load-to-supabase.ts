import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as readline from 'readline';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INPUT_FILE = process.argv[2] || `${__dirname}/output/us-jobs-ssr.jsonl`;
const BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function transformRecord(job: any) {
  return {
    primary_key: job.job_id,
    scraped_at: job.scraped_at,
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
    company_name: job.company_name,
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
        const { error } = await supabase
          .from('ds_hiring_cafe')
          .upsert(batch, { onConflict: 'primary_key' });
        if (error) {
          console.error(`Batch error at ${total}:`, error.message);
          errors++;
        }
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
    const { error } = await supabase
      .from('ds_hiring_cafe')
      .upsert(batch, { onConflict: 'primary_key' });
    if (error) {
      console.error(`Final batch error:`, error.message);
      errors++;
    }
    total += batch.length;
  }

  console.log(`\n\nComplete! Upserted ${total.toLocaleString()} jobs with ${errors} errors.`);
}

main().catch(console.error);
