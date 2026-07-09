import fs from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = process.cwd()
const TARGET_DIRS = [
  'src/aipanel/aigenerate/configs',
  'src/core/datasource/providers/bizyair/configs',
]
const MONEY_KEYS = new Set(['cost', 'real_cost', 'add_cost', 'add_real_cost'])
const DECIMAL_PATTERN = /^-?(?:0|[0-9]+)(?:\.[0-9]+)?$/

function canonicalizeDecimalString(value) {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`invalid decimal string: ${value}`)
  }

  let sign = ''
  let unsigned = value
  if (unsigned.startsWith('-')) {
    sign = '-'
    unsigned = unsigned.slice(1)
  }

  const [rawInteger, rawFraction = ''] = unsigned.split('.')
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0'
  const fraction = rawFraction.replace(/0+$/, '')

  if (integer === '0' && fraction === '') {
    return '0'
  }

  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`
}

function validateMoneyValue(value, filePath, jsonPath) {
  if (value === null) {
    return
  }

  if (typeof value === 'string') {
    const canonical = canonicalizeDecimalString(value)
    if (canonical !== value) {
      throw new Error(`${filePath}:${jsonPath} must be canonical money string, got "${value}"`)
    }
    return
  }

  if (typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      validateMoneyValue(nestedValue, filePath, `${jsonPath}.${key}`)
    }
    return
  }

  throw new Error(`${filePath}:${jsonPath} must be money string or null`)
}

function walkJson(node, filePath, currentPath = '$') {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkJson(item, filePath, `${currentPath}[${index}]`))
    return
  }

  if (!node || typeof node !== 'object') {
    return
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = `${currentPath}.${key}`
    if (MONEY_KEYS.has(key)) {
      validateMoneyValue(value, filePath, nextPath)
    }
    walkJson(value, filePath, nextPath)
  }
}

function collectJsonFiles(dirPath) {
  const absoluteDir = path.join(PROJECT_ROOT, dirPath)
  if (!fs.existsSync(absoluteDir)) {
    return []
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(path.relative(PROJECT_ROOT, fullPath)))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath)
    }
  }

  return files
}

const files = TARGET_DIRS.flatMap(collectJsonFiles)

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(content)
  walkJson(parsed, path.relative(PROJECT_ROOT, filePath))
}

console.log(`Validated money configs: ${files.length} files`)
