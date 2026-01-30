/**
 * Lead Enrichment Script
 *
 * Enriches property manager leads with:
 * - Contact name (parsed from email)
 * - Website domain (extracted from email)
 * - Phone number (scraped from website)
 * - Website title/description
 *
 * Usage:
 *   npx tsx enricher.ts                    # Enrich all leads
 *   npx tsx enricher.ts --test             # Test with first 10 leads
 *   npx tsx enricher.ts --start 100        # Start from row 100
 *   npx tsx enricher.ts --limit 50         # Only process 50 leads
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

interface Lead {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  tagline: string;
  propertyTypes: string;
  propertyTypeCategories: string;
  isFeatured: string;
  logoUrl: string;
  additionalOffices: string;
  scrapedAt: string;
}

interface EnrichedLead extends Lead {
  // Derived from email
  contactFirstName: string;
  contactLastName: string;
  contactFullName: string;
  domain: string;
  websiteUrl: string;

  // Scraped from website
  phone: string;
  websiteTitle: string;
  websiteDescription: string;

  // Metadata
  enrichedAt: string;
  enrichmentErrors: string;
}

interface EnrichmentProgress {
  lastProcessedIndex: number;
  totalProcessed: number;
  totalErrors: number;
  startedAt: string;
  lastUpdatedAt: string;
}

// =============================================================================
// CSV Parsing
// =============================================================================

function parseCSV(content: string): Lead[] {
  const lines = content.trim().split('\n');
  const headers = parseCSVLine(lines[0]);

  const leads: Lead[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    leads.push({
      id: values[0] || '',
      name: values[1] || '',
      street: values[2] || '',
      city: values[3] || '',
      state: values[4] || '',
      zip: values[5] || '',
      email: values[6] || '',
      tagline: values[7] || '',
      propertyTypes: values[8] || '',
      propertyTypeCategories: values[9] || '',
      isFeatured: values[10] || '',
      logoUrl: values[11] || '',
      additionalOffices: values[12] || '',
      scrapedAt: values[13] || '',
    });
  }

  return leads;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

// =============================================================================
// Enrichment Functions
// =============================================================================

function parseNameFromEmail(email: string): { firstName: string; lastName: string; fullName: string } {
  if (!email || !email.includes('@')) {
    return { firstName: '', lastName: '', fullName: '' };
  }

  const localPart = email.split('@')[0].toLowerCase();

  // Common patterns:
  // john.doe@company.com -> John Doe
  // johndoe@company.com -> Johndoe (can't split reliably)
  // john_doe@company.com -> John Doe
  // jdoe@company.com -> J Doe
  // john.d@company.com -> John D

  // Remove common prefixes/suffixes that aren't names
  const cleanLocal = localPart
    .replace(/^(info|contact|sales|support|admin|hello|team|office|enquiries|inquiries)$/, '')
    .replace(/^\d+/, '') // Remove leading numbers
    .replace(/\d+$/, ''); // Remove trailing numbers

  if (!cleanLocal) {
    return { firstName: '', lastName: '', fullName: '' };
  }

  // Split by common separators
  const parts = cleanLocal.split(/[._-]/).filter(p => p.length > 0);

  if (parts.length >= 2) {
    const firstName = capitalize(parts[0]);
    const lastName = capitalize(parts[parts.length - 1]);
    return { firstName, lastName, fullName: `${firstName} ${lastName}` };
  } else if (parts.length === 1) {
    // Single part - could be first name or first initial + last name
    const part = parts[0];
    if (part.length <= 1) {
      return { firstName: '', lastName: '', fullName: '' };
    }
    // If it looks like "jsmith" (1 char + rest), try to split
    if (part.length > 3 && /^[a-z][a-z]+$/.test(part)) {
      // Could be firstlast or flast - hard to tell, just capitalize whole thing
      return { firstName: capitalize(part), lastName: '', fullName: capitalize(part) };
    }
    return { firstName: capitalize(part), lastName: '', fullName: capitalize(part) };
  }

  return { firstName: '', lastName: '', fullName: '' };
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function extractDomain(email: string): string {
  if (!email || !email.includes('@')) return '';

  // Handle multiple emails (comma-separated)
  const firstEmail = email.split(',')[0].trim();
  const domain = firstEmail.split('@')[1];

  if (!domain) return '';

  // Skip generic email providers
  const genericDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'mail.com', 'protonmail.com', 'live.com', 'msn.com',
    'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net',
  ];

  if (genericDomains.includes(domain.toLowerCase())) {
    return '';
  }

  return domain.toLowerCase();
}

async function scrapeWebsite(url: string): Promise<{ phone: string; title: string; description: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { phone: '', title: '', description: '' };
    }

    const html = await response.text();

    // Extract phone - prioritize tel: links which are most reliable
    let phone = '';

    // Method 1: Look for tel: links (most reliable)
    const telLinkMatch = html.match(/href=["']tel:([^"']+)["']/i);
    if (telLinkMatch) {
      phone = cleanPhoneNumber(telLinkMatch[1]);
    }

    // Method 2: Look for phone numbers near keywords
    if (!phone) {
      // Find text near "phone", "call", "tel", "contact"
      const phoneContextRegex = /(?:phone|call|tel|contact)[^0-9]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/gi;
      const contextMatch = html.match(phoneContextRegex);
      if (contextMatch) {
        const numMatch = contextMatch[0].match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (numMatch) {
          phone = cleanPhoneNumber(numMatch[0]);
        }
      }
    }

    // Method 3: Look in common phone display patterns with valid US area codes
    if (!phone) {
      const validAreaCodes = [
        '201','202','203','205','206','207','208','209','210','212','213','214','215','216','217','218','219',
        '224','225','228','229','231','234','239','240','248','251','252','253','254','256','260','262','267',
        '269','270','272','276','281','301','302','303','304','305','307','308','309','310','312','313','314',
        '315','316','317','318','319','320','321','323','325','330','331','334','336','337','339','346','347',
        '351','352','360','361','385','386','401','402','404','405','406','407','408','409','410','412','413',
        '414','415','417','419','423','424','425','430','432','434','435','440','442','443','458','469','470',
        '475','478','479','480','484','501','502','503','504','505','507','508','509','510','512','513','515',
        '516','517','518','520','530','531','534','539','540','541','551','559','561','562','563','567','570',
        '571','573','574','575','580','585','586','601','602','603','605','606','607','608','609','610','612',
        '614','615','616','617','618','619','620','623','626','628','629','630','631','636','641','646','650',
        '651','657','660','661','662','667','669','678','681','682','701','702','703','704','706','707','708',
        '712','713','714','715','716','717','718','719','720','724','725','727','731','732','734','737','740',
        '743','747','754','757','760','762','763','765','769','770','772','773','774','775','779','781','785',
        '786','801','802','803','804','805','806','808','810','812','813','814','815','816','817','818','828',
        '830','831','832','843','845','847','848','850','856','857','858','859','860','862','863','864','865',
        '870','872','878','901','903','904','906','907','908','909','910','912','913','914','915','916','917',
        '918','919','920','925','928','929','930','931','936','937','938','940','941','947','949','951','952',
        '954','956','959','970','971','972','973','978','979','980','984','985','989'
      ];

      const phoneRegex = /\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
      let match;
      while ((match = phoneRegex.exec(html)) !== null) {
        if (validAreaCodes.includes(match[1])) {
          phone = cleanPhoneNumber(match[0]);
          break;
        }
      }
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().substring(0, 200) : '';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim().substring(0, 500) : '';

    return { phone, title, description };
  } catch (error) {
    return { phone: '', title: '', description: '' };
  }
}

function cleanPhoneNumber(phone: string): string {
  // Remove all non-digit characters except + at start
  const digits = phone.replace(/[^\d+]/g, '');

  // Format as (XXX) XXX-XXXX if it's a 10-digit US number
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return phone;
}

async function enrichLead(lead: Lead): Promise<EnrichedLead> {
  const errors: string[] = [];

  // Parse name from email
  const { firstName, lastName, fullName } = parseNameFromEmail(lead.email);

  // Extract domain
  const domain = extractDomain(lead.email);
  const websiteUrl = domain ? `https://${domain}` : '';

  // Scrape website if we have one
  let phone = '';
  let websiteTitle = '';
  let websiteDescription = '';

  if (websiteUrl) {
    try {
      const scraped = await scrapeWebsite(websiteUrl);
      phone = scraped.phone;
      websiteTitle = scraped.title;
      websiteDescription = scraped.description;
    } catch (err) {
      errors.push(`Website scrape failed: ${err}`);
    }
  }

  return {
    ...lead,
    contactFirstName: firstName,
    contactLastName: lastName,
    contactFullName: fullName,
    domain,
    websiteUrl,
    phone,
    websiteTitle,
    websiteDescription,
    enrichedAt: new Date().toISOString(),
    enrichmentErrors: errors.join('; '),
  };
}

// =============================================================================
// Progress Tracking
// =============================================================================

function loadProgress(progressPath: string): EnrichmentProgress | null {
  try {
    if (fs.existsSync(progressPath)) {
      return JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load progress:', err);
  }
  return null;
}

function saveProgress(progressPath: string, progress: EnrichmentProgress): void {
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

function loadEnrichedLeads(outputPath: string): EnrichedLead[] {
  try {
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Failed to load existing enriched leads:', err);
  }
  return [];
}

function saveEnrichedLeads(outputPath: string, leads: EnrichedLead[]): void {
  fs.writeFileSync(outputPath, JSON.stringify(leads, null, 2));
}

function saveEnrichedCSV(csvPath: string, leads: EnrichedLead[]): void {
  const headers = [
    'ID', 'Name', 'Street', 'City', 'State', 'Zip', 'Email',
    'Contact First Name', 'Contact Last Name', 'Contact Full Name',
    'Domain', 'Website URL', 'Phone',
    'Website Title', 'Website Description',
    'Tagline', 'Property Types', 'Property Type Categories',
    'Is Featured', 'Logo URL', 'Additional Offices',
    'Scraped At', 'Enriched At', 'Enrichment Errors',
  ];

  const escapeCsv = (val: string): string => {
    if (!val) return '""';
    const escaped = val.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
    return `"${escaped}"`;
  };

  const rows = leads.map(lead => [
    lead.id,
    escapeCsv(lead.name),
    escapeCsv(lead.street),
    escapeCsv(lead.city),
    escapeCsv(lead.state),
    escapeCsv(lead.zip),
    escapeCsv(lead.email),
    escapeCsv(lead.contactFirstName),
    escapeCsv(lead.contactLastName),
    escapeCsv(lead.contactFullName),
    escapeCsv(lead.domain),
    escapeCsv(lead.websiteUrl),
    escapeCsv(lead.phone),
    escapeCsv(lead.websiteTitle),
    escapeCsv(lead.websiteDescription),
    escapeCsv(lead.tagline),
    escapeCsv(lead.propertyTypes),
    escapeCsv(lead.propertyTypeCategories),
    lead.isFeatured,
    escapeCsv(lead.logoUrl),
    escapeCsv(lead.additionalOffices),
    lead.scrapedAt,
    lead.enrichedAt,
    escapeCsv(lead.enrichmentErrors),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(csvPath, csv);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');

  const startIndex = args.indexOf('--start');
  const startFrom = startIndex !== -1 ? parseInt(args[startIndex + 1], 10) : 0;

  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : Infinity;

  const resumeMode = args.includes('--resume');

  console.log('\n' + '='.repeat(60));
  console.log('Lead Enrichment Script');
  console.log('='.repeat(60));

  // Paths
  const inputPath = path.join(__dirname, 'output', 'property-managers-all-2026-01-30.csv');
  const outputDir = path.join(__dirname, 'output');
  const timestamp = new Date().toISOString().split('T')[0];
  const jsonOutputPath = path.join(outputDir, `enriched-property-managers-${timestamp}.json`);
  const csvOutputPath = path.join(outputDir, `enriched-property-managers-${timestamp}.csv`);
  const progressPath = path.join(outputDir, 'enrichment-progress.json');

  // Load input
  console.log(`\nLoading leads from: ${inputPath}`);
  const csvContent = fs.readFileSync(inputPath, 'utf-8');
  const allLeads = parseCSV(csvContent);
  console.log(`  Found ${allLeads.length} leads`);

  // Determine range to process
  let enrichedLeads: EnrichedLead[] = [];
  let processStart = startFrom;

  if (resumeMode) {
    const progress = loadProgress(progressPath);
    if (progress) {
      processStart = progress.lastProcessedIndex + 1;
      enrichedLeads = loadEnrichedLeads(jsonOutputPath);
      console.log(`\nResuming from index ${processStart} (${enrichedLeads.length} already enriched)`);
    }
  }

  let processEnd = testMode ? Math.min(processStart + 10, allLeads.length) :
                   limit !== Infinity ? Math.min(processStart + limit, allLeads.length) :
                   allLeads.length;

  const leadsToProcess = allLeads.slice(processStart, processEnd);

  console.log(`\nProcessing leads ${processStart} to ${processEnd - 1} (${leadsToProcess.length} total)`);
  console.log('='.repeat(60));

  // Process leads
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < leadsToProcess.length; i++) {
    const lead = leadsToProcess[i];
    const globalIndex = processStart + i;

    try {
      const enriched = await enrichLead(lead);
      enrichedLeads.push(enriched);

      if (enriched.enrichmentErrors) {
        errors++;
      }

      processed++;

      // Progress update every 10 leads
      if (processed % 10 === 0 || processed === leadsToProcess.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (leadsToProcess.length - processed) / rate;

        process.stdout.write(`\r  Progress: ${processed}/${leadsToProcess.length} ` +
          `(${rate.toFixed(1)}/s, ETA: ${Math.round(remaining)}s, errors: ${errors})    `);

        // Save progress
        saveProgress(progressPath, {
          lastProcessedIndex: globalIndex,
          totalProcessed: enrichedLeads.length,
          totalErrors: errors,
          startedAt: new Date(startTime).toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        });

        // Save intermediate results every 50 leads
        if (processed % 50 === 0) {
          saveEnrichedLeads(jsonOutputPath, enrichedLeads);
        }
      }

      // Small delay to avoid overwhelming servers
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.error(`\nError processing lead ${globalIndex} (${lead.name}):`, err);
      errors++;
    }
  }

  console.log('\n');

  // Save final results
  console.log('Saving results...');
  saveEnrichedLeads(jsonOutputPath, enrichedLeads);
  saveEnrichedCSV(csvOutputPath, enrichedLeads);

  // Summary
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Total enriched: ${enrichedLeads.length}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time elapsed: ${Math.round(elapsed)}s`);
  console.log(`Rate: ${(processed / elapsed).toFixed(1)} leads/s`);

  // Enrichment stats
  const withName = enrichedLeads.filter(l => l.contactFullName).length;
  const withDomain = enrichedLeads.filter(l => l.domain).length;
  const withPhone = enrichedLeads.filter(l => l.phone).length;
  const withWebsiteInfo = enrichedLeads.filter(l => l.websiteTitle).length;

  console.log('\nEnrichment stats:');
  console.log(`  Contact name extracted: ${withName} (${(withName / enrichedLeads.length * 100).toFixed(1)}%)`);
  console.log(`  Domain extracted: ${withDomain} (${(withDomain / enrichedLeads.length * 100).toFixed(1)}%)`);
  console.log(`  Phone found: ${withPhone} (${(withPhone / enrichedLeads.length * 100).toFixed(1)}%)`);
  console.log(`  Website info scraped: ${withWebsiteInfo} (${(withWebsiteInfo / enrichedLeads.length * 100).toFixed(1)}%)`);

  console.log('\nOutput saved:');
  console.log(`  JSON: ${jsonOutputPath}`);
  console.log(`  CSV: ${csvOutputPath}`);

  // Sample output
  console.log('\n' + '='.repeat(60));
  console.log('Sample Enriched Results (first 3)');
  console.log('='.repeat(60));
  for (const lead of enrichedLeads.slice(0, 3)) {
    console.log(`\n${lead.name}`);
    console.log(`  Contact: ${lead.contactFullName || 'N/A'}`);
    console.log(`  Email: ${lead.email}`);
    console.log(`  Website: ${lead.websiteUrl || 'N/A'}`);
    console.log(`  Phone: ${lead.phone || 'N/A'}`);
  }
}

main().catch(console.error);
