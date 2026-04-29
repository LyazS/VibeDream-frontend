/**
 * read_media 工具实现
 * 获取素材详情，包括视觉摘要
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { mediaVisualSummaryService } from '@/core/mediaitem'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

// ==================== read_media 工具 ====================

// ==================== 类型定义 ====================

interface MediaDetail {
  id: string
  name: string
  mediaType: 'video' | 'image' | 'audio'
  duration?: string // HH:MM:SS+FF 格式
  title?: string
  description: string
}

// ==================== 主执行函数 ====================

/**
 * read_media 工具执行函数
 *
 * 获取指定素材的详细信息，包括视觉摘要。
 * 如果摘要不存在，会自动触发视觉摘要生成流程并等待完成。
 *
 * @param args - 工具参数
 * @param args.mediaIds - 素材ID数组（1-10个）
 * @returns 格式化的素材详情文本
 */
export async function executeReadMedia(args: Record<string, any>): Promise<string> {
  const { mediaIds } = args

  // 1. 参数验证
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    return 'Error: mediaIds must be a non-empty array'
  }

  if (mediaIds.length > 10) {
    return 'Error: Maximum 10 media IDs per request'
  }

  const unifiedStore = useUnifiedStore()
  const results: MediaDetail[] = []

  // 2. 遍历处理每个素材
  for (const mediaId of mediaIds) {
    const mediaItem = unifiedStore.getMediaItem(mediaId)

    if (!mediaItem) {
      // 素材不存在，尝试模糊匹配
      const allMediaItems = unifiedStore.mediaItems || []
      let suggestedItem: UnifiedMediaItemData | null = null

      // 查找可能的匹配项
      for (const item of allMediaItems) {
        // 情况1：用户传入了不含扩展名的ID，实际ID包含扩展名
        if (item.id.startsWith(mediaId)) {
          suggestedItem = item
          break
        }
        // 情况2：用户传入了含扩展名的ID，但实际ID不含扩展名
        if (mediaId.startsWith(item.id)) {
          suggestedItem = item
          break
        }
      }

      if (suggestedItem) {
        // 找到相似的素材，返回提示信息
        results.push({
          id: mediaId,
          name: suggestedItem.name,
          mediaType: suggestedItem.mediaType as 'video' | 'image' | 'audio',
          duration: formatDuration(suggestedItem.duration),
          description: `⚠️ 未找到 ID "${mediaId}" 的素材。你是不是要寻找 ID "${suggestedItem.id}"？请使用完整的 ID 重试。`,
        })
        continue
      }

      // 确实找不到
      results.push({
        id: mediaId,
        name: 'Unknown',
        mediaType: 'video',
        description: `未找到 ID "${mediaId}" 的素材。请使用 list_contents 查看正确的素材 ID。`,
      })
      continue
    }

    // 3. 检查已有完整视觉元数据
    if (mediaItem.metadata?.visual?.title?.trim() && mediaItem.metadata.visual.summary?.trim()) {
      results.push(formatMediaDetail(mediaItem))
      continue
    }

    // 4. 根据类型处理
    if (mediaItem.mediaType === 'video' || mediaItem.mediaType === 'image') {
      // 触发视觉摘要生成
      const result = await generateVisualSummary(mediaItem)
      results.push(result)
    } else if (mediaItem.mediaType === 'audio') {
      // 音频特殊处理
      results.push({
        ...formatMediaDetail(mediaItem),
        description: '[音频素材暂不支持视觉摘要]',
      })
    } else {
      // 其他类型
      results.push(formatMediaDetail(mediaItem))
    }
  }

  // 5. 格式化输出
  return formatResults(results)
}

// ==================== 视觉摘要生成函数 ====================

/**
 * 生成视觉摘要
 */
async function generateVisualSummary(mediaItem: UnifiedMediaItemData): Promise<MediaDetail> {
  try {
    const result = await mediaVisualSummaryService.summarizeMediaVisual(mediaItem)

    if (!result.success) {
      throw new Error(result.error || 'Visual summary failed')
    }

    return {
      id: mediaItem.id,
      name: mediaItem.name,
      mediaType: mediaItem.mediaType as 'video' | 'image',
      duration: formatDuration(mediaItem.duration),
      title: result.visual?.title || '',
      description: result.visual?.summary || '',
    }
  } catch (error) {
    console.error(`Visual summary generation failed for ${mediaItem.id}:`, error)
    return {
      id: mediaItem.id,
      name: mediaItem.name,
      mediaType: mediaItem.mediaType as 'video' | 'image',
      duration: formatDuration(mediaItem.duration),
      description: '',
    }
  }
}

// ==================== 辅助函数 ====================

/**
 * 格式化媒体详情
 */
function formatMediaDetail(mediaItem: UnifiedMediaItemData): MediaDetail {
  return {
    id: mediaItem.id,
    name: mediaItem.name,
    mediaType: mediaItem.mediaType as 'video' | 'image' | 'audio',
    duration: formatDuration(mediaItem.duration),
    title: mediaItem.metadata?.visual?.title?.trim() || '',
    description: mediaItem.metadata?.visual?.summary?.trim() || '',
  }
}

/**
 * 格式化时长（帧数 -> 时间码）
 */
function formatDuration(duration?: number): string | undefined {
  if (duration === undefined || duration === null) {
    return undefined
  }
  return framesToTimecode(duration)
}

/**
 * 格式化结果输出
 * 按"成功读取"和"读取失败"分组显示
 */
function formatResults(details: MediaDetail[]): string {
  const lines: string[] = []

  // 分组：成功读取 vs 读取失败
  const successGroup: MediaDetail[] = []
  const failedGroup: MediaDetail[] = []

  for (const detail of details) {
    // 判断是否成功读取description
    if (
      detail.description
      && !detail.description.startsWith('⚠️')
      && !detail.description.startsWith('[音频素材')
    ) {
      successGroup.push(detail)
    } else {
      failedGroup.push(detail)
    }
  }

  // 输出成功读取的分组
  if (successGroup.length > 0) {
    lines.push('=== ✅ 读取成功的素材 ===')
    lines.push('')

    for (const detail of successGroup) {
      lines.push(`[ID: ${detail.id}] ${detail.name}`)
      lines.push(`  类型: '${detail.mediaType}'`)

      if (detail.duration) {
        lines.push(`  时长: '${detail.duration}'`)
      }

      if (detail.title) {
        lines.push(`  标题: ${detail.title}`)
      }

      lines.push(`  描述: ${detail.description}`)
      lines.push('')
    }
  }

  // 输出读取失败的分组
  if (failedGroup.length > 0) {
    lines.push('=== ❌ 读取失败的素材 ===')
    lines.push('')

    for (const detail of failedGroup) {
      lines.push(`[ID: ${detail.id}] ${detail.name}`)
      lines.push(`  类型: '${detail.mediaType}'`)

      if (detail.duration) {
        lines.push(`  时长: '${detail.duration}'`)
      }

      lines.push('')
    }

    // 在失败分组末尾添加提示信息
    lines.push('（对于读取失败的素材，请再次调用 read_media 重新尝试读取该素材）')
    lines.push('')
  }

  // 如果全部为空
  if (successGroup.length === 0 && failedGroup.length === 0) {
    lines.push('=== 素材详情 (0个) ===')
    lines.push('')
  }

  return lines.join('\n')
}

// ==================== 工具定义导出 ====================

/**
 * 工具定义 - 供注册使用
 */
export const readMediaTool: ToolDefinition = {
  name: 'read_media',
  execute: executeReadMedia
} as ToolDefinition
