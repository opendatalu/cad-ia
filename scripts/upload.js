/**
 * Publication on data.public.lu
 *
 * For each type of avis, creates one zip archive per year from
 * data/pdfs/<type>/<year>/ (in data/archives/<type>-<year>.zip), then
 * synchronizes it with the dataset dedicated to that type:
 *   - archive not in the dataset          → the resource is created
 *   - archive present, different hash     → the resource is updated
 *   - archive present, same hash          → nothing
 */
import * as dotenv from 'dotenv'
import process from 'node:process'
import crypto from 'node:crypto'
import Path from 'path'
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import * as odp from './odp.js'
import { log } from './utils.js'

const PDF_DIR = './data/pdfs'
const ARCHIVE_DIR = './data/archives'

const TYPES = {
  art10: { label: 'demandes sur base de l\'article 10', datasetEnv: 'art10ArchivesId' },
  conseil: { label: 'demandes de conseil', datasetEnv: 'conseilArchivesId' }
}

// Fixed date for all entries: the archive only depends on the content of the PDFs,
// so its hash only changes when a PDF is added, removed or modified.
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1))

/**
 * Builds the zip archive of one year, deterministically.
 * PDFs are stored without recompression (they are already compressed).
 */
async function buildArchive (yearDir) {
  const files = readdirSync(yearDir).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
  const zip = new JSZip()
  for (const f of files) {
    zip.file(f, readFileSync(Path.join(yearDir, f)), { date: FIXED_DATE, createFolders: false })
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', platform: 'UNIX' })
  return { data, count: files.length }
}

function getFilenameFromURL (url) {
  return Path.basename(new URL(url).pathname)
}

function hashOf (data, algo) {
  return crypto.createHash(algo).update(data).digest('hex')
}

async function sync (type) {
  const { label, datasetEnv } = TYPES[type]
  const datasetId = process.env[datasetEnv]
  if (!datasetId) {
    console.error(`Variable ${datasetEnv} is not set: ${type} archives skipped`)
    process.exitCode = 1
    return
  }

  const typeDir = Path.join(PDF_DIR, type)
  if (!existsSync(typeDir)) {
    console.error(`${typeDir} not found. Run first: npm run download`)
    process.exitCode = 1
    return
  }

  const dataset = await odp.getDataset(datasetId)
  if (!Array.isArray(dataset.resources)) {
    // Without the list of resources, archives already published would be uploaded again
    console.error(`Cannot read dataset ${datasetId} (${datasetEnv}): ${type} archives skipped`)
    process.exitCode = 1
    return
  }
  const remote = new Map(
    dataset.resources
      .filter(r => r.type === 'main')
      .map(r => [getFilenameFromURL(r.url), r])
  )

  const years = readdirSync(typeDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map(d => d.name)
    .sort()

  mkdirSync(ARCHIVE_DIR, { recursive: true })

  for (const year of years) {
    const filename = `${type}-${year}.zip`
    const { data, count } = await buildArchive(Path.join(typeDir, year))
    if (count === 0) continue
    writeFileSync(Path.join(ARCHIVE_DIR, filename), data)

    const title = `Avis de la CAD ${year} – ${label}`
    const description = `Archive des ${count} avis de la Commission d'accès aux documents publiés en ${year} (${label}).`
    const existing = remote.get(filename)

    if (!existing) {
      const result = await odp.uploadResource(filename, data, datasetId, 'application/zip')
      if (!result.id) {
        console.error(`Error: upload of ${filename} failed`)
        process.exitCode = 1
        continue
      }
      await odp.updateResourceMeta(datasetId, result.id, title, description)
      console.log(`${filename}: added (${count} avis)`)
      continue
    }

    const algo = existing.checksum?.type || 'sha1'
    if (existing.checksum?.value && existing.checksum.value === hashOf(data, algo)) {
      console.log(`${filename}: unchanged`)
      continue
    }

    const result = await odp.updateResource(filename, data, datasetId, existing.id, 'application/zip')
    const resultMeta = await odp.updateResourceMeta(datasetId, existing.id, title, description)
    if (Object.keys(result).length === 0 || Object.keys(resultMeta).length === 0) {
      console.error(`Error: update of ${filename} failed`)
      process.exitCode = 1
      continue
    }
    console.log(`${filename}: updated (${count} avis)`)
  }

  // Resources without a matching local archive are not deleted automatically
  const local = new Set(years.map(y => `${type}-${y}.zip`))
  const orphans = [...remote.keys()].filter(f => !local.has(f))
  if (orphans.length > 0) log(`Resources of the ${type} dataset without a local archive (not deleted):`, orphans)
}

async function main () {
  dotenv.config()
  for (const type of Object.keys(TYPES)) {
    await sync(type)
  }
}

main().then(() => { log((new Date()).toLocaleString(), 'Sync done') }).catch(e => { console.error(e); process.exitCode = 1 })
