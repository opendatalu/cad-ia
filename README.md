# cad-ia

Pipeline to download, convert, search and query the opinions (*avis*) of the [Commission d'accès aux documents](https://cad.gouvernement.lu) (CAD, Luxembourg's commission for access to documents), including with a local LLM (Ollama).

## Workflow

```
fetch → download → convert → search
                              ↘ query
```

1. **fetch** — scrapes the two HTML pages of the CAD and generates `data/avis.json`
2. **download** — downloads all PDFs into `data/pdfs/<type>/<year>/`
3. **convert** — converts each PDF to Markdown with YAML frontmatter in `data/markdown/` and to an HTML page in `data/html/`, and gathers the avis in a single document `data/avis.md` and in one document per type and year `data/corpus/<type>-<year>.md`
4. **search** — generates the search page `data/index.html` and the [Pagefind](https://pagefind.app) full-text index in `data/pagefind/`
5. **query** — sends each Markdown file to Ollama with a prompt and saves the answers

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) running on `http://localhost:11434` (only for `query`)
- For OCR of scanned PDFs (convert step): [Tesseract](https://github.com/tesseract-ocr/tesseract) with French language data, and `pdftoppm` (poppler).
  On Debian/Ubuntu: `sudo apt-get install tesseract-ocr tesseract-ocr-fra poppler-utils`.
  Without these tools, scanned PDFs are converted without text (with a warning).

## Installation

```bash
npm install
```

## Usage

### Full pipeline (fetch + download + convert + search)

```bash
npm run pipeline
```

### Individual steps

```bash
npm run fetch      # → data/avis.json
npm run download   # → data/pdfs/
npm run convert    # → data/markdown/, data/html/, data/avis.md, data/corpus/
npm run search     # → data/index.html, data/pagefind/
```

### Publication on data.public.lu

```bash
npm run upload     # → data/archives/<type>-<year>.zip, then upload to data.public.lu
```

Creates one zip archive per type of avis and per year, and publishes it in the dataset of that type
(`art10ArchivesId`, `conseilArchivesId`). An archive is only uploaded if it is new or if its hash
differs from the one of the published resource. Archives are built deterministically (fixed order
and dates): their hash only changes when their content changes.

### Full-text search

```bash
npm run search:serve   # builds the index, then serves data/ on http://localhost:1414
```

The `data/` folder (with `index.html`, `html/` and `pagefind/`) can also be published as is on any static hosting.
The GitHub Actions workflow (`.github/workflows/pages.yml`) runs the pipeline daily and publishes the search page on GitHub Pages.

### Querying the avis

```bash
node scripts/query.js --prompt "Quel est l'objet principal de cet avis ?"
```

Results are saved in `results/YYYY-MM-DDHHhMM.json`:

```json
{
  "prompt": "Quel est l'objet principal de cet avis ?",
  "results": [
    {
      "reference": "2026-C-01",
      "type": "conseil",
      "date": "18 mars 2026",
      "decision": "partiellement positif/négatif",
      "response": "..."
    }
  ]
}
```

## Configuration

`.env` file (see `.env-example`):

```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=mistral:latest

# Publication on data.public.lu (npm run upload)
odpURL="https://data.public.lu/api/1"
odpAPIKey="..."
art10ArchivesId="..."      # dataset of the article 10 archives
conseilArchivesId="..."    # dataset of the advice request archives
callRateNrCalls=1
callRateDuration=1000
```

## Sources

- [Advice requests (demandes de conseil)](https://cad.gouvernement.lu/fr/avis/demande-conseil.html)
- [Article 10 requests (demandes article 10)](https://cad.gouvernement.lu/fr/avis/demande-art-10-loi.html)

## Structure

```
data/
  avis.json        index of all avis (reference, date, year, decision, PDF URL)
  pdfs/            downloaded PDFs (pdfs/<type>/<year>/)
  archives/        zip archives per type and year (npm run upload)
  markdown/        generated Markdown (frontmatter + extracted text)
  html/            one HTML page per avis (indexed by Pagefind)
  avis.md          all avis in a single Markdown document (index + one self-contained block per avis)
  corpus/          same content split by type and year (<type>-<year>.md)
  ocr/             text of scanned PDFs obtained by OCR (cache)
  index.html       full-text search page
  pagefind/        Pagefind search index
results/           results of Ollama queries
scripts/
  fetch.js               HTML scraping
  download.js            PDF download
  convert.js             PDF → Markdown / HTML (with OCR, cleanup, removal of member names)
  generate-pdf-index.js  search page
  query.js               Ollama queries
  upload.js              zip archives + publication on data.public.lu
  odp.js                 data.public.lu (udata) API client
  utils.js               throttled fetch, logging
```
