/**
 * read_media 工具实现
 * 读取素材详情，必要时等待内容分析完成，最终返回 JSON envelope。
 */

import { computed, reactive } from 'vue'
import type { ResourceEvent } from '@/core/jobs/ResourceTypes'
import { MediaItemQueries } from '@/core/mediaitem/queries'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type {
  MediaIndexStatus,
  UnifiedImageMediaIndexMetadata,
  UnifiedMediaItemData,
  UnifiedMediaIndexMetadata,
  UnifiedVideoMediaIndexMetadata,
} from '@/core/mediaitem/types'
import type { ToolDefinition, ToolExecutionContext } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  buildIndexingStatusMessage,
  createRuntimeI18nMessage,
  type IndexingRuntimeState,
} from './indexingRuntime'
import {
  registerToolCancellationHook,
  unregisterToolCancellationHook,
} from './cancellation'

const MAX_MEDIA_IDS = 10
const MAX_WAIT_MS = 30 * 60 * 1000
const DEFAULT_FIELDS: ReadMediaField[] = ['basic', 'summary']

type ReadMediaField = 'basic' | 'summary' | 'segments'
type ReadMediaItemStatus = 'success' | 'failed' | 'pending'
type ReadMediaFailureReason =
  | 'not_found'
  | 'indexing_failed'
  | 'indexing_timeout'
  | 'user_cancelled_before_completed'

interface ReadMediaToolContext {
  resolveMediaRequest: (mediaId: string) => {
    mediaItem?: UnifiedMediaItemData
    suggestedItem?: UnifiedMediaItemData
  }
  ensureMediaIndexing: (mediaId: string) => Promise<unknown>
  onJobResourceEvent: (listener: (event: ResourceEvent) => void) => () => void
}

export interface ReadMediaExecutionState extends IndexingRuntimeState {
  toolCallId: string
  mediaIds: string[]
  fields: ReadMediaField[]
  totalCount: number
  completedCount: number
  failedCount: number
  active: boolean
  canCancel: boolean
  cancelled: boolean
  message: string
}

interface ReadMediaItemController {
  requestedId: string
  itemStatus: ReadMediaItemStatus
  failureReason?: ReadMediaFailureReason
  failureMessage?: string
  suggestedId?: string
  waitStarted: boolean
  waitPromise?: Promise<void>
  waitError?: string
}

const activeExecutions = reactive<Record<string, ReadMediaExecutionState>>({})
export function useReadMediaExecutionState(toolCallId: string) {
  return computed(() => activeExecutions[toolCallId] ?? null)
}

function startExecutionState(
  toolCallId: string,
  mediaIds: string[],
  fields: ReadMediaField[],
): void {
  activeExecutions[toolCallId] = {
    toolCallId,
    mediaIds,
    fields,
    totalCount: mediaIds.length,
    completedCount: 0,
    failedCount: 0,
    indexingTotalCount: mediaIds.length,
    indexingResolvedCount: 0,
    indexingFailedCount: 0,
    active: true,
    canCancel: true,
    cancelled: false,
    message: '正在准备读取素材…',
    indexingStatus: createRuntimeI18nMessage('aiPanel.toolsState.indexingPreparing'),
  }
}

function updateExecutionState(
  toolCallId: string,
  patch: Partial<ReadMediaExecutionState>,
): void {
  const current = activeExecutions[toolCallId]
  if (!current) return
  Object.assign(current, patch)
}

function finishExecutionState(toolCallId: string): void {
  delete activeExecutions[toolCallId]
  unregisterToolCancellationHook('read_media', toolCallId)
}

function normalizeIncludeSegments(includeSegments: unknown): boolean {
  if (includeSegments === undefined || includeSegments === null) {
    return false
  }
  if (typeof includeSegments !== 'boolean') {
    throw new Error('includeSegments must be a boolean when provided')
  }
  return includeSegments
}

function buildReadFields(includeSegments: boolean): ReadMediaField[] {
  return includeSegments ? [...DEFAULT_FIELDS, 'segments'] : [...DEFAULT_FIELDS]
}

function normalizeMediaIds(mediaIds: unknown): string[] {
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    throw new Error('mediaIds must be a non-empty array')
  }
  if (mediaIds.length > MAX_MEDIA_IDS) {
    throw new Error(`Maximum ${MAX_MEDIA_IDS} media IDs per request`)
  }

  const normalized = mediaIds.map((mediaId) => (typeof mediaId === 'string' ? mediaId.trim() : ''))
  if (normalized.some((mediaId) => !mediaId)) {
    throw new Error('mediaIds must only contain non-empty strings')
  }
  return normalized
}

function getMediaItemOrSuggestion(mediaId: string, allMediaItems: UnifiedMediaItemData[]) {
  const mediaItem = allMediaItems.find((item) => item.id === mediaId)
  if (mediaItem) {
    return { mediaItem }
  }

  const suggestedItem = allMediaItems.find(
    (item) => item.id.startsWith(mediaId) || mediaId.startsWith(item.id),
  )
  return { suggestedItem }
}

function getIndexStatus(mediaItem?: UnifiedMediaItemData): MediaIndexStatus | 'not_indexed' {
  return mediaItem?.metadata?.indexing?.indexStatus ?? 'not_indexed'
}

function getIndexMetadata(mediaItem?: UnifiedMediaItemData): UnifiedMediaIndexMetadata | undefined {
  return mediaItem?.metadata?.indexing
}

function fieldNeedsIndex(field: ReadMediaField): boolean {
  return field === 'summary' || field === 'segments'
}

function fieldSupported(mediaItem: UnifiedMediaItemData, field: ReadMediaField): boolean {
  if (field === 'basic') return true
  if (field === 'summary') {
    return mediaItem.mediaType === 'video' || mediaItem.mediaType === 'image'
  }
  if (field === 'segments') {
    return mediaItem.mediaType === 'video'
  }
  return false
}

function isIndexedFieldReady(mediaItem: UnifiedMediaItemData, field: ReadMediaField): boolean {
  if (!fieldNeedsIndex(field) || !fieldSupported(mediaItem, field)) {
    return true
  }

  const indexStatus = getIndexStatus(mediaItem)
  return indexStatus === 'completed' || indexStatus === 'partial_failed'
}

function isMediaResolved(
  mediaItem: UnifiedMediaItemData,
  fields: ReadMediaField[],
): boolean {
  return fields.every((field) => isIndexedFieldReady(mediaItem, field))
}

function formatDuration(duration?: number): string | undefined {
  if (duration === undefined || duration === null) {
    return undefined
  }
  return framesToTimecode(duration)
}

function getOriginalSize(mediaItem: UnifiedMediaItemData): { width?: number; height?: number } {
  if (mediaItem.mediaType !== 'video' && mediaItem.mediaType !== 'image') {
    return {}
  }

  const size = MediaItemQueries.getOriginalSize(mediaItem)
  if (!size) {
    return {}
  }

  return {
    width: size.width,
    height: size.height,
  }
}

function getVideoMetadata(
  indexing?: UnifiedMediaIndexMetadata,
): UnifiedVideoMediaIndexMetadata | undefined {
  return indexing?.mediaKind === 'video' ? indexing : undefined
}

function getImageMetadata(
  indexing?: UnifiedMediaIndexMetadata,
): UnifiedImageMediaIndexMetadata | undefined {
  return indexing?.mediaKind === 'image' ? indexing : undefined
}

function buildBasicData(mediaItem: UnifiedMediaItemData): Record<string, any> {
  const base: Record<string, any> = {
    name: mediaItem.name,
  }

  if (mediaItem.mediaType === 'video') {
    const { width, height } = getOriginalSize(mediaItem)
    return {
      ...base,
      width,
      height,
      duration: formatDuration(mediaItem.duration),
    }
  }

  if (mediaItem.mediaType === 'image') {
    const { width, height } = getOriginalSize(mediaItem)
    return {
      ...base,
      width,
      height,
    }
  }

  if (mediaItem.mediaType === 'audio') {
    return {
      ...base,
      duration: formatDuration(mediaItem.duration),
    }
  }

  return base
}

function buildSummaryData(indexing?: UnifiedMediaIndexMetadata): Record<string, any> | null {
  const summary = indexing?.summary
  if (!summary?.title && !summary?.summary) {
    return null
  }

  return {
    title: summary?.title || undefined,
    summary: summary?.summary || undefined,
  }
}

function buildSegmentsData(indexing?: UnifiedVideoMediaIndexMetadata): Array<Record<string, any>> | null {
  const segments = indexing?.segmentSummaries || []
  if (segments.length === 0) {
    return null
  }

  return segments.map((segment) => ({
    index: segment.segmentIndex,
    clipStart: segment.startTimecode,
    clipEnd: segment.endTimecode,
    title: segment.title || undefined,
    summary: segment.summary || undefined,
  }))
}

function buildMediaData(
  controller: ReadMediaItemController,
  fields: ReadMediaField[],
  context: ReadMediaToolContext,
): Record<string, any> {
  const { mediaItem, suggestedItem } = context.resolveMediaRequest(controller.requestedId)
  if (!mediaItem) {
    const message = controller.failureMessage
      || (controller.suggestedId || suggestedItem?.id
        ? `未找到素材，建议使用完整 ID ${controller.suggestedId || suggestedItem?.id}`
        : '未找到素材')

    return {
      mediaId: controller.requestedId,
      status: 'not_found',
      error: message,
    }
  }

  const indexing = getIndexMetadata(mediaItem)
  const mediaData: Record<string, any> = {
    mediaId: mediaItem.id,
    status: controller.itemStatus === 'failed' || controller.itemStatus === 'pending' ? 'failed' : 'found',
    mediaType: mediaItem.mediaType,
  }

  if (fields.includes('basic')) {
    mediaData.basic = buildBasicData(mediaItem)
  }

  if (fields.includes('summary') && fieldSupported(mediaItem, 'summary')) {
    const summaryData = buildSummaryData(
      getVideoMetadata(indexing) || getImageMetadata(indexing),
    )
    if (summaryData) {
      mediaData.summary = summaryData.summary
    }
  }

  if (fields.includes('segments') && fieldSupported(mediaItem, 'segments')) {
    const segmentsData = buildSegmentsData(getVideoMetadata(indexing))
    if (segmentsData) {
      mediaData.segments = segmentsData
    }
  }

  if (fields.includes('segments')) {
    const videoIndexing = getVideoMetadata(indexing)
    if (mediaItem.mediaType === 'video' && videoIndexing?.indexStatus === 'partial_failed') {
      const failedCount = videoIndexing.failedSegmentCount
      mediaData.warning = failedCount && failedCount > 0
        ? `有 ${failedCount} 个分镜分析失败，已返回可用分镜`
        : '部分分镜分析失败，已返回可用分镜'
    }
  }

  if (controller.itemStatus === 'failed') {
    mediaData.error = controller.failureMessage || '读取素材失败'
  }

  return mediaData
}

function buildResultData(
  controllers: ReadMediaItemController[],
  fields: ReadMediaField[],
  context: ReadMediaToolContext,
): Record<string, any> {
  const mediaItems = controllers.map((controller) => buildMediaData(controller, fields, context))
  return {
    mediaItems,
  }
}

function markFailures(
  controllers: ReadMediaItemController[],
  reason: ReadMediaFailureReason,
  message: string,
): void {
  for (const controller of controllers) {
    if (controller.itemStatus === 'success' || controller.itemStatus === 'failed') {
      continue
    }
    controller.itemStatus = 'failed'
    controller.failureReason = reason
    controller.failureMessage = message
  }
}

function updateExecutionProgress(
  toolCallId: string | undefined,
  controllers: ReadMediaItemController[],
): void {
  if (!toolCallId) return

  const completedCount = controllers.filter((item) => item.itemStatus === 'success').length
  const failedCount = controllers.filter((item) => item.itemStatus === 'failed').length
  const resolvedCount = completedCount + failedCount
  const pendingCount = controllers.length - resolvedCount

  let message = `已完成 ${completedCount}/${controllers.length} 个素材读取`
  if (pendingCount > 0) {
    message = `正在分析并读取素材（${completedCount} 成功 / ${failedCount} 失败 / ${pendingCount} 进行中）`
  }

  const indexingStatus = buildIndexingStatusMessage({
    resolvedCount,
    totalCount: controllers.length,
    failedCount,
    idleKey: 'aiPanel.toolsState.indexingIdle',
    progressKey: 'aiPanel.toolsState.indexingRunning',
  })

  updateExecutionState(toolCallId, {
    completedCount,
    failedCount,
    indexingTotalCount: controllers.length,
    indexingResolvedCount: resolvedCount,
    indexingFailedCount: failedCount,
    message,
    indexingStatus,
  })
}

function createWaitPromise(
  context: ReadMediaToolContext,
  mediaId: string,
  controller: ReadMediaItemController,
  onSettled?: () => void,
): Promise<void> {
  return context.ensureMediaIndexing(mediaId)
    .then(() => {
      controller.waitError = undefined
    })
    .catch((error) => {
      controller.waitError = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      onSettled?.()
    })
}

function refreshControllers(
  controllers: ReadMediaItemController[],
  fields: ReadMediaField[],
  context: ReadMediaToolContext,
  onWaitSettled?: () => void,
): void {
  for (const controller of controllers) {
    if (controller.itemStatus === 'success' || controller.itemStatus === 'failed') {
      continue
    }

    const { mediaItem, suggestedItem } = context.resolveMediaRequest(controller.requestedId)
    if (!mediaItem) {
      controller.itemStatus = 'failed'
      controller.failureReason = 'not_found'
      controller.suggestedId = suggestedItem?.id
      controller.failureMessage = suggestedItem
        ? `未找到素材，建议使用完整 ID ${suggestedItem.id}`
        : '未找到素材'
      continue
    }

    if (isMediaResolved(mediaItem, fields)) {
      controller.itemStatus = 'success'
      continue
    }

    const indexStatus = getIndexStatus(mediaItem)
    if (indexStatus === 'failed') {
      controller.itemStatus = 'failed'
      controller.failureReason = 'indexing_failed'
      controller.failureMessage = controller.waitError || '素材内容分析失败'
      continue
    }

    const needsIndex = fields.some(
      (field) =>
        fieldNeedsIndex(field)
        && fieldSupported(mediaItem, field)
        && !isIndexedFieldReady(mediaItem, field),
    )

    if (!needsIndex) {
      controller.itemStatus = 'success'
      continue
    }

    if (!controller.waitStarted) {
      controller.waitStarted = true
      controller.waitPromise = createWaitPromise(
        context,
        mediaItem.id,
        controller,
        onWaitSettled,
      )
    }
  }
}

function hasPendingControllers(controllers: ReadMediaItemController[]): boolean {
  return controllers.some((item) => item.itemStatus === 'pending')
}

function isRelevantResourceEvent(event: ResourceEvent, mediaIds: Set<string>): boolean {
  const key = event.node.key
  return Array.from(mediaIds).some((mediaId) => key === mediaId || key.startsWith(`${mediaId}:`))
}

async function waitForControllersToSettle(params: {
  controllers: ReadMediaItemController[]
  fields: ReadMediaField[]
  context: ReadMediaToolContext
  toolCallId?: string
  deadline: number
  isCancelled: () => boolean
  getWakeWaiting: () => (() => void) | null
  setWakeWaiting: (wake: (() => void) | null) => void
}): Promise<'event' | 'cancelled' | 'timeout'> {
  const {
    controllers,
    fields,
    context,
    toolCallId,
    deadline,
    isCancelled,
    getWakeWaiting,
    setWakeWaiting,
  } = params

  refreshControllers(
    controllers,
    fields,
    context,
    () => {
      const wake = getWakeWaiting()
      wake?.()
    },
  )

  updateExecutionProgress(toolCallId, controllers)

  if (!hasPendingControllers(controllers)) {
    return Promise.resolve('event')
  }

  if (isCancelled()) {
    return Promise.resolve('cancelled')
  }

  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    return Promise.resolve('timeout')
  }

  return waitForRelevantReadMediaSignal({
    controllers,
    context,
    remainingMs,
    isCancelled,
    setWakeWaiting,
  })
}

function waitForRelevantReadMediaSignal(params: {
  controllers: ReadMediaItemController[]
  context: ReadMediaToolContext
  remainingMs: number
  isCancelled: () => boolean
  setWakeWaiting: (wake: (() => void) | null) => void
}): Promise<'event' | 'cancelled' | 'timeout'> {
  const {
    controllers,
    context,
    remainingMs,
    isCancelled,
    setWakeWaiting,
  } = params

  return new Promise((resolve) => {
    let settled = false
    const finish = (reason: 'event' | 'cancelled' | 'timeout') => {
      if (settled) return
      settled = true
      cleanup()
      resolve(reason)
    }

    const mediaIdSet = new Set(
      controllers
        .filter((item) => item.itemStatus === 'pending')
        .map((item) => item.requestedId),
    )

    const unsubscribe = context.onJobResourceEvent((event) => {
      if (isCancelled()) {
        finish('cancelled')
        return
      }
      if (isRelevantResourceEvent(event, mediaIdSet)) {
        finish('event')
      }
    })

    const timerId = setTimeout(() => {
      finish(isCancelled() ? 'cancelled' : 'timeout')
    }, remainingMs)

    const wake = () => finish(isCancelled() ? 'cancelled' : 'event')
    setWakeWaiting(wake)

    const cleanup = () => {
      clearTimeout(timerId)
      unsubscribe()
      setWakeWaiting(null)
    }
  })
}

/**
 * read_media 工具执行函数
 */
export async function executeReadMedia(
  args: Record<string, any>,
  context?: ToolExecutionContext,
){
  try {
    const mediaIds = normalizeMediaIds(args.mediaIds)
    const includeSegments = normalizeIncludeSegments(args.includeSegments)
    const fields = buildReadFields(includeSegments)
    const unifiedStore = useUnifiedStore()
    const readMediaContext: ReadMediaToolContext = {
      resolveMediaRequest: (mediaId) =>
        getMediaItemOrSuggestion(mediaId, unifiedStore.mediaItems || []),
      ensureMediaIndexing: (mediaId) => unifiedStore.ensureMediaIndexing(mediaId),
      onJobResourceEvent: (listener) => unifiedStore.jobRuntime.onResourceEvent(listener),
    }
    const toolCallId = context?.toolCallId
    const controllers: ReadMediaItemController[] = mediaIds.map((mediaId) => ({
      requestedId: mediaId,
      itemStatus: 'pending',
      waitStarted: false,
    }))

    let cancelled = false
    let wakeWaiting: (() => void) | null = null

    if (toolCallId) {
      startExecutionState(toolCallId, mediaIds, fields)
      registerToolCancellationHook('read_media', toolCallId, () => {
        cancelled = true
        updateExecutionState(toolCallId, {
          cancelled: true,
          canCancel: false,
          message: '正在停止等待分析…',
          indexingStatus: createRuntimeI18nMessage('aiPanel.toolsState.indexingStopping'),
        })
        wakeWaiting?.()
      })
    }

    const deadline = Date.now() + MAX_WAIT_MS

    while (true) {
      const waitReason = await waitForControllersToSettle({
        controllers,
        fields,
        context: readMediaContext,
        toolCallId,
        deadline,
        isCancelled: () => cancelled,
        getWakeWaiting: () => wakeWaiting,
        setWakeWaiting: (wake) => {
          wakeWaiting = wake
        },
      })

      if (!hasPendingControllers(controllers)) {
        break
      }

      if (waitReason === 'cancelled') {
        markFailures(
          controllers,
          'user_cancelled_before_completed',
          '用户取消了本次素材读取',
        )
        break
      }

      if (waitReason === 'timeout') {
        markFailures(
          controllers,
          'indexing_timeout',
          '等待素材内容分析超时',
        )
        break
      }
    }

    const result = buildResultData(
      controllers,
      fields,
      readMediaContext,
    )

    if (toolCallId) {
      updateExecutionState(toolCallId, {
        active: false,
        canCancel: false,
        message: cancelled ? '素材读取已停止' : '素材读取完成',
        indexingStatus: createRuntimeI18nMessage(
          cancelled ? 'aiPanel.toolsState.indexingStopped' : 'aiPanel.toolsState.indexingFinished',
        ),
      })
    }
    return buildToolSuccess(
      'read_media',
      result,
      result.error ? undefined : `已返回 ${result.mediaItems.length} 个素材读取结果。`,
    )
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return buildToolError('read_media', 'invalid_arguments', message)
  } finally {
    const toolCallId = context?.toolCallId
    if (toolCallId) {
      finishExecutionState(toolCallId)
    }
  }
}

/**
 * 工具定义 - 供注册使用
 */
export const readMediaTool: ToolDefinition = {
  name: 'read_media',
  execute: executeReadMedia,
} as ToolDefinition
