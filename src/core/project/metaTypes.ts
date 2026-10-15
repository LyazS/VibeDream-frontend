import type { BaseDataSourcePersistedData } from '@/core/datasource/core/DataSourceTypes'
import { isMediaExtension } from '@/core/utils/mediaPathUtils'
import type {
  BaseEffectTemplateSourceData,
  EffectTemplateStatus,
  EffectType,
} from '@/core/asset/types'
import type {
  MediaStatus,
  MediaTypeOrUnknown,
  MusicAnalysisMetadata,
  MusicAnalysisSegment,
  UnifiedImageMediaIndexMetadata,
  UnifiedVideoIndexSegmentSummary,
  UnifiedMediaItemMetadata,
} from '@/core/mediaitem/types'

export interface BaseLibraryAssetMetaFile {
  version: string
  id: string
  name: string
  createdAt: string
  assetKind: 'media' | 'effect-template'
}

export const MEDIA_META_VERSION = '2.0.0'

export interface MediaLibraryAssetMetaFile extends BaseLibraryAssetMetaFile {
  version: typeof MEDIA_META_VERSION
  assetKind: 'media'
  ext: string
  parentDirectoryId: string
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

function isOptionalInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value))
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isUnifiedMediaIndexSegmentSummary(
  value: unknown,
): value is UnifiedVideoIndexSegmentSummary {
  if (!isRecord(value)) {
    return false
  }

  return (
    isInteger(value.segmentIndex) &&
    typeof value.startTimecode === 'string' &&
    typeof value.endTimecode === 'string' &&
    isOptionalString(value.title) &&
    isOptionalString(value.summary)
  )
}

function isOptionalUnifiedMediaIndexSegmentSummaryArray(
  value: unknown,
): value is UnifiedVideoIndexSegmentSummary[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isUnifiedMediaIndexSegmentSummary(item)))
  )
}

function isUnifiedMediaIndexMetadata(
  value: unknown,
): value is NonNullable<UnifiedMediaItemMetadata['indexing']> {
  if (!isRecord(value)) {
    return false
  }

  const status = value.indexStatus
  const validStatus =
    status === 'idle' ||
    status === 'pending' ||
    status === 'processing' ||
    status === 'completed' ||
    status === 'partial_failed' ||
    status === 'failed'

  if (
    !validStatus ||
    !isOptionalString(value.indexedAt) ||
    !isOptionalString(value.lastIndexTaskId)
  ) {
    return false
  }

  if (value.mediaKind === 'video') {
    if (value.summary !== undefined && !isRecord(value.summary)) {
      return false
    }
    const summary = value.summary as UnifiedImageMediaIndexMetadata['summary'] | undefined
    return (
      isOptionalInteger(value.segmentCount) &&
      isOptionalInteger(value.failedSegmentCount) &&
      (summary === undefined ||
        (isOptionalString(summary.title) && isOptionalString(summary.summary))) &&
      isOptionalUnifiedMediaIndexSegmentSummaryArray(value.segmentSummaries)
    )
  }

  if (value.mediaKind === 'image') {
    if (value.summary !== undefined && !isRecord(value.summary)) {
      return false
    }
    const summary = value.summary as UnifiedImageMediaIndexMetadata['summary'] | undefined
    return (
      summary === undefined ||
      (isOptionalString(summary.title) && isOptionalString(summary.summary))
    )
  }

  return false
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isFiniteNumber(item))
}

function isMusicAnalysisSegment(value: unknown): value is MusicAnalysisSegment {
  if (!isRecord(value)) {
    return false
  }

  return (
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end) &&
    value.start >= 0 &&
    value.end >= value.start &&
    typeof value.label === 'string'
  )
}

function isMusicAnalysisAnchor(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    isFiniteNumber(value.time) &&
    value.time >= 0 &&
    typeof value.eventLabel === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string') &&
    isFiniteNumber(value.strength)
  )
}

function isMusicAnalysisMetadata(value: unknown): value is MusicAnalysisMetadata {
  if (!isRecord(value) || !isRecord(value.input)) {
    return false
  }

  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    typeof value.pipelineVersion === 'string' &&
    typeof value.analyzedAt === 'string' &&
    isFiniteNumber(value.input.durationSeconds) &&
    value.input.durationSeconds > 0 &&
    value.input.sampleRate === 44_100 &&
    (value.bpm === null || isFiniteNumber(value.bpm)) &&
    isInteger(value.meter) &&
    value.meter > 0 &&
    isNumberArray(value.beats) &&
    isNumberArray(value.downbeats) &&
    isNumberArray(value.beatPositions) &&
    Array.isArray(value.segments) &&
    value.segments.every((item) => isMusicAnalysisSegment(item)) &&
    (value.editingAnchors === undefined ||
      (Array.isArray(value.editingAnchors) && value.editingAnchors.every(isMusicAnalysisAnchor)))
  )
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number'
}

function isMediaTypeOrUnknown(value: unknown): value is MediaTypeOrUnknown {
  return ['video', 'image', 'audio', 'text', 'unknown'].includes(String(value))
}

function isMediaStatus(value: unknown): value is MediaStatus {
  return [
    'pending',
    'asyncprocessing',
    'decoding',
    'ready',
    'error',
    'cancelled',
    'missing',
  ].includes(String(value))
}

function isEffectType(value: unknown): value is EffectType {
  return ['transition', 'filter', 'animation'].includes(String(value))
}

function isUnifiedMediaItemMetadata(value: unknown): value is UnifiedMediaItemMetadata {
  if (!isRecord(value)) {
    return false
  }

  return (
    (value.indexing === undefined || isUnifiedMediaIndexMetadata(value.indexing)) &&
    (value.musicAnalysis === undefined || isMusicAnalysisMetadata(value.musicAnalysis))
  )
}

function isBaseEffectTemplateSourceData(value: unknown): value is BaseEffectTemplateSourceData {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.type === 'effect-template' &&
    typeof value.templateId === 'string' &&
    isOptionalString(value.packageVersion) &&
    isOptionalString(value.catalogVersion)
  )
}

function isMediaPersistedSourceData(value: unknown): value is BaseDataSourcePersistedData {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  switch (value.type) {
    case 'user-selected':
      return true
    default:
      return false
  }
}

function isBaseLibraryAssetMetaFile(value: unknown): value is BaseLibraryAssetMetaFile {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.version === 'string' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.assetKind === 'media' || value.assetKind === 'effect-template')
  )
}

export function isMediaLibraryAssetMetaFileValue(
  value: unknown,
): value is MediaLibraryAssetMetaFile {
  if (!isBaseLibraryAssetMetaFile(value) || value.assetKind !== 'media') {
    return false
  }

  const candidate = value as unknown as Record<string, unknown>

  return (
    candidate.version === MEDIA_META_VERSION &&
    isMediaExtension(candidate.ext) &&
    isMediaPersistedSourceData(candidate.source) &&
    typeof candidate.parentDirectoryId === 'string' &&
    isMediaTypeOrUnknown(candidate.mediaType) &&
    (candidate.mediaStatus === undefined || isMediaStatus(candidate.mediaStatus)) &&
    isOptionalNumber(candidate.duration) &&
    (candidate.metadata === undefined || isUnifiedMediaItemMetadata(candidate.metadata))
  )
}

export function isEffectTemplateLibraryAssetMetaFileValue(
  value: unknown,
): value is EffectTemplateLibraryAssetMetaFile {
  if (!isBaseLibraryAssetMetaFile(value) || value.assetKind !== 'effect-template') {
    return false
  }

  const candidate = value as unknown as Record<string, unknown>

  return (
    isBaseEffectTemplateSourceData(candidate.source) &&
    isEffectType(candidate.effectType) &&
    isMediaStatus(candidate.templateStatus)
  )
}

export function parseLibraryAssetMetaFile(value: unknown): LibraryAssetMetaFile {
  if (isMediaLibraryAssetMetaFileValue(value)) {
    return value
  }

  if (isEffectTemplateLibraryAssetMetaFileValue(value)) {
    return value
  }

  console.error('[MediaIdentity] meta:invalid', {
    version: isRecord(value) ? value.version : undefined,
    id: isRecord(value) ? value.id : undefined,
    ext: isRecord(value) ? value.ext : undefined,
    assetKind: isRecord(value) ? value.assetKind : undefined,
    expectedMediaVersion: MEDIA_META_VERSION,
  })
  throw new Error('Invalid library asset meta file')
}
