/**
 * search_media 工具实现
 * 检索当前项目内已完成索引的素材和视频分片
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { computed, reactive } from 'vue'
import type { RetrievalResultItem, SearchMediaStage } from '../../services/mediaIndexService'
import { searchMedia } from '../../services/mediaIndexService'
import type { ToolDefinition, ToolExecutionContext } from '../core/toolTypes'
import { buildXmlAttributes, escapeXmlText } from './utils/xml'
import {
  buildIndexingStatusMessage,
  createRuntimeI18nMessage,
  type IndexingRuntimeState,
} from './indexingRuntime'

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
    message: '正在补齐素材索引…',
  }
}

function updateExecutionState(
  toolCallId: string,
  stage: SearchMediaStage,
  completedSteps: number,
  totalSteps: number,
): void {
  const current = activeExecutions[toolCallId]
  if (!current) return

  const messageByStage: Record<SearchMediaStage, string> = {
    indexing: '正在补齐素材索引…',
    retrieval: '正在召回候选素材…',
    rerank: '正在重排候选结果…',
    validate: '正在校验命中结果…',
  }

  current.currentStage = stage
  current.completedSteps = completedSteps
  current.totalSteps = totalSteps
  current.message = messageByStage[stage]
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

function formatEvidenceNode(evidence: string | null): string | null {
  if (!evidence) {
    return null
  }

  return `<evidence>${escapeXmlText(evidence)}</evidence>`
}

function getValidationResult(item: RetrievalResultItem) {
  return item.validation_result
}

function getEvidence(item: RetrievalResultItem): string | null {
  const validationResult = getValidationResult(item)
  const reason = validationResult?.reason?.trim()
  return reason || null
}

function formatVideoHit(item: RetrievalResultItem): string {
  const validationResult = getValidationResult(item)
  const attrs = buildXmlAttributes([
    ['media_item_id', item.media_item_id],
    ['media_name', item.media_name],
    ['score', item.score.toFixed(3)],
    ['verdict', validationResult?.verdict],
    ['segment_index', item.segment?.segment_index],
    ['start_timecode', item.segment?.start_timecode],
    ['end_timecode', item.segment?.end_timecode],
  ])
  const evidenceNode = formatEvidenceNode(getEvidence(item))

  if (!evidenceNode) {
    return `<video_hit${attrs ? ` ${attrs}` : ''}></video_hit>`
  }

  return [
    `<video_hit${attrs ? ` ${attrs}` : ''}>`,
    `  ${evidenceNode}`,
    `</video_hit>`,
  ].join('\n')
}

function formatImageHit(item: RetrievalResultItem): string {
  const validationResult = getValidationResult(item)
  const attrs = buildXmlAttributes([
    ['media_item_id', item.media_item_id],
    ['media_name', item.media_name],
    ['score', item.score.toFixed(3)],
    ['verdict', validationResult?.verdict],
  ])
  const evidenceNode = formatEvidenceNode(getEvidence(item))

  if (!evidenceNode) {
    return `<image_hit${attrs ? ` ${attrs}` : ''}></image_hit>`
  }

  return [
    `<image_hit${attrs ? ` ${attrs}` : ''}>`,
    `  ${evidenceNode}`,
    `</image_hit>`,
  ].join('\n')
}

function formatResult(item: RetrievalResultItem): string {
  if (item.media_kind === 'video' && item.segment) {
    return formatVideoHit(item)
  }

  return formatImageHit(item)
}

function buildSearchMediaXml(params: {
  status: 'success' | 'failed'
  query: string
  requestedTopK: number
  results: RetrievalResultItem[]
  error?: string
}): string {
  const { status, query, requestedTopK, results, error } = params
  const lines = [
    `<search_media ${buildXmlAttributes([
      ['status', status],
      ['query', query],
      ['requested_top_k', requestedTopK],
      ['returned_results', results.length],
    ])}>`,
  ]

  for (const item of results) {
    lines.push(...formatResult(item).split('\n').map((line) => `  ${line}`))
  }

  if (error) {
    lines.push(`  <error>${escapeXmlText(error)}</error>`)
  }

  lines.push(`</search_media>`)
  return lines.join('\n')
}

function logSearchMediaResult(result: string): string {
  console.log('[search_media] result', result)
  return result
}

export async function executeSearchMedia(
  args: Record<string, any>,
  context?: ToolExecutionContext,
): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const topK = normalizeTopK(args.top_k)
  const toolCallId = context?.toolCallId
  if (!query) {
    return logSearchMediaResult(buildSearchMediaXml({
      status: 'failed',
      query,
      requestedTopK: topK,
      results: [],
      error: 'query must be a non-empty string',
    }))
  }

  const unifiedStore = useUnifiedStore()

  if (!unifiedStore.projectId) {
    return logSearchMediaResult(buildSearchMediaXml({
      status: 'failed',
      query,
      requestedTopK: topK,
      results: [],
      error: '当前项目未初始化，无法检索素材',
    }))
  }

  if (toolCallId) {
    startExecutionState(toolCallId, query)
  }

  try {
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
        updateExecutionState(toolCallId, stage, completedSteps, totalSteps)
      },
      onIndexingProgress: (resolvedCount, totalCount, failedCount) => {
        if (!toolCallId) return
        updateIndexingProgress(toolCallId, resolvedCount, totalCount, failedCount)
      },
    })
    const hasMissingValidation = results.some((item) => !item.validation_result)

    return logSearchMediaResult(buildSearchMediaXml({
      status: error || hasMissingValidation ? 'failed' : 'success',
      query,
      requestedTopK: topK,
      results: error || hasMissingValidation ? [] : results,
      error: error || (hasMissingValidation ? '搜索结果缺少校验信息' : undefined),
    }))
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
