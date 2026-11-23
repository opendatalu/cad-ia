import { load } from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import Path from 'path'

const PAGES = [
  { url: 'https://cad.gouvernement.lu/fr/avis/demande-conseil.html', type: 'conseil' },
  { url: 'https://cad.gouvernement.lu/fr/avis/demande-art-10-loi.html', type: 'art10' },
];

function parseReference(linkText) {
  // Older avis use "Avis n° X" or "Avis nr X" — skip the n°/nr prefix
  const m = linkText.match(/^Avis\s+(?:n[°r][.,]?\s+)?([^\s]+)/i);
  return m ? m[1] : null;
}

function parseDate(linkText) {
  const m = linkText.match(/du (\d{1,2}\s+\w+\s+\d{4})/);
  return m ? m[1] : null;
}

// Extract the year from the PDF's parent folder (e.g. ".../demande-de-conseil/2021/Avis-1-2021.pdf" → 2021).
function parseYear(pdfUrl) {
  const m = new URL(pdfUrl).pathname.match(/\/((?:19|20)\d{2})\/[^/]+$/);
  return m ? Number(m[1]) : null;
}

function parseDecision(desc) {
  const d = desc.toLowerCase();
  const hasPartPos = d.includes('partiellement positif');
  const hasPartNeg = d.includes('partiellement négatif');
  if (hasPartPos && hasPartNeg) return 'partiellement positif/négatif';
  if (hasPartPos) return 'partiellement positif';
  if (hasPartNeg) return 'partiellement négatif';
  if (d.includes('avis positif')) return 'positif';
  if (d.includes('avis négatif')) return 'négatif';
  if (d.includes('irrecevable')) return 'irrecevable';
  return null;
}

async function fetchPage(url, type) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  const html = await res.text();
  const $ = load(html);
  const avis = [];

  $('li').each((_, li) => {
    const a = $(li).find('a[href*=".pdf"]').first();
    if (!a.length) return;

    const href = a.attr('href');
    if (!href) return;

    const linkText = a.text().trim();
    const pdfUrl = href.startsWith('//') ? `https:${href}` : href;
    const file = Path.basename(new URL(pdfUrl).pathname)
    const reference = parseReference(linkText);
    const date = parseDate(linkText);
    const year = parseYear(pdfUrl);

    const fullText = $(li).text().trim();
    const idx = fullText.indexOf(linkText);
    const afterLink = idx >= 0 ? fullText.slice(idx + linkText.length) : '';
    const description = afterLink
      .replace(/^\s*:?\s*/, '')
      .replace(/ /g, ' ')
      .trim();
    const decision = parseDecision(description);

    if (reference && pdfUrl) {
      avis.push({ type, reference, date, year, decision, description, pdfUrl, file });
    }
  });

  return avis;
}

async function main() {
  let allAvis = [];
  for (const page of PAGES) {
    process.stdout.write(`Fetching ${page.url}...`);
    const avis = await fetchPage(page.url, page.type);
    console.log(` ${avis.length} avis found`);
    allAvis = allAvis.concat(avis);
  }

  mkdirSync('./data', { recursive: true });
  writeFileSync('./data/avis.json', JSON.stringify(allAvis, null, 2), 'utf8');
  console.log(`\nTotal: ${allAvis.length} avis saved in data/avis.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
