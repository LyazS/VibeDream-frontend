import type {
  EffectTemplateCategory,
  LocalizedTagList,
  LocalizedText,
} from '@/core/effect-template/catalogTypes'

export type EffectPackageParameterType = 'number' | 'boolean' | 'color' | 'vec2'
export type FilterSupportedMediaType = 'video' | 'image'
export type EffectTextureDimension = '2d' | '3d'
export type EffectResourceVector3 = [number, number, number]

export interface TransitionEffectPackageHost {
  transition: {
    defaultDurationFrames: number
  }
}

export interface FilterEffectPackageHost {
  filter: {
    supportedMediaTypes: FilterSupportedMediaType[]
  }
}

export type EffectPackageHost = TransitionEffectPackageHost | FilterEffectPackageHost

export interface EffectPackageParameterDefinition {
  type: EffectPackageParameterType
  default?: unknown
  min?: number
  max?: number
  step?: number
}

export interface EffectPackageManifestSnapshot {
  name: LocalizedText
  category: EffectTemplateCategory
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
}

interface EffectPackageManifestBase {
  apiVersion: '1.0'
  packageId: string
  version: string
  name: LocalizedText
  category: EffectTemplateCategory
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
  entry: string
  parameters: Record<string, EffectPackageParameterDefinition>
  sort_order: number
  is_active: boolean
}

export interface TransitionEffectPackageManifest extends EffectPackageManifestBase {
  effectType: 'transition'
  host: TransitionEffectPackageHost
}

export interface FilterEffectPackageManifest extends EffectPackageManifestBase {
  effectType: 'filter'
  host: FilterEffectPackageHost
}

export type EffectPackageManifest =
  | TransitionEffectPackageManifest
  | FilterEffectPackageManifest

interface EffectPackagePayloadBase {
  packageDir: string
  packageId: string
  version: string
  entryFile: string
  parameterSchema: Record<string, EffectPackageParameterDefinition>
  defaultParams: Record<string, unknown>
  manifestSnapshot: EffectPackageManifestSnapshot
  scriptHash: string
}

export interface TransitionPackagePayload extends EffectPackagePayloadBase {
  effectType: 'transition'
  host: TransitionEffectPackageHost
}

export interface FilterPackagePayload extends EffectPackagePayloadBase {
  effectType: 'filter'
  host: FilterEffectPackageHost
}

export type AnyEffectPackagePayload = TransitionPackagePayload | FilterPackagePayload

export interface LoadedEffectImageResource {
  kind: 'image-2d'
  bitmap: ImageBitmap
}

export interface LoadedEffectLut3DResource {
  kind: 'lut-3d'
  size: number
  domainMin: EffectResourceVector3
  domainMax: EffectResourceVector3
  data: Uint8Array
}

export type LoadedEffectPackageSampledResource =
  | LoadedEffectImageResource
  | LoadedEffectLut3DResource

export interface EffectPackageSampledResourceDescriptor {
  absolutePath: string
  dimension: EffectTextureDimension
  resourceType: LoadedEffectPackageSampledResource['kind']
}

export interface EffectPackageLut3DResourceInfo {
  textureRef: string
  size: number
  domainMin: EffectResourceVector3
  domainMax: EffectResourceVector3
}

export interface LoadedEffectPackage {
  effectPackageId: string
  packageDir: string
  manifest: EffectPackageManifest
  entrySource: string
  textResourcePaths: Map<string, string>
  textResources: Map<string, string>
  pendingTextLoads: Map<string, Promise<string>>
  sampledResourceDescriptors: Map<string, EffectPackageSampledResourceDescriptor>
  sampledResources: Map<string, LoadedEffectPackageSampledResource>
  pendingSampledResourceLoads: Map<string, Promise<LoadedEffectPackageSampledResource>>
  payload: AnyEffectPackagePayload
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

export function isFilterEffectPackageHost(value: unknown): value is FilterEffectPackageHost {
  if (!isRecord(value) || !isRecord(value.filter)) {
    return false
  }

  const supportedMediaTypes = value.filter.supportedMediaTypes
  return Array.isArray(supportedMediaTypes)
    && supportedMediaTypes.every((item) => item === 'video' || item === 'image')
}

export function isTransitionPackagePayload(value: unknown): value is TransitionPackagePayload {
  if (!isRecord(value)) {
    return false
  }

  return value.effectType === 'transition'
    && typeof value.packageDir === 'string'
    && typeof value.packageId === 'string'
    && typeof value.version === 'string'
    && typeof value.entryFile === 'string'
    && isTransitionEffectPackageHost(value.host)
    && isRecord(value.parameterSchema)
    && isRecord(value.defaultParams)
    && isRecord(value.manifestSnapshot)
    && typeof value.scriptHash === 'string'
}

export function isFilterPackagePayload(value: unknown): value is FilterPackagePayload {
  if (!isRecord(value)) {
    return false
  }

  return value.effectType === 'filter'
    && typeof value.packageDir === 'string'
    && typeof value.packageId === 'string'
    && typeof value.version === 'string'
    && typeof value.entryFile === 'string'
    && isFilterEffectPackageHost(value.host)
    && isRecord(value.parameterSchema)
    && isRecord(value.defaultParams)
    && isRecord(value.manifestSnapshot)
    && typeof value.scriptHash === 'string'
}
