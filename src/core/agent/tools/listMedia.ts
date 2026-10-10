/**
 * list_media 工具实现
 * 列出前端虚拟目录内容（非递归）
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData, UnifiedMediaIndexMetadata } from '@/core/mediaitem/types'
import type { ToolDefinition, ToolResult } from './types'
import { buildToolError, buildToolSuccess } from './utils/result'
import { buildCanonicalDirectoryPath } from './libraryPath'

interface VirtualEntry {
  id: string
  name: string
  type: 'directory' | 'asset'
  mediaItem?: UnifiedMediaItemData
}

const FALLBACK_MEDIA_TAG = 'media'

function getCompletedIndexingMetadata(
  mediaItem?: UnifiedMediaItemData,
): UnifiedMediaIndexMetadata | undefined {
  const indexing = mediaItem?.metadata?.indexing
  if (!indexing || indexing.indexStatus !== 'completed') {
    return undefined
  }

  return indexing
}

function isUnifiedMediaItemData(value: unknown): value is UnifiedMediaItemData {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'id' in value && 'name' in value && 'mediaType' in value
}

function formatMediaEntry(entry: VirtualEntry): Record<string, unknown> {
  const mediaItem = entry.mediaItem
  const indexing = getCompletedIndexingMetadata(mediaItem)
  const baseEntry = {
    type: 'media',
    mediaId: entry.id,
    name: entry.name,
    mediaType: mediaItem?.mediaType || FALLBACK_MEDIA_TAG,
  }

  if (!indexing) {
    return baseEntry
  }

  const title = indexing.summary?.title?.trim() || undefined

  if (indexing.mediaKind === 'image') {
    return {
      ...baseEntry,
      title,
    }
  }

  return {
    ...baseEntry,
    title,
    shots: indexing.segmentCount,
  }
}

function getDirectoryEntries(dirId: string): VirtualEntry[] {
  const store = useUnifiedStore()
  const directoriesMap = store.directories || new Map()
  const mediaItemsArray = store.getAllAssets ? store.getAllAssets() : store.mediaItems || []
  const mediaItemsMap = new Map<string, UnifiedMediaItemData>(
    mediaItemsArray.filter(isUnifiedMediaItemData).map((item) => [item.id, item]),
  )

  const dir = directoriesMap.get(dirId)
  if (!dir) {
    return []
  }

  const entries: VirtualEntry[] = []

  for (const childDirId of dir.childDirIds) {
    const childDir = directoriesMap.get(childDirId)
    if (childDir) {
      entries.push({
        id: childDirId,
        name: childDir.name,
        type: 'directory',
      })
    }
  }

  for (const mediaId of store.getAssetIdsInDirectory(dirId)) {
    const media = mediaItemsMap.get(mediaId)
    if (media) {
      entries.push({
        id: mediaId,
        name: media.name,
        type: 'asset',
        mediaItem: media,
      })
    }
  }

  return entries
}

function logListMediaResult(result: ToolResult): ToolResult {
  console.log('[list_media] result', result)
  return result
}

export async function executeListMedia(args: Record<string, unknown>): Promise<ToolResult> {
  const dirId = args.dirId
  const offset = args.offset ?? 1
  const limit = args.limit ?? 20

  try {
    if (dirId !== undefined && (typeof dirId !== 'string' || !dirId.trim())) {
      return logListMediaResult(
        buildToolError('list_media', 'invalid_arguments', 'dirId 必须是非空字符串。'),
      )
    }

    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1) {
      return logListMediaResult(
        buildToolError('list_media', 'invalid_arguments', 'offset 必须是大于等于 1 的整数。'),
      )
    }

    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
      return logListMediaResult(
        buildToolError('list_media', 'invalid_arguments', 'limit 必须是大于等于 1 的整数。'),
      )
    }

    const store = useUnifiedStore()
    const directory =
      dirId === undefined
        ? Array.from(store.directories.values()).find((dir) => dir.parentId === null)
        : store.getDirectory(dirId)

    if (!directory) {
      return logListMediaResult(
        buildToolError(
          'list_media',
          'directory_not_found',
          dirId === undefined ? '未找到素材库根目录。' : `未找到目录 ${dirId}。`,
          dirId === undefined ? undefined : { dirId },
        ),
      )
    }

    const path = buildCanonicalDirectoryPath(directory.id)
    if (path === null) {
      return logListMediaResult(
        buildToolError(
          'list_media',
          'invalid_directory_structure',
          '目录父级链存在循环或缺失，无法确定当前位置。',
          { dirId: directory.id },
        ),
      )
    }

    const entries = getDirectoryEntries(directory.id)
    entries.sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'zh-CN') ||
        (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

    const totalEntries = entries.length
    if (offset > totalEntries && totalEntries > 0) {
      return logListMediaResult(
        buildToolError(
          'list_media',
          'invalid_arguments',
          `offset=${offset} 超出范围。当前目录共有 ${totalEntries} 个条目。`,
          { offset, total: totalEntries },
        ),
      )
    }

    const startIdx = Math.max(offset - 1, 0)
    const endIdx = Math.min(startIdx + limit, totalEntries)
    const pagedEntries = entries.slice(startIdx, endIdx)
    const normalizedEntries = pagedEntries.map((entry) =>
      entry.type === 'directory'
        ? {
            type: 'directory',
            dirId: entry.id,
            name: entry.name,
          }
        : formatMediaEntry(entry),
    )

    const nextOffset = endIdx < totalEntries ? endIdx + 1 : null
    return logListMediaResult(
      buildToolSuccess('list_media', {
        dirId: directory.id,
        name: directory.name,
        parentDirId: directory.parentId,
        path,
        entries: normalizedEntries,
        page: {
          offset,
          limit,
          total: totalEntries,
          nextOffset,
        },
      }),
    )
  } catch (error: unknown) {
    return logListMediaResult(
      buildToolError(
        'list_media',
        'internal_error',
        error instanceof Error ? error.message : String(error),
      ),
    )
  }
}

export const listMediaTool: ToolDefinition = {
  name: 'list_media',
  execute: executeListMedia,
} as ToolDefinition
