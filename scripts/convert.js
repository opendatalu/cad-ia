import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { join, basename, sep } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/lib/pdf-parse.js');
import markdownit from 'markdown-it';

const PDF_DIR = './data/pdfs';
const typesAvis = ['conseil', 'art10'];
const MD_DIR = './data/markdown';
const HTML_DIR = './data/html';
// Single document with all avis, and one document per type and year
// (outside MD_DIR so that query.js does not pick them up)
const ALL_MD = './data/avis.md';
const CORPUS_DIR = './data/corpus';
// OCR results of scanned PDFs (cache: OCR is only run once per PDF)
const OCR_DIR = './data/ocr';
// Below this number of characters, the PDF is considered scanned (no text layer)
const MIN_TEXT_CHARS = 100;

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

const SECTION_LABELS = { conseil: 'Demandes de conseil', art10: 'Demandes sur base de l\'article 10' };

function sortEntries(entries) {
  const typeOrder = Object.keys(SECTION_LABELS);
  const rank = t => (typeOrder.includes(t) ? typeOrder.indexOf(t) : typeOrder.length);
  return [...entries].sort((a, b) =>
    rank(a.type) - rank(b.type) ||
    b.year - a.year ||
    a.file.localeCompare(b.file, 'fr', { numeric: true }));
}

function cell(val) {
  return String(val ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

// Self-contained block for one avis: the header repeats all metadata so that
// a chunk taken from this avis can be identified on its own.
function avisBlock(e, level) {
  const m = e.meta;
  const out = [`${'#'.repeat(level)} ${e.title}`, ''];
  out.push(`- **Référence :** ${m.reference || e.file}`);
  out.push(`- **Type :** ${TYPE_LABELS[e.type] || e.type}`);
  out.push(`- **Année :** ${e.year}`);
  if (m.date) out.push(`- **Date :** ${m.date}${m.dateSource === 'texte' ? ' (date d\'adoption, tirée du texte)' : ''}`);
  if (m.decision) out.push(`- **Décision :** ${m.decision}`);
  if (m.description) out.push(`- **Objet :** ${m.description}`);
  if (m.pdfUrl) out.push(`- **PDF :** <${m.pdfUrl}>`);
  if (m.ocr) out.push('- **Texte :** obtenu par reconnaissance optique (OCR) d\'un PDF scanné, peut contenir des erreurs');
  out.push('', e.text || '*(Texte non disponible : PDF scanné sans couche texte.)*');
  return out.join('\n');
}

function indexTable(entries) {
  const rows = entries.map(e =>
    `| ${cell(e.meta.reference || e.file)} | ${cell(e.meta.date)} | ${cell(e.year)} | ${cell(TYPE_LABELS[e.type] || e.type)} | ${cell(e.meta.decision)} |`);
  return ['| Référence | Date | Année | Type | Décision |', '|---|---|---|---|---|', ...rows].join('\n');
}

// Markdown document: title, index of all avis, then avis grouped by type and year (most recent first)
function buildMarkdownDoc(entries, title) {
  entries = sortEntries(entries);
  const out = [`# ${title}`, '', `${entries.length} avis.`, '', '## Index des avis', '', indexTable(entries)];
  for (const type of [...new Set(entries.map(e => e.type))]) {
    const ofType = entries.filter(e => e.type === type);
    out.push('', `## ${SECTION_LABELS[type] || type} (${ofType.length})`);
    for (const year of [...new Set(ofType.map(e => e.year))]) {
      out.push('', `### ${year}`);
      for (const e of ofType.filter(x => x.year === year)) out.push('', avisBlock(e, 4));
    }
  }
  return out.join('\n') + '\n';
}

/**
 * OCR of a scanned PDF with Tesseract (pages rendered by pdftoppm).
 * Returns the text with pages separated by \f, like pdf-parse, or null if the
 * tools are not installed.
 */
function ocrPdf(pdfPath, cacheKey) {
  const cachePath = join(OCR_DIR, `${cacheKey}.txt`);
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');

  const tmp = mkdtempSync(join(tmpdir(), 'cad-ocr-'));
  try {
    execFileSync('pdftoppm', ['-r', '300', '-gray', '-png', pdfPath, join(tmp, 'page')], { stdio: 'ignore' });
    const pages = readdirSync(tmp).filter(f => f.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const text = pages
      .map(p => execFileSync('tesseract', [join(tmp, p), '-', '-l', 'fra'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .join('\f');
    mkdirSync(OCR_DIR, { recursive: true });
    writeFileSync(cachePath, text, 'utf8');
    return text;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const MONTHS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
const ADOPTION_DATE = new RegExp(
  `(?:Avis adopté[^.\\n]{0,40}?|Luxembourg,?)\\s+le\\s+(\\d{1,2}(?:er)?\\s+(?:${MONTHS})\\s+\\d{4})`, 'gi');

// Date of adoption from the text of the avis ("Avis adopté à l'unanimité le 13 octobre 2021",
// "Luxembourg, le 14 février 2019"): last occurrence, as it is at the end of the avis.
function extractDate(text) {
  const matches = [...text.matchAll(ADOPTION_DATE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].replace(/\s+/g, ' ');
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
  clean = clean
    .replace(/^\d+\n\n?/, '')
    // Pied de page de la dernière page (ancien format), en fin de texte
    .replace(/\n+Commission d’accès aux documents\s*$/, '')
    .trim();
  return removePresents(removeSignatures(reflow(clean)));
}

// Removes the « Présents : » block (members of the CAD present at the meeting) at the
// beginning of the avis: the "Présents" paragraph and the following member lines,
// i.e. short paragraphs ending with a role in brackets ("Louis Oberhag (Membre)",
// "Jessica Ribeiro (Membre suppléant et secrétaire)").
function removePresents(text) {
  const paragraphs = text.split('\n\n');
  const start = paragraphs.findIndex(p => /^Présente?s?\s*:/i.test(p));
  if (start === -1 || paragraphs[start].length > 300) return text;
  const isMemberLine = p => p.length <= 300 &&
    /\([^()]*(membre|président|secrétaire|suppléant)[^()]*\)$/i.test(p.trim());
  let end = start + 1;
  while (end < paragraphs.length && isMemberLine(paragraphs[end])) end++;
  return [...paragraphs.slice(0, start), ...paragraphs.slice(end)].join('\n\n');
}

const ADOPTION_LINE = /^(Avis adopté|Luxembourg,? le|Fait à Luxembourg)/i;

// Removes the names of the CAD members signing the avis: short paragraphs after the
// last adoption line ("Avis adopté à l'unanimité le …"). Notes placed after it
// (case law, parliamentary documents, "Ibid.") are kept: they contain digits or end with
// punctuation. OCR noise around signatures ("/ /", "Pierre Calmes LT") is removed too.
function removeSignatures(text) {
  const paragraphs = text.split('\n\n');
  let last = -1;
  paragraphs.forEach((p, i) => { if (ADOPTION_LINE.test(p)) last = i; });
  if (last === -1) return text;
  const isSignature = p => p.length <= 45 && !/\d/.test(p) && !/[.:;!?»)]$/.test(p.trim());
  return [
    ...paragraphs.slice(0, last + 1),
    ...paragraphs.slice(last + 1).filter(p => !isSignature(p)),
  ].join('\n\n');
}

const LIST_ITEM = /^([-–•▪●*]|\d{1,2}[.)]|[a-z][.)]|[ivx]{1,4}[.)]|\(\d{1,2}\)|\([a-z]\)|\([ivx]{1,4}\))\s/;

// Rebuilds paragraphs from the PDF layout: lines wrapped by the PDF are joined,
// page breaks inside a sentence are removed, short lines (lists, signatures,
// « Présents : » block) keep their own line. Paragraphs are separated by a blank line.
function reflow(text) {
  text = text
    // Superscripts extracted on their own line: "article 1\ner\n, paragraphe" → "article 1er, paragraphe"
    .replace(/(\d)[ \t]*\n(ers?|ère|re|ème|e|o)[ \t]*\n/g, '$1$2 ')
    .replace(/(\d(?:ers?|ère|re|ème|e|o)) ([,.)])/g, '$1$2')
    // Justified text: runs of spaces
    .replace(/[ \t]{2,}/g, ' ');

  const lines = text.split('\n').map(l => l.trim())
    // Page numbers alone on their line
    .filter(l => !/^-?\s*\d{1,3}\s*-?$/.test(l));

  const lengths = lines.filter(Boolean).map(l => l.length).sort((a, b) => a - b);
  const width = Math.max(60, lengths[Math.floor(lengths.length * 0.8)] || 0);

  const paragraphs = [];
  let cur = '';
  let last = '';
  const flush = () => { if (cur) paragraphs.push(cur); cur = ''; last = ''; };
  const nextNonEmpty = i => { for (let j = i + 1; j < lines.length; j++) if (lines[j]) return lines[j]; return ''; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      // Blank line from a page break in the middle of a sentence: keep the paragraph open
      // (next line in lower case, or previous line filling the whole width)
      if (cur && !/[.!?:;]$/.test(last) &&
          (/^[a-zà-ÿ,;)]/.test(nextNonEmpty(i)) || last.length >= 0.85 * width)) continue;
      flush();
      continue;
    }
    // A new paragraph starts with a list item or with the « Présents : » block
    if (cur && !LIST_ITEM.test(line) && !/^Présente?s?\s*:/i.test(line)) {
      const continues = /^[a-zà-ÿ,;.)\]]/.test(line) && !/[.!?]$/.test(last);
      const wrapped = last.length >= 0.7 * width && !/[.!?:;]$/.test(last);
      if (continues || wrapped) {
        // Keep the hyphen of compound words split at the end of a line (Grand-\nDuché)
        cur += /[A-Za-zÀ-ÿ]-$/.test(last) ? line : ` ${line}`;
        last = line;
        continue;
      }
    }
    flush();
    cur = line;
    last = line;
  }
  flush();
  return paragraphs.join('\n\n');
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
  const allEntries = [];

  for (const pdfFile of pdfs) {
    const key = basename(pdfFile, '.pdf');
    const mdPath = join(MD_DIR, `${key}.md`);
    const type = pdfFile.split(sep)[0];
    let meta = avisMap[`${type}/${basename(pdfFile)}`] || {};
    if (!meta.pdfUrl) console.warn(`\n  Avertissement : ${pdfFile} absent de data/avis.json, pas d'URL PDF`);

    process.stdout.write(`Converting ${pdfFile}...`);
    try {
      const buffer = readFileSync(join(PDF_DIR, pdfFile));
      const data = await pdf(buffer);
      let text = cleanText(data.text);

      // Scanned PDF without text layer: OCR
      let ocr = false;
      if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
        const ocrText = ocrPdf(join(PDF_DIR, pdfFile), key);
        if (ocrText === null) {
          console.warn(`\n  Avertissement : ${pdfFile} est scanné, mais tesseract/pdftoppm ne sont pas installés`);
        } else {
          text = cleanText(ocrText);
          ocr = true;
        }
      }

      // Date missing on the CAD website: take the adoption date from the text
      if (!meta.date && meta.reference) {
        const date = extractDate(text);
        if (date) meta = { ...meta, date, dateSource: 'texte' };
      }
      if (ocr) meta = { ...meta, ocr: true };

      const frontmatter = buildFrontmatter({
        reference: meta.reference || key,
        date: meta.date || null,
        year: meta.year || null,
        type: meta.type || null,
        decision: meta.decision || null,
        pdfUrl: meta.pdfUrl || null,
        ocr: meta.ocr || null,
        subject: meta.description ? meta.description.slice(0, 300) : null,
      });

      writeFileSync(mdPath, `${frontmatter}\n\n${text}`, 'utf8');
      writeFileSync(join(HTML_DIR, `${key}.html`), buildHtml(meta, avisTitle(meta, key), md.render(text)), 'utf8');
      allEntries.push({
        type: meta.type || type,
        year: meta.year || Number(pdfFile.split(sep)[1]) || 0,
        file: basename(pdfFile),
        title: avisTitle(meta, key),
        meta,
        text,
      });
      console.log(` OK (${data.numpages} page${data.numpages > 1 ? 's' : ''})`);
      converted++;
    } catch (err) {
      console.error(` ERREUR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${converted} convertis, ${errors} erreurs`);

  console.log(`HTML générés dans ${HTML_DIR} : ${converted}`);

  writeFileSync(ALL_MD, buildMarkdownDoc(allEntries, 'Avis de la Commission d\'accès aux documents'), 'utf8');
  console.log(`Document unique : ${ALL_MD} (${allEntries.length} avis)`);

  // One document per type and year, for tools that limit the size of a document
  rmSync(CORPUS_DIR, { recursive: true, force: true });
  mkdirSync(CORPUS_DIR, { recursive: true });
  const groups = new Map();
  for (const e of allEntries) {
    const k = `${e.type}-${e.year}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, entries] of groups) {
    const { type, year } = entries[0];
    writeFileSync(join(CORPUS_DIR, `${k}.md`),
      buildMarkdownDoc(entries, `Avis de la Commission d'accès aux documents – ${SECTION_LABELS[type] || type} – ${year}`), 'utf8');
  }
  console.log(`Documents par type et par année : ${CORPUS_DIR}/ (${groups.size} fichiers)`);
}

main().catch(err => { console.error(err); process.exit(1); });
