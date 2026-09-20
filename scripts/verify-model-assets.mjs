import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const assetsDir = path.resolve(
  process.env.LIGHTCUT_ASSETS_DIR ?? path.join(projectRoot, '.model-assets'),
)
const manifestPath = path.join(assetsDir, 'manifests', 'models', 'latest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const entries = [
  ...Object.values(manifest.models).flatMap((model) => model.chunks),
  ...Object.values(manifest.wasm),
]

for (const entry of entries) {
  const filePath = path.join(assetsDir, entry.path)
  const file = await fs.readFile(filePath)
  const digest = createHash('sha256').update(file).digest('hex')
  if (entry.size !== file.byteLength) {
    throw new Error(`${entry.path}: size mismatch (${file.byteLength} != ${entry.size})`)
  }
  if ('sha256' in entry && entry.sha256 !== digest) {
    throw new Error(`${entry.path}: sha256 mismatch (${digest} != ${entry.sha256})`)
  }
}

console.log(`Verified ${entries.length} immutable model/Wasm assets in ${assetsDir}`)
