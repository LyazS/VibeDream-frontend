import type { LocalizedTagList, LocalizedText } from '@/core/effect-template/catalogTypes'

export type EffectPackageParameterType = 'number' | 'boolean' | 'color' | 'vec2'

export interface TransitionEffectPackageHost {
  transition: {
    defaultDurationFrames: number
  }
}

export interface EffectPackageParameterDefinition {
  type: EffectPackageParameterType
  default?: unknown
  min?: number
  max?: number
  step?: number
}

export interface EffectPackageManifestSnapshot {
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
}

export interface EffectPackageManifest {
  apiVersion: '1.0'
  effectType: 'transition'
  packageId: string
  version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
  entry: string
  host: TransitionEffectPackageHost
  parameters: Record<string, EffectPackageParameterDefinition>
  sort_order: number
  is_active: boolean
}

export interface TransitionPackagePayload {
  packageDir: string
  packageId: string
  version: string
  entryFile: string
  host: TransitionEffectPackageHost
  parameterSchema: Record<string, EffectPackageParameterDefinition>
  defaultParams: Record<string, unknown>
  manifestSnapshot: EffectPackageManifestSnapshot
  scriptHash: string
}

export interface LoadedEffectPackage {
  assetId: string
  packageDir: string
  manifest: EffectPackageManifest
  entrySource: string
  textResourcePaths: Map<string, string>
  textResources: Map<string, string>
  pendingTextLoads: Map<string, Promise<string>>
  textureResourcePaths: Map<string, string>
  textureResources: Map<string, ImageBitmap>
  pendingTextureLoads: Map<string, Promise<ImageBitmap>>
  payload: TransitionPackagePayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTransitionEffectPackageHost(value: unknown): value is TransitionEffectPackageHost {
  if (!isRecord(value) || !isRecord(value.transition)) {
    return false
  }

  const defaultDurationFrames = value.transition.defaultDurationFrames
  return typeof defaultDurationFrames === 'number'
    && Number.isFinite(defaultDurationFrames)
    && defaultDurationFrames >= 2
}

export function isTransitionPackagePayload(value: unknown): value is TransitionPackagePayload {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.packageDir === 'string'
    && typeof value.packageId === 'string'
    && typeof value.version === 'string'
    && typeof value.entryFile === 'string'
    && isTransitionEffectPackageHost(value.host)
    && isRecord(value.parameterSchema)
    && isRecord(value.defaultParams)
    && isRecord(value.manifestSnapshot)
    && typeof value.scriptHash === 'string'
}
