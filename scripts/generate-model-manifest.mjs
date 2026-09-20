import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const modelSourcesDir = path.join(projectRoot, 'model-sources')
const outputFile = path.join(projectRoot, 'src', 'generated', 'model-manifest.ts')
const defaultAssetsDir = path.join(projectRoot, '.model-assets')
const assetsDirArgumentIndex = process.argv.indexOf('--assets-dir')
const assetsDir = path.resolve(
  assetsDirArgumentIndex >= 0
    ? (process.argv[assetsDirArgumentIndex + 1] ?? defaultAssetsDir)
    : (process.env.LIGHTCUT_ASSETS_DIR ?? defaultAssetsDir),
)

function assertSafeAssetsDirectory(directory) {
  const relativePath = path.relative(projectRoot, directory)
  const isInsideProject =
    relativePath &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  if (path.basename(directory) !== '.model-assets' || !isInsideProject) {
    throw new Error(`资源目录必须是仓库内的 .model-assets 目录: ${directory}`)
  }
}

assertSafeAssetsDirectory(assetsDir)
const MODEL_CHUNK_SIZE = 4 * 1024 * 1024
const ORT_WASM_FILE_NAME = 'ort-wasm-simd-threaded.asyncify.wasm'
const ORT_WASM_MODULE_FILE_NAME = 'ort-wasm-simd-threaded.asyncify.mjs'
const REQUIRED_MODEL_IDS = [
  'beat_this_small0',
  'transnetv2',
  'htdemucs-core',
  ...Array.from({ length: 8 }, (_, index) => `harmonix-fold${index}`),
]

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function writeModelChunks(modelId, version, fileBuffer) {
  const totalChunks = Math.ceil(fileBuffer.byteLength / MODEL_CHUNK_SIZE)
  const modelChunkDir = path.join(assetsDir, 'models', modelId, version)
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
      path: `models/${modelId}/${version}/${chunkFileName}`,
      size: chunkBuffer.byteLength,
      sha256: sha256(chunkBuffer),
    })
  }

  return chunks
}

async function addWasmAsset(manifest, id, sourcePath, destinationPrefix, destinationName) {
  const sourceBuffer = await fs.readFile(sourcePath)
  const version = `sha256-${sha256(sourceBuffer)}`
  const relativePath = `wasm/${destinationPrefix}/${version}/${destinationName}`
  const destinationPath = path.join(assetsDir, relativePath)
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.writeFile(destinationPath, sourceBuffer)
  manifest[id] = {
    path: relativePath,
    version,
    size: sourceBuffer.byteLength,
    sha256: version.slice('sha256-'.length),
  }
}

async function buildManifest() {
  const manifest = {}
  const wasmManifest = {}
  const hasModelSourcesDir = await fs
    .access(modelSourcesDir)
    .then(() => true)
    .catch(() => false)

  if (hasModelSourcesDir) {
    const modelFiles = await collectOnnxFiles(modelSourcesDir)
    for (const filePath of modelFiles.sort()) {
      const relativePath = path.relative(modelSourcesDir, filePath)
      const modelId = toModelId(relativePath)

      if (manifest[modelId]) {
        throw new Error(`重复的模型 ID: ${modelId}`)
      }

      const fileBuffer = await fs.readFile(filePath)
      const version = `sha256-${sha256(fileBuffer)}`
      const chunks = await writeModelChunks(modelId, version, fileBuffer)
      manifest[modelId] = {
        version,
        size: fileBuffer.byteLength,
        chunkSize: MODEL_CHUNK_SIZE,
        sha256: version.slice('sha256-'.length),
        chunks,
      }
    }

    const missingModels = REQUIRED_MODEL_IDS.filter((modelId) => !manifest[modelId])
    if (missingModels.length > 0) {
      throw new Error(`缺少运行时模型: ${missingModels.join(', ')}`)
    }
  }

  const dspPath = path.join(
    projectRoot,
    'src',
    'core',
    'utils',
    'music-analysis',
    'dsp-engine.wasm',
  )
  if (
    await fs
      .access(dspPath)
      .then(() => true)
      .catch(() => false)
  ) {
    await addWasmAsset(wasmManifest, 'dsp', dspPath, 'music-analysis', 'dsp-engine.wasm')
  }

  const ortPath = path.join(
    projectRoot,
    'node_modules',
    'onnxruntime-web',
    'dist',
    ORT_WASM_FILE_NAME,
  )
  const ortModulePath = path.join(
    projectRoot,
    'node_modules',
    'onnxruntime-web',
    'dist',
    ORT_WASM_MODULE_FILE_NAME,
  )
  if (
    await fs
      .access(ortPath)
      .then(() => true)
      .catch(() => false)
  ) {
    await addWasmAsset(wasmManifest, 'ort', ortPath, 'onnxruntime', ORT_WASM_FILE_NAME)
  }
  if (
    await fs
      .access(ortModulePath)
      .then(() => true)
      .catch(() => false)
  ) {
    await addWasmAsset(
      wasmManifest,
      'ortMjs',
      ortModulePath,
      'onnxruntime',
      ORT_WASM_MODULE_FILE_NAME,
    )
  }

  if (!wasmManifest.dsp || !wasmManifest.ort || !wasmManifest.ortMjs) {
    throw new Error('缺少 DSP 或 ONNX Runtime Wasm 模块，请先运行 npm run assets:prepare')
  }

  return { manifest, wasmManifest }
}

async function writeManifestFiles({ manifest, wasmManifest }) {
  const manifestPayload = {
    schemaVersion: 1,
    models: manifest,
    wasm: wasmManifest,
  }
  const manifestJson = JSON.stringify(manifestPayload, null, 2)
  const manifestVersion = `sha256-${sha256(Buffer.from(JSON.stringify(manifestPayload)))}`
  const manifestDirectory = path.join(assetsDir, 'manifests', 'models')
  await fs.mkdir(manifestDirectory, { recursive: true })
  await fs.writeFile(path.join(manifestDirectory, `${manifestVersion}.json`), `${manifestJson}\n`)
  await fs.writeFile(path.join(manifestDirectory, 'latest.json'), `${manifestJson}\n`)

  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  const content = `export const modelManifest = ${JSON.stringify(manifest, null, 2)} as const

export const wasmManifest = ${JSON.stringify(wasmManifest, null, 2)} as const

export type ModelManifest = typeof modelManifest
export type WasmManifest = typeof wasmManifest
`
  await fs.writeFile(outputFile, content, 'utf8')
}

await fs.rm(assetsDir, { recursive: true, force: true })
const generated = await buildManifest()
await writeManifestFiles(generated)
