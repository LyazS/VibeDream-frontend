/**
 * read_media 工具实现
 * 按字段读取素材详情，必要时触发索引并等待完成，最终返回 XML。
 */

import { computed, reactive } from 'vue'
import type { ResourceEvent } from '@/core/jobs/ResourceTypes'
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
import { buildXmlAttributes, escapeXmlText } from './utils/xml'
import {
  buildIndexingStatusMessage,
  createRuntimeI18nMessage,
  type IndexingRuntimeState,
} from './indexingRuntime'

const MAX_MEDIA_IDS = 10
const MAX_WAIT_MS = 30 * 60 * 1000

type ReadMediaField = 'basic' | 'summary' | 'segments'
type ReadMediaOverallStatus = 'success' | 'partial_success' | 'failed'
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

const SUPPORTED_FIELDS = new Set<ReadMediaField>(['basic', 'summary', 'segments'])

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
const cancellationHooks = new Map<string, () => Promise<void> | void>()

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
  cancellationHooks.delete(toolCallId)
}

export async function cancelReadMediaExecution(toolCallId: string): Promise<void> {
  const hook = cancellationHooks.get(toolCallId)
  if (!hook) return
  await hook()
}

function registerCancellationHook(
  toolCallId: string,
  hook: () => Promise<void> | void,
): void {
  cancellationHooks.set(toolCallId, hook)
}

function isReadMediaField(value: unknown): value is ReadMediaField {
  return typeof value === 'string' && SUPPORTED_FIELDS.has(value as ReadMediaField)
}

function normalizeFields(fields: unknown): ReadMediaField[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('fields must be a non-empty array')
  }

  const normalized: ReadMediaField[] = []
  for (const field of fields) {
    if (!isReadMediaField(field)) {
      throw new Error(`Unsupported read_media field: ${String(field)}`)
    }
    if (!normalized.includes(field)) {
      normalized.push(field)
    }
  }

  return normalized
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

function buildBasicNode(mediaItem: UnifiedMediaItemData): string {
  return `<basic ${buildXmlAttributes([
    ['id', mediaItem.id],
    ['name', mediaItem.name],
    ['media_type', mediaItem.mediaType],
    ['duration', formatDuration(mediaItem.duration)],
  ])} />`
}

function buildSummaryNode(indexing?: UnifiedMediaIndexMetadata): string | null {
  const summary = indexing?.summary
  if (!summary?.title && !summary?.summary) {
    return null
  }

  const attrs = buildXmlAttributes([['title', summary?.title]])
  const content = summary?.summary ? escapeXmlText(summary.summary) : ''
  return `<summary${attrs ? ` ${attrs}` : ''}>${content}</summary>`
}

function buildSegmentsNode(indexing?: UnifiedVideoMediaIndexMetadata): string | null {
  const segments = indexing?.segmentSummaries || []
  if (segments.length === 0) {
    return null
  }

  const lines = [
    `<segments ${buildXmlAttributes([['count', segments.length]])}>`,
  ]
  for (const segment of segments) {
    const attrs = buildXmlAttributes([
      ['index', segment.segmentIndex],
      ['start', segment.startTimecode],
      ['end', segment.endTimecode],
      ['title', segment.title],
    ])
    lines.push(
      `  <segment${attrs ? ` ${attrs}` : ''}>${escapeXmlText(segment.summary || '')}</segment>`,
    )
  }
  lines.push('</segments>')
  return lines.join('\n')
}

function buildMediaNode(
  controller: ReadMediaItemController,
  fields: ReadMediaField[],
  context: ReadMediaToolContext,
): string {
  const { mediaItem, suggestedItem } = context.resolveMediaRequest(controller.requestedId)
  if (!mediaItem) {
    return `<media ${buildXmlAttributes([
      ['id', controller.requestedId],
      ['status', 'failed'],
      ['reason', controller.failureReason || 'not_found'],
      ['suggested_id', controller.suggestedId || suggestedItem?.id],
      ['message', controller.failureMessage],
    ])} />`
  }

  const indexing = getIndexMetadata(mediaItem)
  const lines = [
    `<media ${buildXmlAttributes([
      ['id', mediaItem.id],
      ['status', controller.itemStatus === 'pending' ? 'failed' : controller.itemStatus],
      ['media_type', mediaItem.mediaType],
      ['index_status', getIndexStatus(mediaItem)],
      ['reason', controller.itemStatus === 'failed' ? controller.failureReason : undefined],
      ['message', controller.itemStatus === 'failed' ? controller.failureMessage : undefined],
    ])}>`,
  ]

  if (fields.includes('basic')) {
    lines.push(`  ${buildBasicNode(mediaItem)}`)
  }

  if (fields.includes('summary') && fieldSupported(mediaItem, 'summary')) {
    const summaryNode = buildSummaryNode(
      getVideoMetadata(indexing) || getImageMetadata(indexing),
    )
    if (summaryNode) {
      lines.push(`  ${summaryNode}`)
    }
  }

  if (fields.includes('segments') && fieldSupported(mediaItem, 'segments')) {
    const segmentsNode = buildSegmentsNode(getVideoMetadata(indexing))
    if (segmentsNode) {
      lines.push(...segmentsNode.split('\n').map((line) => `  ${line}`))
    }
  }

  lines.push('</media>')
  return lines.join('\n')
}

function buildResultXml(
  controllers: ReadMediaItemController[],
  fields: ReadMediaField[],
  context: ReadMediaToolContext,
  cancelled: boolean,
): string {
  const successCount = controllers.filter((item) => item.itemStatus === 'success').length
  const failedCount = controllers.filter((item) => item.itemStatus === 'failed').length
  const status: ReadMediaOverallStatus = successCount > 0 && failedCount > 0
    ? 'partial_success'
    : successCount > 0
      ? 'success'
      : 'failed'

  const lines = [
    `<read_media ${buildXmlAttributes([
      ['status', status],
      ['cancelled', cancelled],
      ['fields', fields.join(',')],
    ])}>`,
  ]

  for (const controller of controllers) {
    lines.push(
      ...buildMediaNode(controller, fields, context)
        .split('\n')
        .map((line) => `  ${line}`),
    )
  }

  lines.push('</read_media>')
  return lines.join('\n')
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
    message = `正在索引并读取素材（${completedCount} 成功 / ${failedCount} 失败 / ${pendingCount} 进行中）`
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
      controller.failureMessage = controller.waitError || '素材索引失败'
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
): Promise<string> {
  try {
    const mediaIds = normalizeMediaIds(args.mediaIds)
    const fields = normalizeFields(args.fields)
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
      registerCancellationHook(toolCallId, () => {
        cancelled = true
        updateExecutionState(toolCallId, {
          cancelled: true,
          canCancel: false,
          message: '正在停止等待索引…',
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
          '等待素材索引超时',
        )
        break
      }
    }

    const result = buildResultXml(
      controllers,
      fields,
      readMediaContext,
      cancelled,
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
    return result
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return `<error>${escapeXmlText(message)}</error>`
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
