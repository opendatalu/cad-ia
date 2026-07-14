# cad-ia

Pipeline pour télécharger, convertir et interroger les avis de la [Commission d'accès aux documents](https://cad.gouvernement.lu) (Luxembourg) via un LLM local (Ollama).

## Workflow

```
fetch → download → convert → query
```

1. **fetch** — scrape les deux pages HTML de la CAD et génère `data/avis.json`
2. **download** — télécharge tous les PDFs dans `data/pdfs/`
3. **convert** — convertit chaque PDF en Markdown avec frontmatter YAML dans `data/markdown/`
4. **query** — envoie chaque fichier Markdown à Ollama avec un prompt, sauvegarde les réponses

## Prérequis

- Node.js 18+
- [Ollama](https://ollama.com) en cours d'exécution sur `http://localhost:11434`

## Installation

```bash
npm install
```

## Utilisation

### Pipeline complet (fetch + download + convert)

```bash
npm run pipeline
```

### Étapes individuelles

```bash
npm run fetch      # → data/avis.json
npm run download   # → data/pdfs/
npm run convert    # → data/markdown/
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
```

## Sources

- [Demandes de conseil](https://cad.gouvernement.lu/fr/avis/demande-conseil.html)
- [Demandes article 10](https://cad.gouvernement.lu/fr/avis/demande-art-10-loi.html)

## Structure

```
data/
  avis.json        index de tous les avis (référence, date, décision, URL PDF)
  pdfs/            PDFs téléchargés
  markdown/        Markdown généré (frontmatter + texte extrait)
results/           Résultats des requêtes Ollama
scripts/
  fetch.js         scraping HTML
  download.js      téléchargement PDFs
  convert.js       PDF → Markdown
  query.js         requêtes Ollama
```
