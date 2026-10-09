/**
 * list_media 工具实现
 * 列出前端虚拟目录内容（非递归）
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData, UnifiedMediaIndexMetadata } from '@/core/mediaitem/types'
import type { VirtualDirectory } from '@/core/directory/types'
import type { ToolDefinition, ToolResult } from './types'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  buildCanonicalDirectoryPath as buildCanonicalPath,
  normalizeDirectoryPath,
} from './libraryPath'

interface VirtualEntry {
  id: string
  name: string
  type: 'directory' | 'asset'
  mediaItem?: UnifiedMediaItemData
}

interface ResolvedDirectoryPath {
  dirId: string
  canonicalPath: string
}

const FALLBACK_MEDIA_TAG = 'media'

function getCompletedIndexingMetadata(mediaItem?: UnifiedMediaItemData): UnifiedMediaIndexMetadata | undefined {
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

function resolveNamedPathToDirId(filePath: string): ResolvedDirectoryPath | null {
  try {
    const normalizedPath = normalizeDirectoryPath(filePath)
    if (!normalizedPath) {
      return null
    }

    const store = useUnifiedStore()
    const directoriesMap = store.directories || new Map<string, VirtualDirectory>()
    const rootDir = Array.from(directoriesMap.values()).find((dir) => dir.parentId === null)
    if (!rootDir) {
      return null
    }

    if (normalizedPath === '/') {
      return { dirId: rootDir.id, canonicalPath: '/' }
    }

    const pathSegments = normalizedPath
      .replace(/^\//, '')
      .split('/')
      .filter(Boolean)

    let currentDir = rootDir
    let resolvedPath = '/'

    for (const segment of pathSegments) {
      const childDir = currentDir.childDirIds
        .map((childId) => directoriesMap.get(childId))
        .filter((dir): dir is VirtualDirectory => dir !== undefined)
        .find((dir) => dir.name === segment)

      if (!childDir) {
        return null
      }

      currentDir = childDir
      resolvedPath = resolvedPath === '/' ? `/${segment}/` : `${resolvedPath}${segment}/`
    }

    return {
      dirId: currentDir.id,
      canonicalPath: resolvedPath,
    }
  } catch (error) {
    console.error('resolveNamedPathToDirId error:', error)
    return null
  }
}

function explainPathResolutionFailure(filePath: string): { failedSegment: string | null; resolvedParentPath: string } {
  const normalizedPath = normalizeDirectoryPath(filePath)
  if (!normalizedPath || normalizedPath === '/') {
    return { failedSegment: null, resolvedParentPath: '/' }
  }

  const store = useUnifiedStore()
  const directoriesMap = store.directories || new Map<string, VirtualDirectory>()
  const rootDir = Array.from(directoriesMap.values()).find((dir) => dir.parentId === null)
  if (!rootDir) {
    return { failedSegment: null, resolvedParentPath: '/' }
  }

  const pathSegments = normalizedPath
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)

  let currentDir = rootDir
  const resolvedSegments: string[] = []

  for (const segment of pathSegments) {
    const childDir = currentDir.childDirIds
      .map((childId) => directoriesMap.get(childId))
      .filter((dir): dir is VirtualDirectory => dir !== undefined)
      .find((dir) => dir.name === segment)

    if (!childDir) {
      return {
        failedSegment: segment,
        resolvedParentPath: resolvedSegments.length === 0 ? '/' : `/${resolvedSegments.join('/')}/`,
      }
    }

    resolvedSegments.push(segment)
    currentDir = childDir
  }

  return {
    failedSegment: null,
    resolvedParentPath: resolvedSegments.length === 0 ? '/' : `/${resolvedSegments.join('/')}/`,
  }
}

function getDirectoryEntries(dirId: string): VirtualEntry[] {
  try {
    const store = useUnifiedStore()
    const directoriesMap = store.directories || new Map()
    const mediaItemsArray = store.getAllAssets ? store.getAllAssets() : store.mediaItems || []
    const mediaItemsMap = new Map<string, UnifiedMediaItemData>(
      mediaItemsArray
        .filter(isUnifiedMediaItemData)
        .map((item) => [item.id, item]),
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
  } catch (error) {
    console.error('getDirectoryEntries error:', error)
    return []
  }
}

function logListMediaResult(result: ToolResult): ToolResult {
  console.log('[list_media] result', result)
  return result
}

export async function executeListMedia(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.filePath
  const offset = args.offset ?? 1
  const limit = args.limit ?? 20

  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return logListMediaResult(
        buildToolError('list_media', 'invalid_arguments', 'filePath 是必填项，且必须是字符串。'),
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

    const normalizedPath = normalizeDirectoryPath(filePath)
    if (!normalizedPath) {
      return logListMediaResult(
        buildToolError(
          'list_media',
          'invalid_arguments',
          `路径 ${filePath} 不是有效的目录路径。路径必须以 / 开头。`,
          { filePath },
        ),
      )
    }

    const resolved = resolveNamedPathToDirId(normalizedPath)

    if (!resolved) {
      const resolution = explainPathResolutionFailure(normalizedPath)
      return logListMediaResult(
        buildToolError(
          'list_media',
          'not_found',
          `未找到路径 ${normalizedPath} 对应的目录。`,
          {
            filePath: normalizedPath,
            failedSegment: resolution.failedSegment,
            resolvedParentPath: resolution.resolvedParentPath,
          },
        ),
      )
    }

    const entries = getDirectoryEntries(resolved.dirId)
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

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
            name: entry.name,
          }
        : formatMediaEntry(entry),
    )

    const canonicalPath = buildCanonicalPath(resolved.dirId) || resolved.canonicalPath
    const nextOffset = endIdx < totalEntries ? endIdx + 1 : null
    return logListMediaResult(
      buildToolSuccess('list_media', {
        path: canonicalPath,
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
