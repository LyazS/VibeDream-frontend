import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const publicModelsDir = path.join(projectRoot, 'public', 'models')
const publicChunkDir = path.join(projectRoot, 'public', 'model-chunks')
const outputFile = path.join(projectRoot, 'src', 'generated', 'model-manifest.ts')
const MODEL_CHUNK_SIZE = 4 * 1024 * 1024

async function collectOnnxFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        return collectOnnxFiles(fullPath)
      }

      if (entry.isFile() && entry.name.endsWith('.onnx')) {
        return [fullPath]
      }

      return []
    }),
  )

  return files.flat()
}

function toModelId(relativePath) {
  return path.basename(relativePath, '.onnx')
}

function formatChunkIndex(index, total) {
  const width = String(total).length
  return String(index).padStart(width, '0')
}

async function writeModelChunks(modelId, fileBuffer) {
  const totalChunks = Math.ceil(fileBuffer.byteLength / MODEL_CHUNK_SIZE)
  const modelChunkDir = path.join(publicChunkDir, modelId)

  await fs.mkdir(modelChunkDir, { recursive: true })

  const chunks = []

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * MODEL_CHUNK_SIZE
    const end = Math.min(start + MODEL_CHUNK_SIZE, fileBuffer.byteLength)
    const chunkBuffer = fileBuffer.subarray(start, end)
    const chunkFileName = `part-${formatChunkIndex(index + 1, totalChunks)}.bin`
    const chunkFilePath = path.join(modelChunkDir, chunkFileName)

    await fs.writeFile(chunkFilePath, chunkBuffer)

    chunks.push({
      path: `model-chunks/${modelId}/${chunkFileName}`,
      size: chunkBuffer.byteLength,
    })
  }

  return chunks
}

async function cleanGeneratedChunks() {
  await fs.rm(publicChunkDir, { recursive: true, force: true })
}

async function buildManifest() {
  const manifest = {}
  const hasModelsDir = await fs
    .access(publicModelsDir)
    .then(() => true)
    .catch(() => false)

  if (!hasModelsDir) {
    return manifest
  }

  await cleanGeneratedChunks()

  const modelFiles = await collectOnnxFiles(publicModelsDir)

  for (const filePath of modelFiles.sort()) {
    const relativePath = path.relative(publicModelsDir, filePath)
    const modelId = toModelId(relativePath)

    if (manifest[modelId]) {
      throw new Error(`重复的模型 ID: ${modelId}`)
    }

    const fileBuffer = await fs.readFile(filePath)
    const hash = createHash('sha256').update(fileBuffer).digest('hex')
    const chunks = await writeModelChunks(modelId, fileBuffer)

    manifest[modelId] = {
      path: `models/${relativePath.split(path.sep).join('/')}`,
      version: `sha256-${hash}`,
      size: fileBuffer.byteLength,
      chunkSize: MODEL_CHUNK_SIZE,
      chunks,
    }
  }

  return manifest
}

async function writeManifestFile(manifest) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true })

  const content = `export const modelManifest = ${JSON.stringify(manifest, null, 2)} as const

export type ModelManifest = typeof modelManifest
`

  await fs.writeFile(outputFile, content, 'utf8')
}

const manifest = await buildManifest()
await writeManifestFile(manifest)
