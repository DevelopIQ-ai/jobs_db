const fs = require('fs');

// Read from progress file
const data = JSON.parse(fs.readFileSync('output/scrape-progress.json', 'utf8'));

// Helper to escape CSV fields
function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Create CSV content
const headers = ['Name', 'Location', 'Title', 'Email', 'Phone', 'Practice Areas', 'Bio', 'URL'];
const rows = data.scrapedProfiles.map(p => [
  escapeCSV(p.name || ''),
  escapeCSV(p.location || ''),
  escapeCSV(p.title || ''),
  escapeCSV(p.email || ''),
  escapeCSV(p.phone || ''),
  escapeCSV((p.practiceAreas || []).join('; ')),
  escapeCSV((p.bio || '').replace(/\n/g, ' ')),
  escapeCSV(p.url || '')
].join(','));

const csv = [headers.join(','), ...rows].join('\n');
fs.writeFileSync('output/skadden-lawyers.csv', csv);
console.log('CSV exported: ' + data.scrapedProfiles.length + ' profiles');
