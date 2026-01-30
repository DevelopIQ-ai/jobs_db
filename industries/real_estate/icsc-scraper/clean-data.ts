/**
 * Clean up the scraped ICSC data
 * - Extract clean location from messy text
 * - Extract title from location text
 */

import * as fs from 'fs';
import * as path from 'path';

const INPUT_JSON = path.join(__dirname, 'output/icsc-members-2026-01-30.json');
const OUTPUT_JSON = path.join(__dirname, 'output/icsc-members-clean.json');
const OUTPUT_CSV = path.join(__dirname, 'output/icsc-members-clean.csv');

interface Member {
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  location: string;
  businessType: string;
  profileUrl: string;
  scrapedAt: string;
}

function cleanLocation(messy: string): string {
  // US States - full names
  const statesFullNames = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
    'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
    'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
    'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
    'Wisconsin', 'Wyoming', 'District of Columbia'
  ];

  // First, find the state name in the text
  for (const state of statesFullNames) {
    const stateIdx = messy.indexOf(state);
    if (stateIdx > 0) {
      // Look backwards from the state to find ", City" pattern
      const beforeState = messy.substring(0, stateIdx);
      // Find the last comma before the state
      const lastComma = beforeState.lastIndexOf(',');
      if (lastComma >= 0) {
        // Extract what's between the previous structure and the comma
        let cityPart = beforeState.substring(0, lastComma);
        // Find the actual city by looking for the last proper word(s) before the comma
        // Look for pattern like "Gilroy" or "New York" or "Los Angeles"
        const cityMatch = cityPart.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/);
        if (cityMatch) {
          const city = cityMatch[1];
          // Validate it's not a title or role
          if (!['Manager', 'Director', 'President', 'Developer', 'Partner', 'Owner', 'CEO', 'VP', 'Founder', 'Principal'].includes(city)) {
            return `${city}, ${state}`;
          }
        }
      }
    }
  }

  // Try state abbreviations (2-letter codes)
  // Look for pattern like ", TX, USA" or ", CA"
  const stateCodeMatch = messy.match(/,\s*([A-Z]{2}),?\s*(?:USA?|US)?(?:\s|$|Favorite)/);
  if (stateCodeMatch) {
    const stateCode = stateCodeMatch[1];
    const beforeStateCode = messy.substring(0, messy.indexOf(stateCode) - 1);
    const lastComma = beforeStateCode.lastIndexOf(',');
    if (lastComma >= 0) {
      const cityPart = beforeStateCode.substring(0, lastComma);
      const cityMatch = cityPart.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/);
      if (cityMatch) {
        const city = cityMatch[1];
        if (!['Manager', 'Director', 'President', 'Developer', 'Partner', 'Owner', 'CEO', 'VP', 'Founder', 'Principal'].includes(city)) {
          return `${city}, ${stateCode}`;
        }
      }
    }
  }

  // Canadian provinces
  const canadaPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(Alberta|Ontario|British Columbia|Quebec),?\s*(?:Canada)?/i;
  const canadaMatch = messy.match(canadaPattern);
  if (canadaMatch) {
    return `${canadaMatch[1]}, ${canadaMatch[2]}, Canada`;
  }

  return '';
}

function extractTitle(locationText: string, name: string): string {
  // Common titles to look for
  const titlePatterns = [
    /(?:^|\s)(President|CEO|CFO|COO|CMO|CTO|Founder|Co-Founder|Owner|Co-Owner|Principal|Partner|Managing Partner|Managing Director|Director|Vice President|VP|Senior Vice President|SVP|Executive Vice President|EVP|Chairman|General Counsel|Manager|Developer|Analyst|Associate|Broker)(?:\s|,|$)/i,
    /(Director of [A-Za-z\s]+)/i,
    /(VP of [A-Za-z\s]+)/i,
    /(Senior [A-Za-z]+)/i,
  ];

  // Remove the name from the text first
  const textWithoutName = locationText.replace(name, '').replace(/^[A-Z]{2}/, '');

  for (const pattern of titlePatterns) {
    const match = textWithoutName.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return '';
}

function cleanPhone(phone: string): string {
  if (!phone) return '';
  // Remove non-digits except + - ( )
  return phone.replace(/[^\d\-\(\)\+\s]/g, '').trim();
}

function escapeCsv(value: string): string {
  if (!value) return '""';
  const escaped = value.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
}

async function main() {
  console.log('Loading data...');
  const data = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf-8'));
  const members: Member[] = data.members;

  console.log(`Processing ${members.length} members...`);

  const cleanedMembers = members.map(m => {
    const cleanLoc = cleanLocation(m.location);
    const extractedTitle = m.title || extractTitle(m.location, m.name);

    return {
      name: m.name,
      company: m.company,
      title: extractedTitle,
      phone: cleanPhone(m.phone),
      email: m.email,
      location: cleanLoc,
      businessType: m.businessType,
      profileUrl: m.profileUrl,
      scrapedAt: m.scrapedAt,
    };
  });

  // Save JSON
  const jsonOutput = {
    scrapedAt: data.scrapedAt,
    source: data.source,
    filter: data.filter,
    count: cleanedMembers.length,
    members: cleanedMembers,
  };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(jsonOutput, null, 2));

  // Save CSV
  const headers = ['Name', 'Company', 'Title', 'Phone', 'Email', 'Location', 'Business Type', 'Profile URL'];
  const rows = cleanedMembers.map(m => [
    escapeCsv(m.name),
    escapeCsv(m.company),
    escapeCsv(m.title),
    escapeCsv(m.phone),
    escapeCsv(m.email),
    escapeCsv(m.location),
    escapeCsv(m.businessType),
    escapeCsv(m.profileUrl),
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(OUTPUT_CSV, csv);

  // Stats
  const withPhone = cleanedMembers.filter(m => m.phone).length;
  const withEmail = cleanedMembers.filter(m => m.email).length;
  const withLocation = cleanedMembers.filter(m => m.location).length;
  const withTitle = cleanedMembers.filter(m => m.title).length;

  console.log('\n=== Cleaned Data Stats ===');
  console.log(`Total members: ${cleanedMembers.length}`);
  console.log(`With phone: ${withPhone} (${(withPhone / cleanedMembers.length * 100).toFixed(1)}%)`);
  console.log(`With email: ${withEmail} (${(withEmail / cleanedMembers.length * 100).toFixed(1)}%)`);
  console.log(`With location: ${withLocation} (${(withLocation / cleanedMembers.length * 100).toFixed(1)}%)`);
  console.log(`With title: ${withTitle} (${(withTitle / cleanedMembers.length * 100).toFixed(1)}%)`);

  console.log(`\nOutput saved to:`);
  console.log(`  JSON: ${OUTPUT_JSON}`);
  console.log(`  CSV: ${OUTPUT_CSV}`);

  // Sample output
  console.log('\n=== Sample Cleaned Data ===');
  for (const m of cleanedMembers.slice(0, 5)) {
    console.log(`\n${m.name}`);
    console.log(`  Company: ${m.company || 'N/A'}`);
    console.log(`  Title: ${m.title || 'N/A'}`);
    console.log(`  Phone: ${m.phone || 'N/A'}`);
    console.log(`  Email: ${m.email || 'N/A'}`);
    console.log(`  Location: ${m.location || 'N/A'}`);
  }
}

main().catch(console.error);
