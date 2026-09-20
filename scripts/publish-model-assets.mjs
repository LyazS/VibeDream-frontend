import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const assetsDir = path.resolve(
  process.env.LIGHTCUT_ASSETS_DIR ?? path.join(projectRoot, '.model-assets'),
)
const bucket = process.env.CLOUDFLARE_R2_BUCKET
const wrangler = process.env.WRANGLER_BIN ?? 'wrangler'
const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/$/, '')
const concurrency = Math.max(1, Number(process.env.CLOUDFLARE_R2_UPLOAD_CONCURRENCY ?? 3))
const maxAttempts = 3

if (!bucket) {
  throw new Error('请设置 CLOUDFLARE_R2_BUCKET，例如 lightcut-frontend-assets')
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(fullPath) : [fullPath]
    }),
  )
  return files.flat()
}

function contentType(filePath) {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.wasm')) return 'application/wasm'
  if (filePath.endsWith('.mjs')) return 'application/javascript'
  return 'application/octet-stream'
}

const files = (await collectFiles(assetsDir)).sort()

async function isAlreadyUploaded(key) {
  if (!publicBaseUrl) return false
  try {
    const response = await fetch(`${publicBaseUrl}/${key}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

function runUpload(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler, args, { cwd: projectRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`wrangler exited with ${code ?? signal}`))
    })
  })
}

async function uploadFile(filePath) {
  const key = path.relative(assetsDir, filePath).split(path.sep).join('/')
  const immutable = !key.endsWith('latest.json')
  if (immutable && (await isAlreadyUploaded(key))) {
    console.log(`Already uploaded: ${key}`)
    return
  }

  const args = [
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    '--file',
    filePath,
    '--remote',
    '--content-type',
    contentType(filePath),
    '--cache-control',
    immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60, must-revalidate',
  ]

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runUpload(args)
      return
    } catch (error) {
      if (attempt === maxAttempts) throw error
      console.warn(`Upload retry ${attempt}/${maxAttempts - 1}: ${key}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
    }
  }
}

let nextIndex = 0
async function worker() {
  while (nextIndex < files.length) {
    const filePath = files[nextIndex]
    nextIndex += 1
    await uploadFile(filePath)
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
console.log(`Published ${files.length} model/Wasm assets to ${bucket}`)
