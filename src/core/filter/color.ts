export interface FilterParamColorValue {
  r: number
  g: number
  b: number
  a: number
}

function clampUnit(value: number, channel: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`滤镜颜色通道不是有效数字: ${channel}`)
  }
  return Math.min(1, Math.max(0, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHexPair(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 2), 16) / 255
}

function expandShortHex(hex: string): string {
  if (hex.length === 3 || hex.length === 4) {
    return hex
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
  }
  return hex
}

function parseRgbChannel(input: string, channel: string): number {
  const normalized = input.trim()
  if (normalized.endsWith('%')) {
    return clampUnit(Number.parseFloat(normalized.slice(0, -1)) / 100, channel)
  }
  return clampUnit(Number.parseFloat(normalized) / 255, channel)
}

function parseAlphaChannel(input: string): number {
  const normalized = input.trim()
  if (normalized.endsWith('%')) {
    return clampUnit(Number.parseFloat(normalized.slice(0, -1)) / 100, 'a')
  }
  return clampUnit(Number.parseFloat(normalized), 'a')
}

function parseRgbString(input: string): FilterParamColorValue | null {
  const match = input.trim().match(/^rgba?\((.+)\)$/i)
  if (!match) {
    return null
  }

  const channels = match[1].split(',').map((item) => item.trim())
  if (channels.length !== 3 && channels.length !== 4) {
    throw new Error('滤镜颜色值必须是合法的 rgb()/rgba()')
  }

  return {
    r: parseRgbChannel(channels[0], 'r'),
    g: parseRgbChannel(channels[1], 'g'),
    b: parseRgbChannel(channels[2], 'b'),
    a: channels.length === 4 ? parseAlphaChannel(channels[3]) : 1,
  }
}

export function normalizeFilterParamColor(value: unknown): FilterParamColorValue {
  if (typeof value === 'string') {
    const rgbColor = parseRgbString(value)
    if (rgbColor) {
      return rgbColor
    }

    const hex = expandShortHex(value.trim().replace('#', ''))
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) {
      throw new Error('滤镜颜色值必须是 #RGB、#RGBA、#RRGGBB、#RRGGBBAA 或 rgb()/rgba()')
    }

    return {
      r: clampUnit(parseHexPair(hex, 0), 'r'),
      g: clampUnit(parseHexPair(hex, 2), 'g'),
      b: clampUnit(parseHexPair(hex, 4), 'b'),
      a: clampUnit(hex.length === 8 ? parseHexPair(hex, 6) : 1, 'a'),
    }
  }

  if (Array.isArray(value)) {
    if (value.length !== 4) {
      throw new Error('滤镜颜色数组必须是长度为 4 的 RGBA')
    }

    return {
      r: clampUnit(Number(value[0]), 'r'),
      g: clampUnit(Number(value[1]), 'g'),
      b: clampUnit(Number(value[2]), 'b'),
      a: clampUnit(Number(value[3]), 'a'),
    }
  }

  if (isRecord(value)) {
    return {
      r: clampUnit(Number(value.r), 'r'),
      g: clampUnit(Number(value.g), 'g'),
      b: clampUnit(Number(value.b), 'b'),
      a: clampUnit(Number(value.a), 'a'),
    }
  }

  throw new Error('滤镜颜色值必须是 hex、RGBA 对象或 RGBA 数组')
}

export function colorToCssRgbaString(value: unknown): string {
  const normalized = normalizeFilterParamColor(value)
  const r = Math.round(normalized.r * 255)
  const g = Math.round(normalized.g * 255)
  const b = Math.round(normalized.b * 255)
  return `rgba(${r}, ${g}, ${b}, ${normalized.a.toFixed(3)})`
}

export function colorToHexRgbString(value: unknown): string {
  const normalized = normalizeFilterParamColor(value)
  const toHex = (channel: number) => Math.round(channel * 255).toString(16).padStart(2, '0')
  return `#${toHex(normalized.r)}${toHex(normalized.g)}${toHex(normalized.b)}`
}
