/**
 * list_contents 工具实现
 * 列出前端虚拟目录内容（非递归）
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData, UnifiedMediaIndexMetadata } from '@/core/mediaitem/types'
import type { ToolDefinition } from '../core/toolTypes'

/**
 * 虚拟路径条目接口
 */
interface VirtualEntry {
  /** 唯一标识符 */
  id: string
  /** 名称 */
  name: string
  /** 类型 */
  type: 'directory' | 'asset'
  /** 资产对象 */
  mediaItem?: UnifiedMediaItemData
}

interface ShotOutlineItem {
  index: number
  title: string
}

const SHOT_OUTLINE_HEAD_COUNT = 2
const SHOT_OUTLINE_TAIL_COUNT = 1
const FALLBACK_MEDIA_TAG = 'media'

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildXmlAttributes(attributes: Array<[string, string | number | undefined]>): string {
  return attributes
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`)
    .join(' ')
}

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

function buildShotOutline(
  indexing: Extract<UnifiedMediaIndexMetadata, { mediaKind: 'video' }>,
): ShotOutlineItem[] {
  const titledShots = (indexing.segmentSummaries || [])
    .filter((segment) => typeof segment.title === 'string' && segment.title.trim())
    .map((segment) => ({
      index: segment.segmentIndex,
      title: segment.title!.trim(),
    }))

  if (titledShots.length <= SHOT_OUTLINE_HEAD_COUNT + SHOT_OUTLINE_TAIL_COUNT) {
    return titledShots
  }

  const head = titledShots.slice(0, SHOT_OUTLINE_HEAD_COUNT)
  const tail = titledShots.slice(-SHOT_OUTLINE_TAIL_COUNT)
  const dedupedTail = tail.filter(
    (tailItem) => !head.some((headItem) => headItem.index === tailItem.index),
  )

  return [...head, ...dedupedTail]
}

function formatDirectoryEntry(entry: VirtualEntry): string {
  const attrs = buildXmlAttributes([['id', entry.id]])
  return `<dir ${attrs}>${escapeXmlText(entry.name)}</dir>`
}

function getMediaTagName(mediaItem?: UnifiedMediaItemData): string {
  const mediaType = mediaItem?.mediaType
  if (mediaType === 'video' || mediaType === 'image' || mediaType === 'audio' || mediaType === 'text') {
    return mediaType
  }

  return FALLBACK_MEDIA_TAG
}

function formatMediaEntry(entry: VirtualEntry): string {
  const mediaItem = entry.mediaItem
  const indexing = getCompletedIndexingMetadata(mediaItem)
  const tagName = getMediaTagName(mediaItem)
  const baseAttributes: Array<[string, string | number | undefined]> = [
    ['id', entry.id],
    ['name', entry.name],
  ]

  if (!indexing) {
    return `<${tagName} ${buildXmlAttributes(baseAttributes)} />`
  }

  const title = indexing.summary?.title?.trim() || undefined

  if (indexing.mediaKind === 'image') {
    return `<${tagName} ${buildXmlAttributes([
      ...baseAttributes,
      ['title', title],
    ])} />`
  }

  const shotOutline = buildShotOutline(indexing)
  const mediaAttributes = buildXmlAttributes([
    ...baseAttributes,
    ['title', title],
    ['shots', indexing.segmentCount],
  ])

  if (shotOutline.length === 0) {
    return `<${tagName} ${mediaAttributes} />`
  }

  const totalShots = indexing.segmentCount ?? shotOutline.length
  const shouldShowEllipsis = totalShots > shotOutline.length
  const lines: string[] = [`<${tagName} ${mediaAttributes}>`]

  for (let i = 0; i < shotOutline.length; i++) {
    const shot = shotOutline[i]
    const isBeforeTail = shouldShowEllipsis && i === SHOT_OUTLINE_HEAD_COUNT
    if (isBeforeTail) {
      lines.push(`  <ellipsis>...</ellipsis>`)
    }
    lines.push(
      `  <shot ${buildXmlAttributes([['index', shot.index]])}>${escapeXmlText(shot.title)}</shot>`,
    )
  }

  lines.push(`</${tagName}>`)
  return lines.join('\n')
}

/**
 * 解析 ID 路径为目录ID
 * 路径格式：基于 ID 的路径，如 '/dir_abc123/dir_def456/'
 * - '/' - 根目录
 * - '/dir_root_id/dir_child_id/' - 子目录（必须以 / 开头，至少包含完整路径）
 *
 * 注意：不支持单个 ID 格式（如 'dir_abc123'），必须使用路径格式
 *
 * @param idPath ID 路径
 * @returns 最终指向的目录ID，如果不存在则返回 null
 */
function resolveIdPathToDirId(idPath: string): string | null {
  try {
    const store = useUnifiedStore()
    const directoriesMap = store.directories || new Map()

    const trimmedPath = idPath.trim()

    // 强制要求路径以 / 开头
    if (!trimmedPath.startsWith('/')) {
      console.error('Invalid path format: must start with /', idPath)
      return null
    }

    // 标准化路径：确保以 / 结尾
    let normalizedPath = trimmedPath
    if (!normalizedPath.endsWith('/') && normalizedPath !== '/') {
      normalizedPath += '/'
    }

    // 处理根目录
    if (normalizedPath === '/') {
      // 返回第一个根目录的ID
      for (const [id, dir] of directoriesMap) {
        if (dir.parentId === null) {
          return id
        }
      }
      return null
    }

    // 解析 ID 路径：移除开头的 /，按 / 分割
    const pathParts = normalizedPath.replace(/^\//, '').split('/').filter(Boolean)

    if (pathParts.length === 0) {
      return null
    }

    // 从第一个 ID 开始逐层验证
    let currentId: string | null = pathParts[0]

    // 验证第一个目录是否存在
    if (!directoriesMap.has(currentId)) {
      return null
    }

    // 如果只有一个 ID，直接返回
    if (pathParts.length === 1) {
      return currentId
    }

    // 逐层验证后续的 ID 路径
    for (let i = 1; i < pathParts.length; i++) {
      const targetId = pathParts[i]
      const currentDir = directoriesMap.get(currentId)

      if (!currentDir) {
        return null
      }

      // 验证 targetId 是否是当前目录的直接子目录
      if (!currentDir.childDirIds.includes(targetId)) {
        return null
      }

      currentId = targetId
    }

    return currentId
  } catch (error) {
    console.error('resolveIdPathToDirId error:', error)
    return null
  }
}

/**
 * 获取目录的直接子项（非递归）
 * @param dirId 目录ID
 * @returns 条目列表
 */
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

    // 添加子目录
    for (const childDirId of dir.childDirIds) {
      const childDir = directoriesMap.get(childDirId)
      if (childDir) {
        entries.push({
          id: childDirId,
          name: childDir.name,
          type: 'directory'
        })
      }
    }

    // 添加资产项
    for (const mediaId of dir.assetIds) {
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

/**
 * 从目录 ID 构建名称路径（用于显示）
 * @param dirId 目录 ID
 * @returns 名称路径，如 '/素材/视频/'
 */
function buildPathName(dirId: string): string {
  try {
    const store = useUnifiedStore()
    const directoriesMap = store.directories || new Map()

    const pathParts: string[] = []
    let currentId: string | null = dirId

    // 从当前目录向上回溯到根目录
    while (currentId !== null) {
      const dir = directoriesMap.get(currentId)
      if (!dir) {
        break
      }

      pathParts.unshift(dir.name)
      currentId = dir.parentId
    }

    // 构建路径字符串
    return '/' + pathParts.join('/') + '/'
  } catch (error) {
    console.error('buildPathName error:', error)
    return '/'
  }
}

function logListContentsResult(
  filePath: string,
  offset: number,
  limit: number,
  result: string,
): string {
  console.log('[list_contents] result', result)
  return result
}

/**
 * list_contents 工具执行函数
 *
 * 列出前端虚拟目录的直接子项（非递归）。
 * 使用虚拟路径读取素材库目录内容（如 '/视频/'），返回该目录下的子文件夹和素材列表。
 * 支持分页（offset/limit参数）。
 *
 * @param args - 工具参数
 * @param args.filePath - 前端虚拟目录路径，如 '/视频/'
 * @param args.offset - 从第几个条目开始显示（1-indexed，默认为1）
 * @param args.limit - 最多显示的条目数（默认为2000）
 * @returns XML 格式的目录内容
 */
export async function executeListContents(args: Record<string, any>): Promise<string> {
    const { filePath, offset = 1, limit = 2000 } = args

    try {
      // 1. 解析 ID 路径，获取对应的目录ID
      const dirId = resolveIdPathToDirId(filePath)

      if (!dirId) {
        return logListContentsResult(filePath, offset, limit, `File not found: ${filePath}`)
      }

      // 2. 从素材库获取目录的直接子项（非递归）
      const entries = getDirectoryEntries(dirId)

      // 3. 字母排序
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

      // 4. 分页验证
      const totalEntries = entries.length
      if (offset > totalEntries) {
        return logListContentsResult(
          filePath,
          offset,
          limit,
          `Offset ${offset} is out of range for this directory (${totalEntries} entries)`,
        )
      }

      // 5. 应用分页
      const startIdx = offset - 1 // 转换为 0-indexed
      const endIdx = Math.min(startIdx + limit, totalEntries)
      const pagedEntries = entries.slice(startIdx, endIdx)

      // 6. 构建条目列表（XML 格式，避免 AI 误解 ID 格式）
      const entryLines: string[] = []
      for (const entry of pagedEntries) {
        if (entry.type === 'directory') {
          entryLines.push(formatDirectoryEntry(entry))
        } else {
          entryLines.push(formatMediaEntry(entry))
        }
      }

      // 7. 构建 XML 格式输出
      const pathName = buildPathName(dirId) // 从 ID 路径构建名称路径
      const outputLines: string[] = [
        `<path>${filePath}</path>`,
        `<path_name>${pathName}</path_name>`,
        `<entries>`,
        ...entryLines,
        `</entries>`
      ]

      // 8. 添加分页提示
      const hasMore = endIdx < totalEntries
      if (hasMore) {
        outputLines.push(
          `(Showing ${pagedEntries.length} of ${totalEntries} entries. ` +
          `Use 'offset' parameter to read beyond entry ${endIdx})`
        )
      } else {
        outputLines.push(`(${totalEntries} entries)`)
      }

      return logListContentsResult(filePath, offset, limit, outputLines.join('\n'))
    } catch (error: any) {
      return logListContentsResult(
        filePath,
        offset,
        limit,
        `Error reading directory: ${error.message}`,
      )
    }
  }

/**
 * list_contents 工具定义
 * 供 index.ts 注册使用（只需要 name 和 execute，其他字段由后端定义）
 */
export const listContentsTool: ToolDefinition = {
  name: 'list_contents',
  execute: executeListContents
} as ToolDefinition
