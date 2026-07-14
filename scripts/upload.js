import * as dotenv from 'dotenv'
import process from 'node:process'
import * as odp from './odp.js'
import Path from 'path'
import { readFileSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { log } from './utils.js'
const avis = JSON.parse(readFileSync('./data/avis.json', 'utf8'));

let avis_meta = {}
avis_meta['art10'] = {}
avis_meta['conseil'] = {}
for (const item of avis) {
  if (item['type'] == 'art10') {
    avis_meta['art10'][toODPNames(item['file'])] = item;
  } else {
    avis_meta['conseil'][toODPNames(item['file'])] = item;
  }
}

async function list (path) {
  // Read directory entries
  const dirents = await readdir(path)

  // Get file infos for all entries concurrently
  const stats = await Promise.all((dirents.map(e => {
    return stat(path + '/' + e)
  })))

  // Build result array with file metadata
  const result = []
  dirents.forEach((v, i) => {
    result.push({
      name: path + '/' + v,
      type: stats[i].isFile() ? 'f' : (stats[i].isDirectory() ? 'd' : 'o'),
      modifyTime: stats[i].mtime
    })
  })

  return result
}

function getFilenameFromURL (url) {
  const pathName = new URL(url).pathname
  return Path.basename(pathName)
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
    // Load environment configuration
    dotenv.config()
    await sync('./data/pdfs/art10', process.env.art10Id, 'art10')
    await sync('./data/pdfs/conseil', process.env.conseilId, 'conseil')

}

async function sync(path, datasetId, avis_type) { 

    const dataset = await odp.getDataset(datasetId)
    const resources = dataset.resources

    //get the list of local files

    let localFiles = []
    localFiles = await list(path) // list all files in ./data/pdfs

    // Create normalized filename collections for comparison
    const caseInsensitiveLocalFilesArr = localFiles.map(e => toODPNames(e.name))
    const caseInsensitiveLocalFilesSet = new Set(caseInsensitiveLocalFilesArr)
    const nrLocalFiles = caseInsensitiveLocalFilesSet.size

    let filesOnODPArr = dataset.resources.filter(x => x.type === 'main').map(e => getFilenameFromURL(e.url))
    const filesOnODPSet = new Set(filesOnODPArr)

    let toAdd = [...new Set(caseInsensitiveLocalFilesArr.filter(x => !filesOnODPSet.has(x)))]

    // Calculate files to update (exists on both, only if overwrite enabled)
    let toUpdate = []
    if (process.env.overwrite === 'true') {
        toUpdate = [...new Set(caseInsensitiveLocalFilesArr.filter(x => filesOnODPSet.has(x)))]
    }

    // Calculate files to delete (on ODP but not on FTP)
    let toDelete = []
    toDelete = [...new Set(filesOnODPArr.filter(x => !caseInsensitiveLocalFilesSet.has(x)))]

    log('Files to add:', toAdd)
    log('Files to update:', toUpdate)
    log('Files to delete:', toDelete)

    // Process deletions first
    for (const e of toDelete) {
        const meta = getResourceMeta(e, dataset.resources)
        const result = await odp.deleteResource(datasetId, meta.id)

        if (result) {
            log('Resource deletion succeeded for', e)
        } else {
            console.error('Error: Resource deletion failed for', e)
            process.exitCode = 1
        }
    }
    // Process new file uploads
    for (const e of toAdd) {
        // Download file from FTP
        const file = await readFile(path + '/' + e)
        // Upload to ODP
        const result = await odp.uploadResource(e, file, datasetId, 'application/pdf')

        const status = (Object.keys(result).length !== 0)
        if (status) {
            log('Resource upload succeeded for', e)
        } else {
            console.error('Error: Resource upload failed for', e)
            process.exitCode = 1
        }

        // Update metadata (workaround for potential udata bug)
        console.log(e, avis_meta[avis_type][e] )
        let name = 'Avis ' + avis_meta[avis_type][e].reference 
        if (avis_meta[avis_type][e].date !== null) { name = name + ' du ' + avis_meta[avis_type][e].date } 
        const resultMeta = await odp.updateResourceMeta(datasetId, result.id, name, avis_meta[avis_type][e].description)
    }

    // Process file updates with checksum validation
    for (const e of toUpdate) {
        // Download file from FTP
        const file = await readFile(e)
        // Get existing resource metadata
        const meta = getResourceMeta(e, dataset.resources)

        // Compare checksums to determine if update is needed
        const algo = meta.checksum.type
        const odpHash = meta.checksum.value

        let update = true

        // Calculate hash of FTP file
        const hash = crypto.createHash(algo)
        hash.update(file)
        const fileHash = hash.digest('hex')

        // Skip update if checksums match
        if (odpHash === fileHash) {
            update = false
            log('File ' + e + ' is already up to date.')
        }

        if (update) {
            // Update the file content
            const result = await odp.updateResource(e, file, datasetId, meta.id, 'application/pdf')

            // Update metadata (workaround for potential udata bug)
            const resultMeta = await odp.updateResourceMeta(datasetId, meta.id, meta.title, meta.description)

            // Check if both operations succeeded
            const status = (Object.keys(result).length !== 0) && (Object.keys(resultMeta).length !== 0)
            if (status) {
                log('Resource update succeeded for', e)
            } else {
                console.error('Error: Resource update failed for', e)
                process.exitCode = 1
            }
        }
    }



}

main().then(() => { log((new Date()).toLocaleString(), 'Sync successful') }).catch(e => { console.error(e); process.exitCode = 1 })