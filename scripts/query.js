import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MD_DIR = './data/markdown';
const RESULTS_DIR = './results';

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--prompt');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return process.env.PROMPT || null;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(': ');
    if (colon < 0) continue;
    const k = line.slice(0, colon).trim();
    const v = line.slice(colon + 2).trim().replace(/^"|"$/g, '');
    meta[k] = v;
  }
  return { meta, body: content.slice(m[0].length).trim() };
}

async function queryOllama(prompt, documentContent) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';

  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: `${documentContent}\n\n---\n\n${prompt}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.message?.content || '';
}

async function main() {
  const prompt = parseArgs();
  if (!prompt) {
    console.error('Usage: node scripts/query.js --prompt "Your question"');
    console.error('       or set PROMPT= in .env');
    process.exit(1);
  }

  if (!existsSync(MD_DIR)) {
    console.error('data/markdown/ not found. Run first: npm run convert');
    process.exit(1);
  }

  const files = readdirSync(MD_DIR).filter(f => f.endsWith('.md')).sort();
  if (files.length === 0) {
    console.error('No .md file in data/markdown/. Run first: npm run convert');
    process.exit(1);
  }

  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  console.log(`Model:   ${model}`);
  console.log(`Prompt:  ${prompt}`);
  console.log(`Files:   ${files.length}\n`);

  mkdirSync(RESULTS_DIR, { recursive: true });

  const results = [];

  for (const file of files) {
    const content = readFileSync(join(MD_DIR, file), 'utf8');
    const { meta, body } = parseFrontmatter(content);
    const label = meta.reference || file;

    process.stdout.write(`[${label}] ...`);
    try {
      const response = await queryOllama(prompt, body);
      results.push({
        reference: meta.reference,
        type: meta.type,
        date: meta.date,
        decision: meta.decision,
        response,
      });
      console.log(' OK');
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      results.push({ reference: meta.reference, error: err.message });
    }
  }

  const now = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', '-')
    .replace(':', 'h');
  const outPath = join(RESULTS_DIR, `${now}.json`);
  writeFileSync(outPath, JSON.stringify({ prompt, results }, null, 2), 'utf8');
  console.log(`\nResults saved in ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
