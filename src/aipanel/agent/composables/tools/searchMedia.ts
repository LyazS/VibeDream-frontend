/**
 * search_media 工具实现
 * 检索当前项目内已完成索引的素材和视频分片
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import type { RetrievalResultItem } from '../../services/mediaIndexService'
import { searchMedia } from '../../services/mediaIndexService'
import type { ToolDefinition } from '../core/toolTypes'

const DEFAULT_TOP_K = 5
const MIN_TOP_K = 1
const MAX_TOP_K = 10

function normalizeTopK(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TOP_K
  }

  const integer = Math.trunc(value)
  if (integer < MIN_TOP_K) return MIN_TOP_K
  if (integer > MAX_TOP_K) return MAX_TOP_K
  return integer
}

function formatResult(index: number, item: RetrievalResultItem): string[] {
  const lines = [
    `${index}. [media_item_id: ${item.media_item_id}] ${item.media_name}`,
    `   media_kind: ${item.media_kind}`,
    `   score: ${item.score.toFixed(3)}`,
  ]

  if (item.segment) {
    lines.push(`   segment_index: ${item.segment.segment_index}`)
    lines.push(`   start_timecode: ${item.segment.start_timecode}`)
    lines.push(`   end_timecode: ${item.segment.end_timecode}`)
  }

  if (item.title) {
    lines.push(`   title: ${item.title}`)
  }

  if (item.summary) {
    lines.push(`   summary: ${item.summary}`)
  }

  return lines
}

export async function executeSearchMedia(args: Record<string, any>): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return 'Error: query must be a non-empty string'
  }

  const topK = normalizeTopK(args.top_k)
  const unifiedStore = useUnifiedStore()

  if (!unifiedStore.projectId) {
    return 'Error: 当前项目未初始化，无法检索素材'
  }

  const { results, error } = await searchMedia({
    query,
    projectId: unifiedStore.projectId,
    getMediaItem: (id) => unifiedStore.getMediaItem(id),
    t: (key) => key,
    enableValidation: false,
    topK,
  })

  const lines: string[] = [
    `query: ${query}`,
    `requested_top_k: ${topK}`,
    `returned_results: ${results.length}`,
  ]

  if (error) {
    lines.push(`note: ${error}`)
    if (error.includes('rerankFailed')) {
      lines.push('fallback: 已回退到原始召回结果')
    }
  }

  if (results.length === 0) {
    lines.push('results: 0 条结果')
    return lines.join('\n')
  }

  lines.push('results:')
  for (const [index, item] of results.entries()) {
    lines.push(...formatResult(index + 1, item))
  }

  return lines.join('\n')
}

export const searchMediaTool: ToolDefinition = {
  name: 'search_media',
  execute: executeSearchMedia,
} as ToolDefinition
