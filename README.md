# cad-ia

Pipeline pour télécharger, convertir et interroger les avis de la [Commission d'accès aux documents](https://cad.gouvernement.lu) (Luxembourg) via un LLM local (Ollama).

## Workflow

```
fetch → download → convert → search
                              ↘ query
```

1. **fetch** — scrape les deux pages HTML de la CAD et génère `data/avis.json`
2. **download** — télécharge tous les PDFs dans `data/pdfs/<type>/<année>/`
3. **convert** — convertit chaque PDF en Markdown avec frontmatter YAML dans `data/markdown/`, en page HTML dans `data/html/`, et regroupe tous les avis dans un seul document `data/avis.md`
4. **search** — génère la page de recherche `data/index.html` et l'index plein texte [Pagefind](https://pagefind.app) dans `data/pagefind/`
5. **query** — envoie chaque fichier Markdown à Ollama avec un prompt, sauvegarde les réponses

## Prérequis

- Node.js 18+
- [Ollama](https://ollama.com) en cours d'exécution sur `http://localhost:11434`

## Installation

```bash
npm install
```

## Utilisation

### Pipeline complet (fetch + download + convert + search)

```bash
npm run pipeline
```

### Étapes individuelles

```bash
npm run fetch      # → data/avis.json
npm run download   # → data/pdfs/
npm run convert    # → data/markdown/, data/html/, data/avis.md
npm run search     # → data/index.html, data/pagefind/
```

### Publication sur data.public.lu

```bash
npm run upload     # → data/archives/<type>-<année>.zip, puis envoi sur data.public.lu
```

Crée une archive zip par type d'avis et par année, puis la publie dans le dataset du type
(`art10ArchivesId`, `conseilArchivesId`). Une archive n'est envoyée que si elle est nouvelle
ou si son hash diffère de celui de la ressource publiée. Les archives sont construites de
façon déterministe (ordre et dates fixes) : leur hash ne change que si leur contenu change.

### Recherche plein texte

```bash
npm run search:serve   # génère l'index puis sert data/ sur http://localhost:1414
```

Le dossier `data/` (avec `index.html`, `html/` et `pagefind/`) peut aussi être publié tel quel sur n'importe quel hébergement statique.
```

### Interroger les avis

```bash
node scripts/query.js --prompt "Quel est l'objet principal de cet avis ?"
```

Les résultats sont sauvegardés dans `results/YYYY-MM-DDHHhMM.json` :

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

Fichier `.env` :

```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=mistral:latest

# Publication sur data.public.lu (npm run upload)
odpURL="https://data.public.lu/api/1"
odpAPIKey="..."
art10ArchivesId="..."      # dataset des archives art. 10
conseilArchivesId="..."    # dataset des archives demandes de conseil
callRateNrCalls=1
callRateDuration=1000
```

## Sources

- [Demandes de conseil](https://cad.gouvernement.lu/fr/avis/demande-conseil.html)
- [Demandes article 10](https://cad.gouvernement.lu/fr/avis/demande-art-10-loi.html)

## Structure

```
data/
  avis.json        index de tous les avis (référence, date, année, décision, URL PDF)
  pdfs/            PDFs téléchargés (pdfs/<type>/<année>/)
  archives/        archives zip par type et par année (npm run upload)
  markdown/        Markdown généré (frontmatter + texte extrait)
  avis.md          tous les avis dans un seul document Markdown
results/           Résultats des requêtes Ollama
scripts/
  fetch.js         scraping HTML
  download.js      téléchargement PDFs
  convert.js       PDF → Markdown
  query.js         requêtes Ollama
  upload.js        archives zip + publication sur data.public.lu
```
