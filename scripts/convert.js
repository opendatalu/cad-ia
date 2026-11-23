import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, basename, sep } from 'path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/lib/pdf-parse.js');
import markdownit from 'markdown-it';

const PDF_DIR = './data/pdfs';
const typesAvis = ['conseil', 'art10'];
const MD_DIR = './data/markdown';
const HTML_DIR = './data/html';

function yamlEscape(val) {
  if (val === null || val === undefined) return 'null';
  const s = String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${s}"`;
}

// Same normalization as download.js: maps the PDF URL file name to the local file name
function toODPNames(name) {
  name = basename(name)
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  name = name.toLowerCase()
  name = name.replaceAll('\'', '').trim()
  const words = name.split(/[^[A-Za-z0-9.]+/)
  name = words.join('-')
  return name.replace(/^-+/, '')
}

function htmlEscape(val) {
  return String(val)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function avisTitle(meta, fallback) {
  if (!meta.reference) return fallback;
  return `Avis ${meta.reference}${meta.date ? ` du ${meta.date}` : ''}`;
}

const TYPE_LABELS = { conseil: 'Demande de conseil', art10: 'Demande art. 10' };

// HTML page for one avis, annotated for Pagefind (body, metadata and filters)
function buildHtml(meta, title, rendered) {
  const e = htmlEscape;
  const pfMeta = [];
  if (meta.date) pfMeta.push(`<span data-pagefind-meta="date">${e(meta.date)}</span>`);
  if (meta.pdfUrl) pfMeta.push(`<span data-pagefind-meta="pdf">${e(meta.pdfUrl)}</span>`);
  const pfFilters = [];
  if (meta.type) pfFilters.push(`<span data-pagefind-filter="Type">${e(TYPE_LABELS[meta.type] || meta.type)}</span>`);
  if (meta.year) pfFilters.push(`<span data-pagefind-filter="Année">${e(meta.year)}</span>`);
  if (meta.decision) pfFilters.push(`<span data-pagefind-filter="Décision">${e(meta.decision)}</span>`);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${e(title)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:50rem;margin:2rem auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<p><a href="../index.html">← Recherche</a></p>
<main data-pagefind-body>
  <h1 data-pagefind-meta="title">${e(title)}</h1>
  <div hidden data-pagefind-ignore>${pfMeta.join('')}${pfFilters.join('')}</div>
  <p data-pagefind-ignore>
    ${[meta.type && e(TYPE_LABELS[meta.type] || meta.type), meta.decision && `Décision : ${e(meta.decision)}`].filter(Boolean).join(' · ')}
    ${meta.pdfUrl ? `<br><a href="${e(meta.pdfUrl)}">PDF original</a>` : ''}
  </p>
${rendered}
</main>
</body>
</html>
`;
}

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    lines.push(`${k}: ${typeof v === 'string' ? yamlEscape(v) : v}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function cleanText(text) {
  let clean = text
    .replace(/\f/g, '\n\n')
    // Format récent (2023+) : en-tête sur 2 lignes répété à chaque page
    .replace(/^2, place de Clairefontaine,.*\nL-1341 Luxembourg.*\n?/gm, '')
    // Ancien format : pied de page "Commission d'accès aux documents" + numéro de page suivant
    // L'apostrophe dans les PDFs est U+2019 (guillemet courbe), pas U+0027
    .replace(/^Commission d’accès aux documents[ \t]*\n(\n*\d+[ \t]*\n)?/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Après trim, le numéro de page initial (ancien format) se retrouve en tête
  return clean.replace(/^\d+\n\n?/, '').trim();
}

async function main() {
  if (!existsSync(PDF_DIR)) {
    console.error('data/pdfs/ introuvable. Lancez d\'abord : npm run download');
    process.exit(1);
  }

  mkdirSync(MD_DIR, { recursive: true });
  // HTML pages are fully derived from the PDFs: rebuild the folder to drop stale pages
  rmSync(HTML_DIR, { recursive: true, force: true });
  mkdirSync(HTML_DIR, { recursive: true });
  const md = new markdownit();

  const avisMap = {};
  if (existsSync('./data/avis.json')) {
    const avis = JSON.parse(readFileSync('./data/avis.json', 'utf8'));
    for (const item of avis) {
      // Key on <type>/<local file name>, matching data/pdfs/<type>/<year>/<file>
      avisMap[`${item.type}/${toODPNames(item.file)}`] = item;
    }
  }


  const pdfs = readdirSync(PDF_DIR, {recursive: true}).filter(f => f.endsWith('.pdf'));
  if (pdfs.length === 0) {
    console.error('Aucun PDF dans data/pdfs. Lancez d\'abord : npm run download');
    process.exit(1);
  }

  let converted = 0, errors = 0;

  for (const pdfFile of pdfs) {
    const key = basename(pdfFile, '.pdf');
    const mdPath = join(MD_DIR, `${key}.md`);
    const type = pdfFile.split(sep)[0];
    const meta = avisMap[`${type}/${basename(pdfFile)}`] || {};
    if (!meta.pdfUrl) console.warn(`\n  Avertissement : ${pdfFile} absent de data/avis.json, pas d'URL PDF`);

    process.stdout.write(`Converting ${pdfFile}...`);
    try {
      const buffer = readFileSync(join(PDF_DIR, pdfFile));
      const data = await pdf(buffer);
      const text = cleanText(data.text);

      const frontmatter = buildFrontmatter({
        reference: meta.reference || key,
        date: meta.date || null,
        year: meta.year || null,
        type: meta.type || null,
        decision: meta.decision || null,
        pdfUrl: meta.pdfUrl || null,
        subject: meta.description ? meta.description.slice(0, 300) : null,
      });

      writeFileSync(mdPath, `${frontmatter}\n\n${text}`, 'utf8');
      writeFileSync(join(HTML_DIR, `${key}.html`), buildHtml(meta, avisTitle(meta, key), md.render(text)), 'utf8');
      console.log(` OK (${data.numpages} page${data.numpages > 1 ? 's' : ''})`);
      converted++;
    } catch (err) {
      console.error(` ERREUR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${converted} convertis, ${errors} erreurs`);

  console.log(`HTML générés dans ${HTML_DIR} : ${converted}`);
}

main().catch(err => { console.error(err); process.exit(1); });
