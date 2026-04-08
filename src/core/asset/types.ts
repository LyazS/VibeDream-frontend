import type { BaseDataSourcePersistedData } from '@/core/datasource/core/DataSourceTypes'
import type { TransitionShaderResource } from '@/core/transition/types'
import type {
  MediaStatus,
  MediaTypeOrUnknown,
  UnifiedMediaItemData,
  UnifiedMediaItemMetadata,
} from '@/core/mediaitem/types'

export type AssetKind = 'media' | 'effect-template'

export type EffectType = 'transition' | 'filter' | 'animation'

export interface EffectTemplateSourceData {
  type: 'effect-template'
}

export interface TransitionTemplatePayload {
  durationFrames: number
  shader: TransitionShaderResource
}

export interface EffectTemplateAssetRuntime {
  refCount?: number
}

export interface EffectTemplateAssetData {
  readonly id: string
  name: string
  createdAt: string
  assetKind: 'effect-template'
  effectType: EffectType
  source: EffectTemplateSourceData
  templatePayload: TransitionTemplatePayload | Record<string, unknown>
  runtime: EffectTemplateAssetRuntime
}

export type MediaLibraryAssetData = UnifiedMediaItemData & {
  assetKind: 'media'
}

export type UnifiedLibraryAssetData = MediaLibraryAssetData | EffectTemplateAssetData

export interface LibraryAssetMetaFile {
  version: string
  id: string
  name: string
  createdAt: string
  assetKind: AssetKind
  source: BaseDataSourcePersistedData | EffectTemplateSourceData
  mediaType?: MediaTypeOrUnknown
  mediaStatus?: MediaStatus
  duration?: number
  metadata?: UnifiedMediaItemMetadata
  effectType?: EffectType
  templatePayload?: unknown
}

export function isMediaAsset(
  asset: UnifiedLibraryAssetData | null | undefined,
): asset is MediaLibraryAssetData {
  return asset?.assetKind === 'media'
}

export function isEffectTemplateAsset(
  asset: UnifiedLibraryAssetData | null | undefined,
): asset is EffectTemplateAssetData {
  return asset?.assetKind === 'effect-template'
}

export function createEffectTemplateSourceData(): EffectTemplateSourceData {
  return {
    type: 'effect-template',
  }
}

export function createTransitionTemplateAssetData(
  id: string,
  name: string,
  payload: TransitionTemplatePayload,
  options?: Partial<EffectTemplateAssetData>,
): EffectTemplateAssetData {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    assetKind: 'effect-template',
    effectType: 'transition',
    source: createEffectTemplateSourceData(),
    templatePayload: payload,
    runtime: {},
    ...options,
  }
}
