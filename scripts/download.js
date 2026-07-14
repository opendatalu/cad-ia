import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Path from 'path'

const PDF_DIR = './data/pdfs';

function slugify(reference) {
  return reference.replace(/\//g, '-');
}

async function downloadPdf(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(dest, Buffer.from(buffer));
}

function toODPNames (name) {
  name = Path.basename(name)

  // Remove accents using Unicode normalization
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Convert to lowercase for consistency
  name = name.toLowerCase()
  // Remove apostrophes and trim whitespace
  name = name.replaceAll('\'', '').trim()

  // Split by unwanted characters (keep only alphanumeric and dots)
  const unwanted = /[^[A-Za-z0-9.]+/
  const words = name.split(unwanted)
  // Note: empty words are automatically filtered by join

  // Merge words with dashes as separators
  name = words.join('-')

  // Udata removes dashes at the beginning of filenames
  name = name.replace(/^-+/, '')

  return name
}

async function main() {
  if (!existsSync('./data/avis.json')) {
    console.error('data/avis.json introuvable. Lancez d\'abord : npm run fetch');
    process.exit(1);
  }

  mkdirSync(PDF_DIR, { recursive: true });

  const avis = JSON.parse(readFileSync('./data/avis.json', 'utf8'));
  let downloaded = 0, skipped = 0, errors = 0;

  for (const item of avis) {
    //const filename = `${item.type}-${slugify(item.reference)}.pdf`;
    //const dest = join(PDF_DIR, filename);
    const filename = Path.basename(new URL(item.pdfUrl).pathname)
    const dest = join(PDF_DIR, item.type, toODPNames(filename))

    if (existsSync(dest)) {
      skipped++;
      continue;
    }

    process.stdout.write(`Downloading ${filename}...`);
    try {
      await downloadPdf(item.pdfUrl, dest);
      console.log(' OK');
      downloaded++;
    } catch (err) {
      console.error(` ERREUR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${downloaded} téléchargés, ${skipped} déjà présents, ${errors} erreurs`);
}

main().catch(err => { console.error(err); process.exit(1); });
