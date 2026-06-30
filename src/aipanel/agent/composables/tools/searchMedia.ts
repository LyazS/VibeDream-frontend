/**
 * search_media 工具实现
 * 检索当前项目内已完成索引的素材和视频分片
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { computed, reactive } from 'vue'
import type { RetrievalResultItem, SearchMediaStage } from '../../services/mediaIndexService'
import { searchMedia } from '../../services/mediaIndexService'
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

const DEFAULT_TOP_K = 5
const MIN_TOP_K = 1
const MAX_TOP_K = 10
const SEARCH_MEDIA_TOTAL_STEPS = 4

export interface SearchMediaExecutionState extends IndexingRuntimeState {
  toolCallId: string
  query: string
  currentStage: SearchMediaStage
  totalSteps: number
  completedSteps: number
  active: boolean
  canCancel: boolean
  cancelled: boolean
  message: string
}

const activeExecutions = reactive<Record<string, SearchMediaExecutionState>>({})

export function useSearchMediaExecutionState(toolCallId: string) {
  return computed(() => activeExecutions[toolCallId] ?? null)
}

function startExecutionState(toolCallId: string, query: string): void {
  activeExecutions[toolCallId] = {
    toolCallId,
    query,
    currentStage: 'indexing',
    totalSteps: SEARCH_MEDIA_TOTAL_STEPS,
    completedSteps: 0,
    indexingTotalCount: 0,
    indexingResolvedCount: 0,
    indexingFailedCount: 0,
    indexingStatus: createRuntimeI18nMessage('aiPanel.toolsState.indexingPreparing'),
    active: true,
    canCancel: true,
    cancelled: false,
    message: '正在补齐素材索引…',
  }
}

function updateExecutionState(
  toolCallId: string,
  patch: Partial<SearchMediaExecutionState>,
): void {
  const current = activeExecutions[toolCallId]
  if (!current) return
  Object.assign(current, patch)
}

function updateIndexingProgress(
  toolCallId: string,
  resolvedCount: number,
  totalCount: number,
  failedCount: number,
): void {
  const current = activeExecutions[toolCallId]
  if (!current) return

  current.indexingResolvedCount = resolvedCount
  current.indexingTotalCount = totalCount
  current.indexingFailedCount = failedCount
  current.indexingStatus = buildIndexingStatusMessage({
    resolvedCount,
    totalCount,
    failedCount,
    idleKey: 'aiPanel.toolsState.indexingIdle',
    progressKey: 'aiPanel.toolsState.indexingRunning',
  })
}

function finishExecutionState(toolCallId: string): void {
  delete activeExecutions[toolCallId]
  unregisterToolCancellationHook('search_media', toolCallId)
}

function normalizeTopK(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TOP_K
  }

  const integer = Math.trunc(value)
  if (integer < MIN_TOP_K) return MIN_TOP_K
  if (integer > MAX_TOP_K) return MAX_TOP_K
  return integer
}

function getValidationResult(item: RetrievalResultItem) {
  return item.validation_result
}

function getEvidence(item: RetrievalResultItem): string | null {
  const validationResult = getValidationResult(item)
  const reason = validationResult?.reason?.trim()
  return reason || null
}

function formatResult(item: RetrievalResultItem): Record<string, any> {
  const validationResult = getValidationResult(item)
  return {
    type: item.media_kind,
    mediaId: item.media_item_id,
    mediaName: item.media_name,
    verdict: validationResult?.verdict,
    segment: item.segment
      ? {
          index: item.segment.segment_index,
          clipStart: item.segment.start_timecode,
          clipEnd: item.segment.end_timecode,
        }
      : undefined,
    evidence: getEvidence(item) || undefined,
  }
}

function logSearchMediaResult(result: Record<string, any>) {
  console.log('[search_media] result', result)
  return result
}

export async function executeSearchMedia(
  args: Record<string, any>,
  context?: ToolExecutionContext,
){
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const topK = normalizeTopK(args.top_k)
  const toolCallId = context?.toolCallId
  if (!query) {
    return logSearchMediaResult(
      buildToolError('search_media', 'invalid_arguments', 'query must be a non-empty string'),
    )
  }

  const unifiedStore = useUnifiedStore()

  if (!unifiedStore.projectId) {
    return logSearchMediaResult(
      buildToolError('search_media', 'internal_error', '当前项目未初始化，无法检索素材'),
    )
  }

  if (toolCallId) {
    startExecutionState(toolCallId, query)
  }

  try {
    const abortController = toolCallId ? new AbortController() : null
    let cancelled = false
    const checkCancelled = () => {
      if (cancelled) {
        throw new DOMException('Search media execution aborted', 'AbortError')
      }
    }

    if (toolCallId && abortController) {
      registerToolCancellationHook('search_media', toolCallId, () => {
        cancelled = true
        abortController.abort()
        updateExecutionState(toolCallId, {
          cancelled: true,
          canCancel: false,
          active: false,
          message: '正在停止素材检索…',
          indexingStatus: createRuntimeI18nMessage('aiPanel.toolsState.indexingStopping'),
        })
      })
    }

    const { results, error } = await searchMedia({
      query,
      projectId: unifiedStore.projectId,
      getMediaItem: (id) => unifiedStore.getMediaItem(id),
      mediaItems: unifiedStore.mediaItems || [],
      ensureMediaIndexing: (id) => unifiedStore.ensureMediaIndexing(id),
      t: (key) => key,
      topK,
      onProgress: (stage, completedSteps, totalSteps) => {
        if (!toolCallId) return
        const messageByStage: Record<SearchMediaStage, string> = {
          indexing: '正在补齐素材索引…',
          retrieval: '正在召回候选素材…',
          rerank: '正在重排候选结果…',
          validate: '正在校验命中结果…',
        }
        updateExecutionState(toolCallId, {
          currentStage: stage,
          completedSteps,
          totalSteps,
          message: messageByStage[stage],
        })
      },
      onIndexingProgress: (resolvedCount, totalCount, failedCount) => {
        if (!toolCallId) return
        updateIndexingProgress(toolCallId, resolvedCount, totalCount, failedCount)
      },
      signal: abortController?.signal,
      checkCancelled,
    })

    if (cancelled) {
      return logSearchMediaResult(
        buildToolError('search_media', 'user_cancelled', '用户取消了本次素材检索'),
      )
    }
    const hasMissingValidation = results.some((item) => !item.validation_result)

    if (error || hasMissingValidation) {
      return logSearchMediaResult(
        buildToolError(
          'search_media',
          'internal_error',
          error || '搜索结果缺少校验信息',
          { query, requestedTopK: topK },
        ),
      )
    }

    const normalizedResults = results.map(formatResult)
    return logSearchMediaResult(
      buildToolSuccess(
        'search_media',
        {
          query,
          requestedTopK: topK,
          results: normalizedResults,
        },
        `找到 ${normalizedResults.length} 个匹配素材。`,
      ),
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return logSearchMediaResult(
        buildToolError('search_media', 'user_cancelled', '用户取消了本次素材检索'),
      )
    }
    throw error
  } finally {
    if (toolCallId) {
      finishExecutionState(toolCallId)
    }
  }
}

export const searchMediaTool: ToolDefinition = {
  name: 'search_media',
  execute: executeSearchMedia,
} as ToolDefinition
