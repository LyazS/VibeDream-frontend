/**
 * list_contents 工具实现
 * 列出前端虚拟目录内容（非递归）
 */

import { useUnifiedStore } from '@/core/unifiedStore'
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
  type: 'directory' | 'media'
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
    const mediaItemsArray = store.mediaItems || []
    const mediaItemsMap = new Map(mediaItemsArray.map((item: any) => [item.id, item]))

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

    // 添加媒体项
    for (const mediaId of dir.mediaItemIds) {
      const media = mediaItemsMap.get(mediaId)
      if (media) {
        entries.push({
          id: mediaId,
          name: media.name,
          type: 'media'
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
        return `File not found: ${filePath}`
      }

      // 2. 从素材库获取目录的直接子项（非递归）
      const entries = getDirectoryEntries(dirId)

      // 3. 字母排序
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

      // 4. 分页验证
      const totalEntries = entries.length
      if (offset > totalEntries) {
        return `Offset ${offset} is out of range for this directory (${totalEntries} entries)`
      }

      // 5. 应用分页
      const startIdx = offset - 1 // 转换为 0-indexed
      const endIdx = Math.min(startIdx + limit, totalEntries)
      const pagedEntries = entries.slice(startIdx, endIdx)

      // 6. 构建条目列表（带 ID 和类型标记）
      const entryLines: string[] = []
      for (const entry of pagedEntries) {
        if (entry.type === 'directory') {
          // 目录格式：[id:dir_xxx] 名称/
          entryLines.push(`[id:${entry.id}] ${entry.name}/`)
        } else {
          // 媒体格式：[id:media_xxx] 名称
          entryLines.push(`[id:${entry.id}] ${entry.name}`)
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

      return outputLines.join('\n')
    } catch (error: any) {
      return `Error reading directory: ${error.message}`
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
