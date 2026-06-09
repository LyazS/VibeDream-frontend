import type {
  EffectPackageManifest,
  EffectPackageParameterDefinition,
  FilterEffectPackageHost,
  FilterPackagePayload,
  TransitionEffectPackageHost,
  TransitionPackagePayload,
} from '@/core/effect-package/types'

const EFFECT_PACKAGE_PARAMETER_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_EFFECT_PACKAGE_PARAMETER_KEYS = new Set([
  'intensity',
  'params',
  'packagePayload',
  'effectPackageId',
  'templateId',
  'packageVersion',
  'catalogVersion',
])

function normalizeLocalizedText(value: unknown, fallback: string): { zh: string; en: string } {
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const zh = String(record.zh ?? fallback).trim() || fallback
    const en = String(record.en ?? fallback).trim() || fallback
    return { zh, en }
  }

  const normalized = String(value ?? fallback).trim() || fallback
  return { zh: normalized, en: normalized }
}

function normalizeLocalizedTags(value: unknown): { zh: string[]; en: string[] } {
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const zh = Array.isArray(record.zh) ? record.zh.map((item) => String(item).trim()).filter(Boolean) : []
    const en = Array.isArray(record.en) ? record.en.map((item) => String(item).trim()).filter(Boolean) : []
    return { zh, en }
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter(Boolean)
    return { zh: normalized, en: normalized }
  }

  return { zh: [], en: [] }
}

function normalizeCategory(
  value: unknown,
  fallbackKey: string,
): { key: string; label: { zh: string; en: string } } {
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const key = String(record.key ?? fallbackKey).trim() || fallbackKey
    return {
      key,
      label: normalizeLocalizedText(record.label, key),
    }
  }

  const normalized = String(value ?? fallbackKey).trim() || fallbackKey
  return {
    key: normalized,
    label: { zh: normalized, en: normalized },
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/')
}

function normalizeNumberArray(value: unknown, size: number): number[] {
  if (!Array.isArray(value) || value.length !== size) {
    return new Array(size).fill(0)
  }

  return value.map((item) => Number(item) || 0)
}

function parseHexColor(input: string): [number, number, number, number] {
  const hex = input.trim().replace('#', '')
  if (hex.length !== 6 && hex.length !== 8) {
    return [1, 1, 1, 1]
  }

  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  return [r, g, b, a]
}

export function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}

function normalizeTransitionHost(value: unknown): TransitionEffectPackageHost {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('transition effect package 缺少 host.transition.defaultDurationFrames')
  }

  const hostPayload = value as Record<string, unknown>
  if (typeof hostPayload.transition !== 'object' || hostPayload.transition === null || Array.isArray(hostPayload.transition)) {
    throw new Error('transition effect package 缺少 host.transition.defaultDurationFrames')
  }

  const transitionPayload = hostPayload.transition as Record<string, unknown>
  const rawDefaultDurationFrames = transitionPayload.defaultDurationFrames
  if (typeof rawDefaultDurationFrames !== 'number' || !Number.isFinite(rawDefaultDurationFrames)) {
    throw new Error('transition effect package 缺少有效的 host.transition.defaultDurationFrames')
  }

  const defaultDurationFrames = Math.round(rawDefaultDurationFrames)
  if (defaultDurationFrames < 2) {
    throw new Error('transition effect package 的 host.transition.defaultDurationFrames 必须大于等于 2')
  }

  return {
    transition: {
      defaultDurationFrames,
    },
  }
}

function normalizeFilterHost(value: unknown): FilterEffectPackageHost {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('filter effect package 缺少 host.filter.supportedMediaTypes')
  }

  const hostPayload = value as Record<string, unknown>
  if (typeof hostPayload.filter !== 'object' || hostPayload.filter === null || Array.isArray(hostPayload.filter)) {
    throw new Error('filter effect package 缺少 host.filter.supportedMediaTypes')
  }

  const filterPayload = hostPayload.filter as Record<string, unknown>
  const supportedMediaTypes = Array.isArray(filterPayload.supportedMediaTypes)
    ? filterPayload.supportedMediaTypes.map((item) => String(item).trim()).filter(Boolean)
    : []

  if (supportedMediaTypes.length === 0 || supportedMediaTypes.some((item) => item !== 'video' && item !== 'image')) {
    throw new Error('filter effect package 的 host.filter.supportedMediaTypes 仅允许 video/image')
  }

  return {
    filter: {
      supportedMediaTypes: supportedMediaTypes as Array<'video' | 'image'>,
    },
  }
}

export function normalizeManifest(raw: unknown): EffectPackageManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('effect package manifest 必须是对象')
  }

  const payload = raw as Record<string, unknown>
  const apiVersion = String(payload.apiVersion ?? '').trim()
  const effectType = String(payload.effectType ?? '').trim()
  const packageId = String(payload.packageId ?? '').trim()
  const version = String(payload.version ?? '').trim()
  const entry = normalizePath(String(payload.entry ?? '').trim())

  if (apiVersion !== '1.0') {
    throw new Error(`不支持的 effect package apiVersion: ${apiVersion || '(empty)'}`)
  }
  if (effectType !== 'transition' && effectType !== 'filter') {
    throw new Error(`不支持的 effect package effectType: ${effectType || '(empty)'}`)
  }
  if (!packageId) {
    throw new Error('effect package 缺少 packageId')
  }
  if (!version) {
    throw new Error('effect package 缺少 version')
  }
  if (!entry) {
    throw new Error('effect package 缺少 entry')
  }

  const parametersRaw =
    typeof payload.parameters === 'object' && payload.parameters && !Array.isArray(payload.parameters)
      ? (payload.parameters as Record<string, unknown>)
      : {}

  const parameters: Record<string, EffectPackageParameterDefinition> = {}
  for (const [key, value] of Object.entries(parametersRaw)) {
    if (!EFFECT_PACKAGE_PARAMETER_KEY_PATTERN.test(key)) {
      throw new Error(`effect package parameter key 非法: ${key}`)
    }
    if (RESERVED_EFFECT_PACKAGE_PARAMETER_KEYS.has(key)) {
      throw new Error(`effect package parameter key 使用了保留字段: ${key}`)
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue
    }

    const definition = value as Record<string, unknown>
    const type = String(definition.type ?? '').trim() as EffectPackageParameterDefinition['type']
    if (!['number', 'boolean', 'color', 'vec2'].includes(type)) {
      continue
    }

    parameters[key] = {
      type,
      default: definition.default,
      min: definition.min === undefined ? undefined : Number(definition.min),
      max: definition.max === undefined ? undefined : Number(definition.max),
      step: definition.step === undefined ? undefined : Number(definition.step),
    }
  }

  const base = {
    apiVersion: '1.0' as const,
    packageId,
    version,
    name: normalizeLocalizedText(payload.name, packageId),
    category: normalizeCategory(payload.category, packageId),
    summary: normalizeLocalizedText(payload.summary, ''),
    tags: normalizeLocalizedTags(payload.tags),
    cover: payload.cover ? normalizePath(String(payload.cover)) : null,
    entry,
    parameters,
    sort_order: Math.round(Number(payload.sort_order ?? 0) || 0),
    is_active: payload.is_active === undefined ? true : Boolean(payload.is_active),
  }

  if (effectType === 'transition') {
    return {
      ...base,
      effectType: 'transition',
      host: normalizeTransitionHost(payload.host),
    }
  }

  return {
    ...base,
    effectType: 'filter',
    host: normalizeFilterHost(payload.host),
  }
}

export function resolveDefaultParams(
  parameters: Record<string, EffectPackageParameterDefinition>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(parameters)) {
    const value = definition.default
    switch (definition.type) {
      case 'number':
        defaults[key] = Number(value ?? 0)
        break
      case 'boolean':
        defaults[key] = Boolean(value)
        break
      case 'color':
        defaults[key] = typeof value === 'string' ? parseHexColor(value) : normalizeNumberArray(value, 4)
        break
      case 'vec2':
        defaults[key] = normalizeNumberArray(value, 2)
        break
    }
  }

  return defaults
}

export function buildTransitionPackagePayload(
  packageDir: string,
  manifest: Extract<EffectPackageManifest, { effectType: 'transition' }>,
  scriptHash: string,
): TransitionPackagePayload {
  return {
    effectType: 'transition',
    packageDir: normalizePath(packageDir),
    packageId: manifest.packageId,
    version: manifest.version,
    entryFile: manifest.entry,
    host: {
      transition: {
        defaultDurationFrames: manifest.host.transition.defaultDurationFrames,
      },
    },
    parameterSchema: manifest.parameters,
    defaultParams: resolveDefaultParams(manifest.parameters),
    manifestSnapshot: {
      name: manifest.name,
      category: manifest.category,
      summary: manifest.summary,
      tags: manifest.tags,
      cover: manifest.cover ?? null,
    },
    scriptHash,
  }
}

export function buildFilterPackagePayload(
  packageDir: string,
  manifest: Extract<EffectPackageManifest, { effectType: 'filter' }>,
  scriptHash: string,
): FilterPackagePayload {
  return {
    effectType: 'filter',
    packageDir: normalizePath(packageDir),
    packageId: manifest.packageId,
    version: manifest.version,
    entryFile: manifest.entry,
    host: {
      filter: {
        supportedMediaTypes: [...manifest.host.filter.supportedMediaTypes],
      },
    },
    parameterSchema: manifest.parameters,
    defaultParams: resolveDefaultParams(manifest.parameters),
    manifestSnapshot: {
      name: manifest.name,
      category: manifest.category,
      summary: manifest.summary,
      tags: manifest.tags,
      cover: manifest.cover ?? null,
    },
    scriptHash,
  }
}

export function normalizePackageResourcePath(path: string): string {
  return normalizePath(path)
}
