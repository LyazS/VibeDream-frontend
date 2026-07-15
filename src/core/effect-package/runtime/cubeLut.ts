import type { EffectResourceVector3 } from '@/core/effect-package/types'

export interface ParsedCubeLut {
  size: number
  domainMin: EffectResourceVector3
  domainMax: EffectResourceVector3
  data: Uint8Array
}

const DEFAULT_DOMAIN_MIN: EffectResourceVector3 = [0, 0, 0]
const DEFAULT_DOMAIN_MAX: EffectResourceVector3 = [1, 1, 1]

function parseVector3(
  parts: string[],
  keyword: string,
  lineNumber: number,
): EffectResourceVector3 {
  if (parts.length !== 4) {
    throw new Error(`.cube ${keyword} 必须包含 3 个数值: line ${lineNumber}`)
  }

  const values = parts.slice(1).map((part) => Number(part))
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`.cube ${keyword} 包含无效数值: line ${lineNumber}`)
  }

  return values as EffectResourceVector3
}

function toByte(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return Math.round(clamped * 255)
}

export function parseCubeLut(source: string): ParsedCubeLut {
  const lines = source.split(/\r?\n/)
  let size: number | null = null
  let domainMin: EffectResourceVector3 = [...DEFAULT_DOMAIN_MIN] as EffectResourceVector3
  let domainMax: EffectResourceVector3 = [...DEFAULT_DOMAIN_MAX] as EffectResourceVector3
  const rows: number[][] = []

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const trimmed = lines[index].trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const parts = trimmed.split(/\s+/)
    const keyword = parts[0]

    if (keyword === 'TITLE') {
      continue
    }

    if (keyword === 'LUT_1D_SIZE') {
      throw new Error(`不支持 LUT_1D_SIZE: line ${lineNumber}`)
    }

    if (keyword === 'LUT_3D_SIZE') {
      if (parts.length !== 2) {
        throw new Error(`.cube LUT_3D_SIZE 格式无效: line ${lineNumber}`)
      }

      const parsedSize = Math.round(Number(parts[1]))
      if (!Number.isFinite(parsedSize) || parsedSize < 2) {
        throw new Error(`.cube LUT_3D_SIZE 必须大于等于 2: line ${lineNumber}`)
      }

      size = parsedSize
      continue
    }

    if (keyword === 'DOMAIN_MIN') {
      domainMin = parseVector3(parts, keyword, lineNumber)
      continue
    }

    if (keyword === 'DOMAIN_MAX') {
      domainMax = parseVector3(parts, keyword, lineNumber)
      continue
    }

    if (parts.length !== 3) {
      throw new Error(`.cube 数据行格式无效: line ${lineNumber}`)
    }

    const values = parts.map((part) => Number(part))
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`.cube 数据行包含无效数值: line ${lineNumber}`)
    }
    rows.push(values)
  }

  if (size === null) {
    throw new Error('.cube 缺少 LUT_3D_SIZE')
  }

  if (
    domainMax[0] <= domainMin[0]
    || domainMax[1] <= domainMin[1]
    || domainMax[2] <= domainMin[2]
  ) {
    throw new Error('.cube DOMAIN_MAX 必须大于 DOMAIN_MIN')
  }

  const expectedRows = size * size * size
  if (rows.length !== expectedRows) {
    throw new Error(`.cube 数据行数量错误: expected ${expectedRows}, got ${rows.length}`)
  }

  const data = new Uint8Array(expectedRows * 4)
  rows.forEach((row, rowIndex) => {
    const offset = rowIndex * 4
    data[offset] = toByte(row[0])
    data[offset + 1] = toByte(row[1])
    data[offset + 2] = toByte(row[2])
    data[offset + 3] = 255
  })

  return {
    size,
    domainMin,
    domainMax,
    data,
  }
}
