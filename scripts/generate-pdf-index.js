// Generates data/index.html: the full-text search page (Pagefind UI) plus a list of all avis.
// Run `pagefind --site data` afterwards to build the search index in data/pagefind/.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const DATA_DIR = './data';
const HTML_DIR = join(DATA_DIR, 'html');
const OUTPUT = join(DATA_DIR, 'index.html');

const TYPE_LABELS = { conseil: 'Demandes de conseil', art10: 'Demandes sur base de l\'article 10' };

// Same normalization as download.js / convert.js
function toODPNames(name) {
  name = basename(name)
  name = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  name = name.toLowerCase()
  name = name.replaceAll('\'', '').trim()
  const words = name.split(/[^[A-Za-z0-9.]+/)
  name = words.join('-')
  return name.replace(/^-+/, '')
}

function e(val) {
  return String(val)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (!existsSync(join(DATA_DIR, 'avis.json'))) {
  console.error('data/avis.json not found. Run first: npm run fetch');
  process.exit(1);
}

const avis = JSON.parse(readFileSync(join(DATA_DIR, 'avis.json'), 'utf8'))
  .map(item => ({ ...item, page: `${basename(toODPNames(item.file), '.pdf')}.html` }))
  .filter(item => existsSync(join(HTML_DIR, item.page)))
  // Missing dates are extracted from the text by convert.js and stored in the HTML page
  .map(item => {
    if (item.date) return item;
    const m = readFileSync(join(HTML_DIR, item.page), 'utf8').match(/data-pagefind-meta="date">([^<]+)</);
    return m ? { ...item, date: m[1] } : item;
  });

const sections = Object.entries(TYPE_LABELS).map(([type, label]) => {
  const items = avis
    .filter(a => a.type === type)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.file.localeCompare(b.file));
  if (items.length === 0) return '';

  const years = [...new Set(items.map(a => a.year ?? 'Année inconnue'))];
  const byYear = years.map(year => {
    const lis = items
      .filter(a => (a.year ?? 'Année inconnue') === year)
      .map(a => `        <li><a href="html/${e(a.page)}">Avis ${e(a.reference)}</a>${a.date ? ` du ${e(a.date)}` : ''}${a.decision ? ` <span class="decision">${e(a.decision)}</span>` : ''}</li>`)
      .join('\n');
    return `      <details>\n        <summary>${e(year)}</summary>\n        <ul>\n${lis}\n        </ul>\n      </details>`;
  }).join('\n');

  return `    <section>\n      <h2>${e(label)} (${items.length})</h2>\n${byYear}\n    </section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Keep the site out of search engines -->
  <meta name="robots" content="noindex, nofollow">
  <title>Avis de la CAD</title>
  <link href="pagefind/pagefind-component-ui.css" rel="stylesheet">
  <script src="pagefind/pagefind-component-ui.js" type="module"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    .filters { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0; }
    pagefind-summary { display: block; margin: .5rem 0; color: #555; }
    details { margin: .25rem 0; }
    summary { cursor: pointer; font-weight: 600; }
    .decision { color: #555; font-size: .9em; }
    .decision::before { content: "— "; }
  </style>
</head>
<body>
  <h1>Avis de la Commission d'accès aux documents</h1>
  <p>Recherche plein texte dans ${avis.length} avis.</p>
  <search>
    <!-- bundle-path is relative to the pagefind-component-ui.js script: also works under a sub-path (GitHub Pages) -->
    <pagefind-config bundle-path="./" preload></pagefind-config>
    <pagefind-input placeholder="Rechercher dans les avis…" autofocus></pagefind-input>
    <div class="filters">
      <pagefind-filter-dropdown filter="Type" label="Type"></pagefind-filter-dropdown>
      <pagefind-filter-dropdown filter="Année" label="Année" sort="alphabetical"></pagefind-filter-dropdown>
      <pagefind-filter-dropdown filter="Décision" label="Décision"></pagefind-filter-dropdown>
    </div>
    <pagefind-summary></pagefind-summary>
    <pagefind-results max-sub-results="3"></pagefind-results>
  </search>

  <h2>Tous les avis</h2>
${sections}
</body>
</html>
`;

writeFileSync(OUTPUT, html, 'utf8');
console.log(`Generated ${OUTPUT} with ${avis.length} avis`);
