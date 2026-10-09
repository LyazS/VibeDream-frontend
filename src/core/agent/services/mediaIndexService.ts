import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'
import {
  cancelMediaTask,
  createMediaTaskIdempotencyKey,
  getMediaTaskResult,
  getTaskProgressOriginTabId,
  submitMediaTask,
  subscribeToMediaTask,
} from '@/core/jobs/resolvers/mediaTaskApi'
import type { TaskProgressUpdate } from '@/core/utils/cloudflareTaskProgressClient'
import { exportTimelineItem, exportMediaItem } from '@/core/utils/mediaExporter'
import { timecodeToFrames } from '@/core/utils/timeUtils'
import { fetchClient } from '@/utils/fetchClient'
import type { MediaIndexStatus, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/model/timelineItem'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
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

export interface PreparedRerankCandidate {
  point_id: string
  upload_ref: string
}

export interface RerankResultItem {
  point_id: string
  rerank_score: number
}

export interface ValidationCandidateInput {
  pointId: string
  mediaItemId: string
  mediaKind: string
  segment: RetrievalSegmentInfo | null
}

export interface PreparedValidationCandidate {
  point_id: string
  upload_ref: string
}

export interface ValidationResultItem {
  point_id: string
  verdict: 'relevant' | 'uncertain' | 'irrelevant' | 'error'
  reason: string
  model: string
}

type MediaSearchTaskCapability = 'retrieval' | 'rerank' | 'validate'
type MediaSearchTaskStatus =
  | 'pending'
  | 'processing'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'input_expired'

interface MediaSearchTask extends TaskProgressUpdate {
  capability: MediaSearchTaskCapability
  status: MediaSearchTaskStatus
  error?: string
  message?: string
}

interface RetrievalTaskResult {
  query: string
  total: number
  results: RetrievalResultItem[]
}

interface RerankTaskResult {
  query: string
  total: number
  retrieval_task_id: string
  results: RerankResultItem[]
}

interface ValidateTaskResult {
  query: string
  total: number
  rerank_task_id: string
  results: ValidationResultItem[]
}

type SearchCandidateUpload = { point_id: string; upload_ref: string }

type SearchTaskInput =
  | { query: string; top_k: number }
  | { query: string; top_k: number; retrieval_task_id: string; candidates: SearchCandidateUpload[] }
  | { query: string; top_k: number; rerank_task_id: string; candidates: SearchCandidateUpload[] }

function isMediaSearchTask(
  capability: MediaSearchTaskCapability,
  task: TaskProgressUpdate,
): task is MediaSearchTask {
  return task.capability === capability && [
    'pending',
    'processing',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
    'input_expired',
  ].includes(task.status)
}

async function submitSearchTask<TResult>(
  capability: MediaSearchTaskCapability,
  projectId: string,
  input: SearchTaskInput,
  signal?: AbortSignal,
): Promise<{ taskId: string; result: TResult }> {
  const task = await submitMediaTask<MediaSearchTask, {
    project_id: string
    origin_tab_id: string
    input: SearchTaskInput
  }>(
    capability,
    {
      project_id: projectId,
      origin_tab_id: getTaskProgressOriginTabId(),
      input,
    },
    createMediaTaskIdempotencyKey(capability),
    signal,
  )
  const subscription = subscribeToMediaTask(
    task.task_id,
    getTaskProgressOriginTabId(),
    (update): update is MediaSearchTask => isMediaSearchTask(capability, update),
  )
  const waitSignal = signal || new AbortController().signal
  const cancel = () => {
    // Abort 只会中止本地等待；显式取消远端任务，以便 Workflow 停止并退款。
    void cancelMediaTask(task.task_id, capability).catch((error) => {
      console.warn(`取消 ${capability} 任务失败: ${task.task_id}`, error)
    })
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()

  try {
    while (true) {
      const update = await subscription.next(waitSignal)
      if (update.status === 'completed') {
        return { taskId: task.task_id, result: await getMediaTaskResult<TResult>(task.task_id, waitSignal) }
      }
      if (update.status === 'failed' || update.status === 'cancelled' || update.status === 'input_expired') {
        throw new Error(update.message || update.error || `${capability} 任务失败`)
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    subscription.close()
  }
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
      blendIntensity: 1,
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
  projectId: string,
  pointId: string,
): Promise<string | null> {
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
  const uploadResult = await CloudflareTemporaryFileUploader.uploadBlob(
    videoBlob,
    {
      capability: 'rerank',
      purpose: 'rerank',
      fileName,
      projectId,
      pointId,
    },
  )

  if (!uploadResult.success || !uploadResult.uploadRef) {
    console.warn(`视频候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return uploadResult.uploadRef
}

async function prepareImageCandidate(
  mediaItem: UnifiedMediaItemData,
  projectId: string,
  pointId: string,
): Promise<string | null> {
  if (mediaItem.mediaType !== 'image') return null

  const imageBlob = await exportMediaItem({
    mediaItem,
    ...buildSearchImageExportOptions(mediaItem as UnifiedMediaItemData & { mediaType: 'image' }),
  })

  const fileName = `rerank-${mediaItem.id}-${Date.now()}.png`
  const uploadResult = await CloudflareTemporaryFileUploader.uploadBlob(
    imageBlob,
    {
      capability: 'rerank',
      purpose: 'rerank',
      fileName,
      projectId,
      pointId,
    },
  )

  if (!uploadResult.success || !uploadResult.uploadRef) {
    console.warn(`图片候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return uploadResult.uploadRef
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
  projectId: string,
  pointId: string,
): Promise<string | null> {
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
      const uploadResult = await CloudflareTemporaryFileUploader.uploadBlob(
        blob,
        {
          capability: 'validate',
          purpose: 'validate',
          fileName,
          projectId,
          pointId,
        },
      )

      if (!uploadResult.success || !uploadResult.uploadRef) {
        console.warn(`视频校验图上传失败: ${fileName}`, uploadResult.error)
        return null
      }

      return uploadResult.uploadRef
    } finally {
      frame.close()
    }
  } finally {
    await clip.dispose()
  }
}

async function prepareImageValidationImage(
  mediaItem: UnifiedMediaItemData,
  projectId: string,
  pointId: string,
): Promise<string | null> {
  if (mediaItem.mediaType !== 'image') return null
  const imageBlob = await exportMediaItem({
    mediaItem,
    ...buildSearchImageExportOptions(mediaItem as UnifiedMediaItemData & { mediaType: 'image' }),
  })
  const fileName = `validate-${mediaItem.id}-${Date.now()}.png`
  const uploadResult = await CloudflareTemporaryFileUploader.uploadBlob(
    imageBlob,
    {
      capability: 'validate',
      purpose: 'validate',
      fileName,
      projectId,
      pointId,
    },
  )

  if (!uploadResult.success || !uploadResult.uploadRef) {
    console.warn(`图片校验图上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return uploadResult.uploadRef
}

export async function prepareRerankCandidates(
  candidates: RerankCandidateInput[],
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  projectId: string,
  onProgress?: (current: number, total: number) => void,
  checkCancelled?: () => void,
): Promise<PreparedRerankCandidate[]> {
  const prepared: PreparedRerankCandidate[] = []
  const total = candidates.length

  for (let i = 0; i < candidates.length; i++) {
    checkCancelled?.()
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

      let uploadRef: string | null = null

      if (candidate.mediaKind === 'video') {
        uploadRef = await prepareVideoCandidate(mediaItem, candidate.segment, projectId, candidate.pointId)
      } else if (candidate.mediaKind === 'image') {
        uploadRef = await prepareImageCandidate(mediaItem, projectId, candidate.pointId)
      }

      if (!uploadRef) continue

      prepared.push({
        point_id: candidate.pointId,
        upload_ref: uploadRef,
      })
    } catch (error) {
      console.warn(`准备 rerank 候选失败: ${candidate.pointId}`, error)
    }
  }

  onProgress?.(total, total)
  return prepared
}

async function callRetrievalApi(
  query: string,
  projectId: string,
  topK: number,
  signal?: AbortSignal,
): Promise<{ taskId: string; result: RetrievalTaskResult }> {
  return submitSearchTask<RetrievalTaskResult>('retrieval', projectId, {
    query,
    top_k: topK,
  }, signal)
}

export async function callRerankApi(
  query: string,
  projectId: string,
  retrievalTaskId: string,
  candidates: PreparedRerankCandidate[],
  topK: number = 10,
  signal?: AbortSignal,
): Promise<{ taskId: string; result: RerankTaskResult }> {
  return submitSearchTask<RerankTaskResult>('rerank', projectId, {
    query,
    top_k: topK,
    retrieval_task_id: retrievalTaskId,
    candidates,
  }, signal)
}

export async function prepareValidateCandidates(
  candidates: ValidationCandidateInput[],
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  projectId: string,
  onProgress?: (current: number, total: number) => void,
  checkCancelled?: () => void,
): Promise<PreparedValidationCandidate[]> {
  const prepared: PreparedValidationCandidate[] = []
  const total = candidates.length

  for (let i = 0; i < candidates.length; i++) {
    checkCancelled?.()
    onProgress?.(i, total)
    const candidate = candidates[i]

    try {
      const mediaItem = getMediaItem(candidate.mediaItemId)
      if (!mediaItem || mediaItem.mediaStatus !== 'ready') {
        continue
      }

      let uploadRef: string | null = null
      if (candidate.mediaKind === 'video') {
        uploadRef = await prepareVideoValidationImage(
          mediaItem,
          candidate.segment,
          projectId,
          candidate.pointId,
        )
      } else if (candidate.mediaKind === 'image') {
        uploadRef = await prepareImageValidationImage(mediaItem, projectId, candidate.pointId)
      }

      if (!uploadRef) continue

      prepared.push({
        point_id: candidate.pointId,
        upload_ref: uploadRef,
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
  rerankTaskId: string,
  candidates: PreparedValidationCandidate[],
  topK: number = 10,
  signal?: AbortSignal,
): Promise<{ taskId: string; result: ValidateTaskResult }> {
  return submitSearchTask<ValidateTaskResult>('validate', projectId, {
    query,
    top_k: topK,
    rerank_task_id: rerankTaskId,
    candidates,
  }, signal)
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
  signal?: AbortSignal
  checkCancelled?: () => void
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
  checkCancelled?: () => void
}): Promise<void> {
  const { projectId, mediaItems, ensureMediaIndexing, onIndexingProgress, checkCancelled } = params
  const indexableItems = mediaItems.filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  )

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
    checkCancelled?.()
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
  signal,
  checkCancelled,
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
    checkCancelled?.()
    onProgress?.('indexing', 0, totalSteps)
    await ensureSearchMediaIndexed({
      projectId,
      mediaItems,
      ensureMediaIndexing,
      onIndexingProgress,
      checkCancelled,
    })
    checkCancelled?.()
    onProgress?.('indexing', 1, totalSteps)

    onProgress?.('retrieval', 1, totalSteps)
    const retrieval = await callRetrievalApi(normalizedQuery, projectId, RETRIEVAL_TOP_K, signal)

    checkCancelled?.()
    const retrievalResults = retrieval.result.results || []
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

    const prepared = await prepareRerankCandidates(
      candidates,
      getMediaItem,
      projectId,
      undefined,
      checkCancelled,
    )
    if (prepared.length === 0) {
      return { results: [], error: t('aiPanel.search.rerankFailed') }
    }

    onProgress?.('rerank', 2, totalSteps)
    const rerank = await callRerankApi(
      normalizedQuery,
      projectId,
      retrieval.taskId,
      prepared,
      normalizedTopK,
      signal,
    )

    checkCancelled?.()
    const rerankResults = rerank.result.results || []
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
    }))
    const preparedValidationCandidates = await prepareValidateCandidates(
      validateCandidates,
      getMediaItem,
      projectId,
      undefined,
      checkCancelled,
    )
    if (preparedValidationCandidates.length === 0) {
      return { results: [], error: t('aiPanel.search.validationPrepareFailed') }
    }

    onProgress?.('validate', 3, totalSteps)
    const validation = await callValidateApi(
      normalizedQuery,
      projectId,
      rerank.taskId,
      preparedValidationCandidates,
      normalizedTopK,
      signal,
    )
    const validationResults = validation.result.results || []
    const validationMap = new Map(validationResults.map((result) => [result.point_id, result]))
    checkCancelled?.()
    if (
      validationResults.length !== reranked.length
      || reranked.some((result) => !validationMap.has(result.point_id))
    ) {
      return { results: [], error: t('aiPanel.search.validationFailed') }
    }
    onProgress?.('validate', 4, totalSteps)

    return {
      results: reranked
        .map((result) => ({
          ...result,
          validation_result: validationMap.get(result.point_id)!,
        }))
        // irrelevant 与模型解析失败不会进入编辑器；uncertain 保留给用户自行判断。
        .filter((result) => result.validation_result?.verdict !== 'irrelevant' && result.validation_result?.verdict !== 'error'),
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
