import { DashScopeTemporaryFileUploader } from '@/core/utils/dashscopeTemporaryFileUploader'
import { exportTimelineItem, exportMediaItem } from '@/core/utils/mediaExporter'
import { timecodeToFrames } from '@/core/utils/timeUtils'
import { fetchClient } from '@/utils/fetchClient'
import type { MediaIndexStatus, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/type'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { BunnyClip } from '@/core/mediabunny/bunny-clip'
import { calculateThumbnailSize, createCanvasWithSize, drawImageOnCanvas } from '@/core/bunnyUtils/thumbUtils'
import { ThumbnailMode } from '@/constants/ThumbnailConstants'

const RETRIEVAL_TOP_K = 30
const RERANK_TOP_K = 10
const RERANK_SCORE_THRESHOLD = 0.55
const SEARCH_TOP_K_MIN = 1
const SEARCH_TOP_K_MAX = 10
const SEARCH_VIDEO_EXPORT_MAX_SIDE = 480
const SEARCH_VIDEO_EXPORT_FPS = 6
const SEARCH_IMAGE_EXPORT_MAX_SIDE = 768

export interface RetrievalKeywordMatch {
  field: string
  value: string
  matched_terms: string[]
  score: number
}

export interface RetrievalSegmentInfo {
  segment_index: number
  start_timecode: string
  end_timecode: string
  duration_n: number
}

export interface RetrievalResultItem {
  point_id: string
  media_item_id: string
  media_name: string
  media_kind: string
  segment: RetrievalSegmentInfo | null
  title: string | null
  summary: string | null
  score: number
  rerank_score?: number
  validation_result?: ValidationResultItem
  routes: string[]
  keyword_matches: RetrievalKeywordMatch[]
}

export interface RerankCandidateInput {
  pointId: string
  mediaItemId: string
  mediaKind: string
  segment: RetrievalSegmentInfo | null
}

export interface RerankDocument {
  type: 'video' | 'image'
  video_url?: string
  image_url?: string
}

export interface PreparedRerankCandidate {
  point_id: string
  media_item_id: string
  media_kind: string
  document: RerankDocument
}

export interface RerankResultItem {
  point_id: string
  rerank_score: number
}

export interface ValidationImageDocument {
  type: 'image'
  image_url: string
}

export interface ValidationCandidateInput {
  pointId: string
  mediaItemId: string
  mediaKind: string
  segment: RetrievalSegmentInfo | null
  summary: string | null
  keywordMatches: RetrievalKeywordMatch[]
}

export interface PreparedValidationCandidate {
  point_id: string
  media_item_id: string
  media_kind: string
  summary: string | null
  keyword_matches: RetrievalKeywordMatch[]
  validation_document: ValidationImageDocument
}

export interface ValidationResultItem {
  point_id: string
  verdict: 'relevant' | 'uncertain' | 'irrelevant' | 'error'
  reason: string
  model: string
}

export type SearchMediaStage = 'indexing' | 'retrieval' | 'rerank' | 'validate'

export interface ReconcileMediaIndexingResult {
  project_id: string
  unindexed_media_ids: string[]
  deleted_orphan_media_count: number
  deleted_orphan_point_count: number
}

function buildBoundedExportSize(
  width: number | undefined,
  height: number | undefined,
  maxSide: number,
): { outputWidth?: number; outputHeight?: number } {
  if (!width || !height) {
    return {
      outputWidth: maxSide,
    }
  }

  const longestSide = Math.max(width, height)
  if (longestSide <= maxSide) {
    return {
      outputWidth: width,
      outputHeight: height,
    }
  }

  const scale = maxSide / longestSide
  return {
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  }
}

function buildSearchVideoExportOptions(
  mediaItem: UnifiedMediaItemData & { mediaType: 'video' },
): { frameRate: number; outputWidth?: number; outputHeight?: number } {
  const boundedSize = buildBoundedExportSize(
    mediaItem.runtime.bunny?.originalWidth || mediaItem.runtime.bunny?.bunnyMedia?.width,
    mediaItem.runtime.bunny?.originalHeight || mediaItem.runtime.bunny?.bunnyMedia?.height,
    SEARCH_VIDEO_EXPORT_MAX_SIDE,
  )

  return {
    frameRate: SEARCH_VIDEO_EXPORT_FPS,
    ...boundedSize,
  }
}

function buildSearchImageExportOptions(
  mediaItem: UnifiedMediaItemData & { mediaType: 'image' },
): { outputWidth?: number; outputHeight?: number } {
  return buildBoundedExportSize(
    mediaItem.runtime.bunny?.originalWidth,
    mediaItem.runtime.bunny?.originalHeight,
    SEARCH_IMAGE_EXPORT_MAX_SIDE,
  )
}

function createVideoSegmentTimelineItem(
  mediaItem: UnifiedMediaItemData & { mediaType: 'video' },
  startFrame: number,
  endFrame: number,
): UnifiedTimelineItemData<'video'> {
  const width = mediaItem.runtime.bunny?.originalWidth || 1920
  const height = mediaItem.runtime.bunny?.originalHeight || 1080
  const baseRenderConfig = {
    visual: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      blendMode: DEFAULT_BLEND_MODE,
      proportionalScale: true,
    },
    audio: {
      volume: 1,
      isMuted: false,
    },
  }

  return {
    id: `rerank-${mediaItem.id}-${startFrame}`,
    mediaType: 'video',
    mediaItemId: mediaItem.id,
    trackId: '__rerank__',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: endFrame - startFrame,
      clipStartTime: startFrame,
      clipEndTime: endFrame,
    },
    baseRenderConfig,
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    runtime: {
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: true,
    },
  }
}

async function prepareVideoCandidate(
  mediaItem: UnifiedMediaItemData,
  segment: RerankCandidateInput['segment'],
): Promise<RerankDocument | null> {
  if (!segment || mediaItem.mediaType !== 'video') return null

  const startFrame = timecodeToFrames(segment.start_timecode)
  const endFrame = timecodeToFrames(segment.end_timecode)

  const timelineItem = createVideoSegmentTimelineItem(
    mediaItem as UnifiedMediaItemData & { mediaType: 'video' },
    startFrame,
    endFrame,
  )

  const videoBlob = await exportTimelineItem({
    timelineItem,
    getMediaItem: (id: string | null) =>
      id === mediaItem.id ? mediaItem : undefined,
    ...buildSearchVideoExportOptions(mediaItem as UnifiedMediaItemData & { mediaType: 'video' }),
  })

  const fileName = `rerank-${mediaItem.id}-seg-${segment.segment_index}-${Date.now()}.mp4`
  const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
    videoBlob,
    fileName,
    'embedding',
  )

  if (!uploadResult.success || !uploadResult.url) {
    console.warn(`视频候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return { type: 'video', video_url: uploadResult.url }
}

async function prepareImageCandidate(
  mediaItem: UnifiedMediaItemData,
): Promise<RerankDocument | null> {
  if (mediaItem.mediaType !== 'image') return null

  const imageBlob = await exportMediaItem({
    mediaItem,
    ...buildSearchImageExportOptions(mediaItem as UnifiedMediaItemData & { mediaType: 'image' }),
  })

  const fileName = `rerank-${mediaItem.id}-${Date.now()}.png`
  const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
    imageBlob,
    fileName,
    'tagging',
  )

  if (!uploadResult.success || !uploadResult.url) {
    console.warn(`图片候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return { type: 'image', image_url: uploadResult.url }
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('代表帧转换失败'))
      }
    }, 'image/png')
  })
}

async function prepareVideoValidationImage(
  mediaItem: UnifiedMediaItemData,
  segment: RetrievalSegmentInfo | null,
): Promise<ValidationImageDocument | null> {
  if (!segment || mediaItem.mediaType !== 'video') return null

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    console.warn(`视频素材缺少 bunnyMedia: ${mediaItem.id}`)
    return null
  }
  await bunnyMedia.ready

  const startFrame = timecodeToFrames(segment.start_timecode)
  const endFrame = timecodeToFrames(segment.end_timecode)
  const targetFrame = BigInt(Math.max(startFrame, Math.floor((startFrame + endFrame) / 2)))
  const clip = new BunnyClip(bunnyMedia)

  try {
    const sampleResult = await clip.getSampleN(targetFrame)
    const sample = sampleResult.video
    if (!sample) {
      console.warn(`无法获取视频代表帧: ${mediaItem.id}#${segment.segment_index}`)
      return null
    }

    const frame = sample.toVideoFrame()
    sample.close()

    try {
      const sourceWidth = bunnyMedia.width || frame.displayWidth || 1920
      const sourceHeight = bunnyMedia.height || frame.displayHeight || 1080
      const boundedSize = buildBoundedExportSize(
        sourceWidth,
        sourceHeight,
        SEARCH_VIDEO_EXPORT_MAX_SIDE,
      )
      const sizeInfo = calculateThumbnailSize(
        sourceWidth,
        sourceHeight,
        boundedSize.outputWidth || SEARCH_VIDEO_EXPORT_MAX_SIDE,
        boundedSize.outputHeight || SEARCH_VIDEO_EXPORT_MAX_SIDE,
        ThumbnailMode.FIT,
      )
      const { canvas, ctx } = createCanvasWithSize(sizeInfo.containerWidth, sizeInfo.containerHeight)
      drawImageOnCanvas(ctx, frame, sizeInfo, '#000000', clip.clockwiseRotation)
      const blob = await canvasToPngBlob(canvas)

      const fileName = `validate-${mediaItem.id}-seg-${segment.segment_index}-${Date.now()}.png`
      const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
        blob,
        fileName,
        'tagging',
      )

      if (!uploadResult.success || !uploadResult.url) {
        console.warn(`视频校验图上传失败: ${fileName}`, uploadResult.error)
        return null
      }

      return { type: 'image', image_url: uploadResult.url }
    } finally {
      frame.close()
    }
  } finally {
    await clip.dispose()
  }
}

async function prepareImageValidationImage(
  mediaItem: UnifiedMediaItemData,
): Promise<ValidationImageDocument | null> {
  if (mediaItem.mediaType !== 'image') return null
  const imageBlob = await exportMediaItem({
    mediaItem,
    ...buildSearchImageExportOptions(mediaItem as UnifiedMediaItemData & { mediaType: 'image' }),
  })
  const fileName = `validate-${mediaItem.id}-${Date.now()}.png`
  const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
    imageBlob,
    fileName,
    'tagging',
  )

  if (!uploadResult.success || !uploadResult.url) {
    console.warn(`图片校验图上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return { type: 'image', image_url: uploadResult.url }
}

export async function prepareRerankCandidates(
  candidates: RerankCandidateInput[],
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  onProgress?: (current: number, total: number) => void,
): Promise<PreparedRerankCandidate[]> {
  const prepared: PreparedRerankCandidate[] = []
  const total = candidates.length

  for (let i = 0; i < candidates.length; i++) {
    onProgress?.(i, total)
    const candidate = candidates[i]

    try {
      const mediaItem = getMediaItem(candidate.mediaItemId)
      if (!mediaItem) {
        console.warn(`找不到素材: ${candidate.mediaItemId}`)
        continue
      }

      if (mediaItem.mediaStatus !== 'ready') {
        console.warn(`素材未就绪: ${candidate.mediaItemId}`)
        continue
      }

      let document: RerankDocument | null = null

      if (candidate.mediaKind === 'video') {
        document = await prepareVideoCandidate(mediaItem, candidate.segment)
      } else if (candidate.mediaKind === 'image') {
        document = await prepareImageCandidate(mediaItem)
      }

      if (!document) continue

      prepared.push({
        point_id: candidate.pointId,
        media_item_id: candidate.mediaItemId,
        media_kind: candidate.mediaKind,
        document,
      })
    } catch (error) {
      console.warn(`准备 rerank 候选失败: ${candidate.pointId}`, error)
    }
  }

  onProgress?.(total, total)
  return prepared
}

export async function callRerankApi(
  query: string,
  projectId: string,
  candidates: PreparedRerankCandidate[],
  topK: number = 10,
): Promise<RerankResultItem[]> {
  const response = await fetchClient.post<{
    query: string
    total: number
    results: RerankResultItem[]
  }>('/api/media/rerank', {
    query,
    project_id: projectId,
    top_k: topK,
    candidates,
  })

  return response.data?.results || []
}

export async function prepareValidateCandidates(
  candidates: ValidationCandidateInput[],
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  onProgress?: (current: number, total: number) => void,
): Promise<PreparedValidationCandidate[]> {
  const prepared: PreparedValidationCandidate[] = []
  const total = candidates.length

  for (let i = 0; i < candidates.length; i++) {
    onProgress?.(i, total)
    const candidate = candidates[i]

    try {
      const mediaItem = getMediaItem(candidate.mediaItemId)
      if (!mediaItem || mediaItem.mediaStatus !== 'ready') {
        continue
      }

      let validationDocument: ValidationImageDocument | null = null
      if (candidate.mediaKind === 'video') {
        validationDocument = await prepareVideoValidationImage(mediaItem, candidate.segment)
      } else if (candidate.mediaKind === 'image') {
        validationDocument = await prepareImageValidationImage(mediaItem)
      }

      if (!validationDocument) continue

      prepared.push({
        point_id: candidate.pointId,
        media_item_id: candidate.mediaItemId,
        media_kind: candidate.mediaKind,
        summary: candidate.summary,
        keyword_matches: candidate.keywordMatches,
        validation_document: validationDocument,
      })
    } catch (error) {
      console.warn(`准备 validate 候选失败: ${candidate.pointId}`, error)
    }
  }

  onProgress?.(total, total)
  return prepared
}

export async function callValidateApi(
  query: string,
  projectId: string,
  candidates: PreparedValidationCandidate[],
  topK: number = 10,
): Promise<ValidationResultItem[]> {
  const response = await fetchClient.post<{
    query: string
    total: number
    results: ValidationResultItem[]
  }>('/api/media/validate', {
    query,
    project_id: projectId,
    top_k: topK,
    candidates,
  })

  return response.data?.results || []
}

interface IndexAllMediaParams {
  mediaItems: UnifiedMediaItemData[]
  ensureMediaIndexing: (id: string) => Promise<unknown>
  t: (key: string, params?: Record<string, unknown>) => string
}

export async function indexAllMedia({
  mediaItems,
  ensureMediaIndexing,
  t,
}: IndexAllMediaParams): Promise<string> {
  const items = mediaItems.filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  )

  if (items.length === 0) {
    return t('aiPanel.indexAllMediaNoItems')
  }

  await Promise.all(items.map((item) => ensureMediaIndexing(item.id)))
  return t('aiPanel.indexAllMediaSuccess', { count: items.length })
}

export async function reconcileMediaIndexing(
  projectId: string,
  mediaIds: string[],
): Promise<ReconcileMediaIndexingResult> {
  const normalizedMediaIds = Array.from(
    new Set(
      mediaIds
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  )

  const response = await fetchClient.post<ReconcileMediaIndexingResult>(
    '/api/media/indexing/reconcile',
    {
      project_id: projectId,
      media_ids: normalizedMediaIds,
    },
  )

  if (!response.data) {
    throw new Error('索引对账返回数据为空')
  }

  return response.data
}

interface SearchMediaParams {
  query: string
  projectId?: string | null
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined
  mediaItems: UnifiedMediaItemData[]
  ensureMediaIndexing: (id: string) => Promise<unknown>
  t: (key: string, params?: Record<string, unknown>) => string
  topK?: number
  onProgress?: (stage: SearchMediaStage, completedSteps: number, totalSteps: number) => void
  onIndexingProgress?: (resolvedCount: number, totalCount: number, failedCount: number) => void
}

interface SearchMediaResult {
  results: RetrievalResultItem[]
  error: string
}

function normalizeSearchTopK(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return RERANK_TOP_K
  }

  const normalized = Math.trunc(value)
  if (normalized < SEARCH_TOP_K_MIN) return SEARCH_TOP_K_MIN
  if (normalized > SEARCH_TOP_K_MAX) return SEARCH_TOP_K_MAX
  return normalized
}

function isSearchIndexReady(status: MediaIndexStatus | undefined): boolean {
  return status === 'completed' || status === 'partial_failed'
}

async function ensureSearchMediaIndexed(params: {
  projectId: string
  mediaItems: UnifiedMediaItemData[]
  ensureMediaIndexing: (id: string) => Promise<unknown>
  onIndexingProgress?: (resolvedCount: number, totalCount: number, failedCount: number) => void
}): Promise<void> {
  const { projectId, mediaItems, ensureMediaIndexing, onIndexingProgress } = params
  const indexableItems = mediaItems.filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  )

  if (indexableItems.length === 0) {
    return
  }

  const reconcileResult = await reconcileMediaIndexing(
    projectId,
    indexableItems.map((item) => item.id),
  )
  const remoteMissingIds = new Set(reconcileResult.unindexed_media_ids)
  const localIncompleteIds = indexableItems
    .filter((item) => !isSearchIndexReady(item.metadata?.indexing?.indexStatus))
    .map((item) => item.id)

  const targetIds = Array.from(new Set([...remoteMissingIds, ...localIncompleteIds]))
  if (targetIds.length === 0) {
    onIndexingProgress?.(0, 0, 0)
    return
  }

  let resolvedCount = 0
  let failedCount = 0
  onIndexingProgress?.(0, targetIds.length, 0)

  const results = await Promise.allSettled(targetIds.map(async (mediaId) => {
    try {
      return await ensureMediaIndexing(mediaId)
    } catch (error) {
      failedCount += 1
      throw error
    } finally {
      resolvedCount += 1
      onIndexingProgress?.(resolvedCount, targetIds.length, failedCount)
    }
  }))
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) {
    const firstFailure = failures[0]
    const reason = firstFailure.status === 'rejected' ? firstFailure.reason : '未知错误'
    throw new Error(`搜索前补齐素材索引失败: ${String(reason)}`)
  }
}

export async function searchMedia({
  query,
  projectId,
  getMediaItem,
  mediaItems,
  ensureMediaIndexing,
  t,
  topK = RERANK_TOP_K,
  onProgress,
  onIndexingProgress,
}: SearchMediaParams): Promise<SearchMediaResult> {
  const normalizedTopK = normalizeSearchTopK(topK)
  const totalSteps = 4
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return { results: [], error: '' }
  }

  if (!projectId) {
    return { results: [], error: '当前项目未初始化' }
  }

  try {
    onProgress?.('indexing', 0, totalSteps)
    await ensureSearchMediaIndexed({
      projectId,
      mediaItems,
      ensureMediaIndexing,
      onIndexingProgress,
    })
    onProgress?.('indexing', 1, totalSteps)

    onProgress?.('retrieval', 1, totalSteps)
    const response = await fetchClient.post<{
      results: RetrievalResultItem[]
      total: number
      query: string
    }>('/api/media/retrieval', {
      query: normalizedQuery,
      project_id: projectId,
      top_k: RETRIEVAL_TOP_K,
    })

    const retrievalResults = response.data?.results || []
    if (retrievalResults.length === 0) {
      return { results: [], error: '' }
    }
    onProgress?.('retrieval', 2, totalSteps)

    const candidates: RerankCandidateInput[] = retrievalResults.map((result) => ({
      pointId: result.point_id,
      mediaItemId: result.media_item_id,
      mediaKind: result.media_kind,
      segment: result.segment,
    }))

    const prepared = await prepareRerankCandidates(candidates, getMediaItem)
    if (prepared.length === 0) {
      return { results: [], error: t('aiPanel.search.rerankFailed') }
    }

    onProgress?.('rerank', 2, totalSteps)
    const rerankResults = await callRerankApi(
      normalizedQuery,
      projectId,
      prepared,
      normalizedTopK,
    )

    if (rerankResults.length === 0) {
      return { results: [], error: t('aiPanel.search.rerankFailed') }
    }

    const scoreMap = new Map(rerankResults.map((result) => [result.point_id, result.rerank_score]))
    const reranked = retrievalResults
      .filter((result) => scoreMap.has(result.point_id))
      .map((result) => ({
        ...result,
        rerank_score: scoreMap.get(result.point_id)!,
        score: scoreMap.get(result.point_id)!,
      }))
      .filter((result) => result.score >= RERANK_SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)

    if (reranked.length === 0) {
      return { results: [], error: '' }
    }
    onProgress?.('rerank', 3, totalSteps)

    const validateCandidates: ValidationCandidateInput[] = reranked.map((result) => ({
      pointId: result.point_id,
      mediaItemId: result.media_item_id,
      mediaKind: result.media_kind,
      segment: result.segment,
      summary: result.summary,
      keywordMatches: result.keyword_matches,
    }))
    const preparedValidationCandidates = await prepareValidateCandidates(validateCandidates, getMediaItem)
    if (preparedValidationCandidates.length === 0) {
      return { results: [], error: t('aiPanel.search.validationPrepareFailed') }
    }

    onProgress?.('validate', 3, totalSteps)
    const validationResults = await callValidateApi(
      normalizedQuery,
      projectId,
      preparedValidationCandidates,
      normalizedTopK,
    )
    const validationMap = new Map(validationResults.map((result) => [result.point_id, result]))
    if (
      validationResults.length !== reranked.length
      || reranked.some((result) => !validationMap.has(result.point_id))
    ) {
      return { results: [], error: t('aiPanel.search.validationFailed') }
    }
    onProgress?.('validate', 4, totalSteps)

    return {
      results: reranked.map((result) => ({
        ...result,
        validation_result: validationMap.get(result.point_id)!,
      })),
      error: '',
    }
  } catch (error) {
    console.warn('素材检索失败:', error)
    return {
      results: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
