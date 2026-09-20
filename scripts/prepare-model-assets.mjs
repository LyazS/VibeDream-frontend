import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, ['scripts/download-music-analysis-models.mjs'])
run(process.execPath, ['scripts/build-music-analysis-wasm.mjs'])
run(process.execPath, ['scripts/generate-model-manifest.mjs', '--assets-dir', '.model-assets'])
