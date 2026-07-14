import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const htmlDir = path.join(__dirname, '..', 'data', 'html');
const outputFile = path.join(__dirname, '..', 'data', 'index.html');

const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort();

const links = files.map(f => {
  const name = f.replace('.html', '');
  return `    <li><a href="html/${f}">${name}</a></li>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Avis Index</title>
</head>
<body>
  <h1>Avis Index</h1>
  <link href="/pagefind/pagefind-component-ui.css" rel="stylesheet">
  <script src="/pagefind/pagefind-component-ui.js" type="module"></script>
  <pagefind-modal-trigger></pagefind-modal-trigger>
  <pagefind-modal></pagefind-modal>

  <p>${files.length} file(s)</p>
  <ul>
${links}
  </ul>
</body>
</html>
`;

fs.writeFileSync(outputFile, html);
console.log(`Generated ${outputFile} with ${files.length} HTML links`);
