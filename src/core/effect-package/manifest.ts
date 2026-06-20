import type {
  EffectPackageManifest,
  EffectPackageParameterDefinition,
  FilterEffectPackageHost,
  FilterPackagePayload,
  TransitionEffectPackageHost,
  TransitionPackagePayload,
} from '@/core/effect-package/types'
import { normalizeFilterParamColor } from '@/core/filter/color'

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

function normalizeFloatValue(value: unknown, parameterKey: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`effect package float parameter 缺少有效默认值: ${parameterKey}`)
  }
  return value
}

function normalizeIntValue(value: unknown, parameterKey: string): number {
  const numericValue = normalizeFloatValue(value, parameterKey)
  return Math.round(numericValue)
}

type VectorField = 'x' | 'y' | 'z' | 'w'

function normalizeVectorValue<const TFields extends readonly VectorField[]>(
  value: unknown,
  fields: TFields,
  type: 'vec2' | 'ivec2' | 'vec3' | 'vec4',
  parameterKey: string,
): Record<TFields[number], number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`effect package ${type} parameter 默认值必须是对象: ${parameterKey}`)
  }

  const record = value as Record<string, unknown>
  const normalized: Partial<Record<VectorField, number>> = {}
  for (const field of fields) {
    const numericValue = Number(record[field])
    if (!Number.isFinite(numericValue)) {
      throw new Error(`effect package ${type} parameter 默认值必须包含有效 ${fields.join('/')}: ${parameterKey}`)
    }
    normalized[field] = type === 'ivec2' ? Math.round(numericValue) : numericValue
  }

  return normalized as Record<TFields[number], number>
}

function normalizeVec2Value(value: unknown, parameterKey: string): { x: number; y: number } {
  return normalizeVectorValue(value, ['x', 'y'] as const, 'vec2', parameterKey)
}

function normalizeIvec2Value(value: unknown, parameterKey: string): { x: number; y: number } {
  return normalizeVectorValue(value, ['x', 'y'] as const, 'ivec2', parameterKey)
}

function normalizeVec3Value(value: unknown, parameterKey: string): { x: number; y: number; z: number } {
  return normalizeVectorValue(value, ['x', 'y', 'z'] as const, 'vec3', parameterKey)
}

function normalizeVec4Value(value: unknown, parameterKey: string): { x: number; y: number; z: number; w: number } {
  return normalizeVectorValue(value, ['x', 'y', 'z', 'w'] as const, 'vec4', parameterKey)
}

function normalizeOptionalFiniteNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    throw new Error(`effect package parameter ${fieldName} 必须是有限数字`)
  }
  return numericValue
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
      throw new Error(`effect package parameter 定义非法: ${key}`)
    }

    const definition = value as Record<string, unknown>
    const type = String(definition.type ?? '').trim() as EffectPackageParameterDefinition['type']
    if (!['float', 'int', 'boolean', 'color', 'vec2', 'ivec2', 'vec3', 'vec4'].includes(type)) {
      throw new Error(`effect package parameter type 非法: ${key}`)
    }

    parameters[key] = {
      type,
      default: definition.default,
      min: normalizeOptionalFiniteNumber(definition.min, `${key}.min`),
      max: normalizeOptionalFiniteNumber(definition.max, `${key}.max`),
      step: normalizeOptionalFiniteNumber(definition.step, `${key}.step`),
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
      case 'float':
        defaults[key] = normalizeFloatValue(value, key)
        break
      case 'int':
        defaults[key] = normalizeIntValue(value, key)
        break
      case 'boolean':
        defaults[key] = Boolean(value)
        break
      case 'color':
        defaults[key] = normalizeFilterParamColor(value)
        break
      case 'vec2':
        defaults[key] = normalizeVec2Value(value, key)
        break
      case 'ivec2':
        defaults[key] = normalizeIvec2Value(value, key)
        break
      case 'vec3':
        defaults[key] = normalizeVec3Value(value, key)
        break
      case 'vec4':
        defaults[key] = normalizeVec4Value(value, key)
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
