import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
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

  const avisMap = {};
  if (existsSync('./data/avis.json')) {
    const avis = JSON.parse(readFileSync('./data/avis.json', 'utf8'));
    for (const item of avis) {
      const key = `${item.type}-${item.reference.replace(/\//g, '-')}`;
      avisMap[key] = item;
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
    const meta = avisMap[key] || {};

    process.stdout.write(`Converting ${pdfFile}...`);
    try {
      const buffer = readFileSync(join(PDF_DIR, pdfFile));
      const data = await pdf(buffer);
      const text = cleanText(data.text);

      const frontmatter = buildFrontmatter({
        reference: meta.reference || key,
        date: meta.date || null,
        type: meta.type || null,
        decision: meta.decision || null,
        pdfUrl: meta.pdfUrl || null,
        subject: meta.description ? meta.description.slice(0, 300) : null,
      });

      writeFileSync(mdPath, `${frontmatter}\n\n${text}`, 'utf8');
      console.log(` OK (${data.numpages} page${data.numpages > 1 ? 's' : ''})`);
      converted++;
    } catch (err) {
      console.error(` ERREUR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${converted} convertis, ${errors} erreurs`);

  // Convert markdown files to HTML
  mkdirSync(HTML_DIR, { recursive: true });
  const md = new markdownit();
  const mds = readdirSync(MD_DIR).filter(f => f.endsWith('.md'));
  let htmlConverted = 0;

  for (const mdFile of mds) {
    const key = basename(mdFile, '.md');
    const content = readFileSync(join(MD_DIR, mdFile), 'utf8');
    const parts = content.split('---');
    const body = parts.length >= 3 ? parts.slice(2).join('---').trim() : content;
    const rendered = md.render(body);

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${key}</title>
</head>
<body>
${rendered}
</body>
</html>
`;
    writeFileSync(join(HTML_DIR, `${key}.html`), html, 'utf8');
    htmlConverted++;
  }

  console.log(`HTML générés : ${htmlConverted}`);
}

main().catch(err => { console.error(err); process.exit(1); });
