import type { BaseDataSourcePersistedData } from '@/core/datasource/core/DataSourceTypes'
import type {
  BaseEffectTemplateSourceData,
  EffectTemplateStatus,
  EffectType,
} from '@/core/asset/types'
import type {
  MediaStatus,
  MediaTypeOrUnknown,
  UnifiedMediaItemMetadata,
} from '@/core/mediaitem/types'

export interface BaseLibraryAssetMetaFile {
  version: string
  id: string
  name: string
  createdAt: string
  assetKind: 'media' | 'effect-template'
}

export interface MediaLibraryAssetMetaFile extends BaseLibraryAssetMetaFile {
  assetKind: 'media'
  source: BaseDataSourcePersistedData
  mediaType: MediaTypeOrUnknown
  mediaStatus?: MediaStatus
  duration?: number
  metadata?: UnifiedMediaItemMetadata
}

export interface EffectTemplateLibraryAssetMetaFile extends BaseLibraryAssetMetaFile {
  assetKind: 'effect-template'
  source: BaseEffectTemplateSourceData
  effectType: EffectType
  templateStatus: EffectTemplateStatus
  templatePayload?: unknown
}

export type LibraryAssetMetaFile = MediaLibraryAssetMetaFile | EffectTemplateLibraryAssetMetaFile
export type MediaMetaFile = LibraryAssetMetaFile

export function isMediaLibraryAssetMetaFile(
  metaFile: LibraryAssetMetaFile | null | undefined,
): metaFile is MediaLibraryAssetMetaFile {
  return metaFile?.assetKind === 'media'
}

export function isEffectTemplateLibraryAssetMetaFile(
  metaFile: LibraryAssetMetaFile | null | undefined,
): metaFile is EffectTemplateLibraryAssetMetaFile {
  return metaFile?.assetKind === 'effect-template'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isUnifiedMediaVisualMetadata(
  value: unknown,
): value is NonNullable<UnifiedMediaItemMetadata['visual']> {
  if (!isRecord(value)) {
    return false
  }

  return isOptionalString(value.title) && isOptionalString(value.summary)
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number'
}

function isMediaTypeOrUnknown(value: unknown): value is MediaTypeOrUnknown {
  return ['video', 'image', 'audio', 'text', 'unknown'].includes(String(value))
}

function isMediaStatus(value: unknown): value is MediaStatus {
  return ['pending', 'asyncprocessing', 'decoding', 'ready', 'error', 'cancelled', 'missing']
    .includes(String(value))
}

function isEffectType(value: unknown): value is EffectType {
  return ['transition', 'filter', 'animation'].includes(String(value))
}

function isUnifiedMediaItemMetadata(value: unknown): value is UnifiedMediaItemMetadata {
  if (!isRecord(value)) {
    return false
  }

  return value.visual === undefined || isUnifiedMediaVisualMetadata(value.visual)
}

function isBaseEffectTemplateSourceData(value: unknown): value is BaseEffectTemplateSourceData {
  if (!isRecord(value)) {
    return false
  }

  return value.type === 'effect-template'
    && typeof value.templateId === 'string'
    && isOptionalString(value.catalogVersion)
}

function isMediaPersistedSourceData(value: unknown): value is BaseDataSourcePersistedData {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  switch (value.type) {
    case 'user-selected':
      return true
    case 'ai-generation':
      return typeof value.aiTaskId === 'string'
        && isRecord(value.requestParams)
        && typeof value.taskStatus === 'string'
        && (value.resultData === undefined || isRecord(value.resultData))
    case 'bizyair':
      return typeof value.bizyairTaskId === 'string'
        && isRecord(value.requestParams)
        && typeof value.taskStatus === 'string'
        && (value.resultData === undefined || isRecord(value.resultData))
    case 'asr':
      return typeof value.asrTaskId === 'string'
        && isRecord(value.requestConfig)
        && typeof value.taskStatus === 'string'
        && (value.resultData === undefined || isRecord(value.resultData))
        && isOptionalString(value.sourceTimelineItemId)
        && isOptionalString(value.placeholderTimelineItemId)
    default:
      return false
  }
}

function isBaseLibraryAssetMetaFile(value: unknown): value is BaseLibraryAssetMetaFile {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.version === 'string'
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && (value.assetKind === 'media' || value.assetKind === 'effect-template')
}

export function isMediaLibraryAssetMetaFileValue(
  value: unknown,
): value is MediaLibraryAssetMetaFile {
  if (!isBaseLibraryAssetMetaFile(value) || value.assetKind !== 'media') {
    return false
  }

  const candidate = value as unknown as Record<string, unknown>

  return isMediaPersistedSourceData(candidate.source)
    && isMediaTypeOrUnknown(candidate.mediaType)
    && (candidate.mediaStatus === undefined || isMediaStatus(candidate.mediaStatus))
    && isOptionalNumber(candidate.duration)
    && (candidate.metadata === undefined || isUnifiedMediaItemMetadata(candidate.metadata))
}

export function isEffectTemplateLibraryAssetMetaFileValue(
  value: unknown,
): value is EffectTemplateLibraryAssetMetaFile {
  if (!isBaseLibraryAssetMetaFile(value) || value.assetKind !== 'effect-template') {
    return false
  }

  const candidate = value as unknown as Record<string, unknown>

  return isBaseEffectTemplateSourceData(candidate.source)
    && isEffectType(candidate.effectType)
    && isMediaStatus(candidate.templateStatus)
}

export function parseLibraryAssetMetaFile(value: unknown): LibraryAssetMetaFile {
  if (isMediaLibraryAssetMetaFileValue(value)) {
    return value
  }

  if (isEffectTemplateLibraryAssetMetaFileValue(value)) {
    return value
  }

  throw new Error('Invalid library asset meta file')
}
