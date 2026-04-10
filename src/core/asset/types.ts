import { reactive } from 'vue'
import type { DataSourceRuntimeState } from '@/core/datasource/core/BaseDataSource'
import { RuntimeStateFactory, SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import type { TransitionPackagePayload } from '@/core/effect-package/types'
import type { MediaStatus, UnifiedMediaItemData } from '@/core/mediaitem/types'

export type AssetKind = 'media' | 'effect-template'

export type EffectType = 'transition' | 'filter' | 'animation'

export interface BaseEffectTemplateSourceData {
  type: 'effect-template'
  templateId: string
  catalogVersion?: string
}

export type EffectTemplateSourceData = BaseEffectTemplateSourceData & DataSourceRuntimeState

export type EffectTemplateStatus = MediaStatus

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
  templateStatus: EffectTemplateStatus
  templatePayload: TransitionPackagePayload | Record<string, unknown> | null
  runtime: EffectTemplateAssetRuntime
}

export type MediaLibraryAssetData = UnifiedMediaItemData & {
  assetKind: 'media'
}

export type UnifiedLibraryAssetData = MediaLibraryAssetData | EffectTemplateAssetData

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
  return reactive({
    type: 'effect-template' as const,
    templateId: '',
    ...RuntimeStateFactory.createRuntimeState(SourceOrigin.USER_CREATE),
  }) as EffectTemplateSourceData
}

export function createEffectTemplateSourceDataFromTemplate(
  templateId: string,
  catalogVersion?: string,
  sourceOrigin: SourceOrigin = SourceOrigin.USER_CREATE,
): EffectTemplateSourceData {
  return reactive({
    type: 'effect-template' as const,
    templateId,
    ...(catalogVersion ? { catalogVersion } : {}),
    ...RuntimeStateFactory.createRuntimeState(sourceOrigin),
  }) as EffectTemplateSourceData
}

export function extractEffectTemplateSourceData(
  source: EffectTemplateSourceData,
): BaseEffectTemplateSourceData {
  return {
    type: 'effect-template',
    templateId: source.templateId,
    ...(source.catalogVersion ? { catalogVersion: source.catalogVersion } : {}),
  }
}

export function isReadyEffectTemplateAsset(
  asset: UnifiedLibraryAssetData | null | undefined,
): asset is EffectTemplateAssetData & { templateStatus: 'ready' } {
  return asset?.assetKind === 'effect-template' && asset.templateStatus === 'ready'
}

export function createTransitionTemplateAssetData(
  id: string,
  name: string,
  payload: TransitionPackagePayload | null,
  options?: Partial<EffectTemplateAssetData>,
): EffectTemplateAssetData {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    assetKind: 'effect-template',
    effectType: 'transition',
    source: createEffectTemplateSourceDataFromTemplate(
      payload?.packageId ?? options?.source?.templateId ?? id,
      options?.source?.catalogVersion,
      SourceOrigin.PROJECT_LOAD,
    ),
    templateStatus: payload ? 'ready' : 'pending',
    templatePayload: payload,
    runtime: {},
    ...options,
  }
}
