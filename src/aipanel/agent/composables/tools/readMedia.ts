/**
 * read_media 工具实现
 * 获取素材详情，包括AI生成的描述
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { BizyairFileUploader } from '@/core/utils/bizyairFileUploader'
import { fetchClient } from '@/utils/fetchClient'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'

// ==================== AI 分析工具函数 ====================

/**
 * 上传素材到 BizyAir 用于分析
 *
 * @param mediaItem - 媒体素材
 * @param getMediaItem - 获取媒体素材的函数
 * @param getTimelineItem - 获取时间轴项目的函数
 * @returns 上传结果，包含 success、url 和 error 字段
 */
async function uploadMediaForAnalysis(
  mediaItem: UnifiedMediaItemData,
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
  getTimelineItem: (id: string) => any
): Promise<{
  success: boolean
  url?: string
  error?: string
}> {
  try {
    // 确保媒体类型是视频或图片
    if (mediaItem.mediaType !== 'video' && mediaItem.mediaType !== 'image') {
      throw new Error('只支持视频和图片类型的素材分析')
    }

    // 构建文件数据
    const fileData: FileData = {
      name: mediaItem.name,
      mediaItemId: mediaItem.id,
      source: 'media-item',
      mediaType: mediaItem.mediaType as 'video' | 'image',
      __type__: 'FileData',
    }

    // 使用 BizyAir 上传器
    const result = await BizyairFileUploader.uploadFile(
      fileData,
      getMediaItem,
      getTimelineItem,
      undefined // 无需进度回调
    )

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '上传失败',
    }
  }
}

/**
 * 调用后端 API 分析媒体内容
 *
 * @param url - 媒体文件 URL
 * @param mediaType - 媒体类型（video 或 image）
 * @returns 分析结果，包含 success、description 和 error 字段
 */
async function analyzeMediaContent(
  url: string,
  mediaType: 'video' | 'image'
): Promise<{
  success: boolean
  description?: string
  error?: string
}> {
  try {
    const response = await fetchClient.post<{
      success: boolean
      description?: string
      error?: string
    }>('/api/media/analyze', {
      url,
      media_type: mediaType,
    })

    return response.data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '分析请求失败',
    }
  }
}

// ==================== read_media 工具 ====================

// ==================== 类型定义 ====================

interface MediaDetail {
  id: string
  name: string
  mediaType: 'video' | 'image' | 'audio'
  duration?: string  // HH:MM:SS.FF 格式
  description: string
  descriptionStatus: 'ready' | 'generating' | 'error'
}

// ==================== 主执行函数 ====================

/**
 * read_media 工具执行函数
 *
 * 获取指定素材的详细信息，包括 AI 生成的描述。
 * 如果描述不存在，会自动触发 AI 生成流程并等待完成。
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
    let mediaItem = unifiedStore.getMediaItem(mediaId)

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
          descriptionStatus: 'error'
        })
        continue
      }

      // 确实找不到
      results.push({
        id: mediaId,
        name: 'Unknown',
        mediaType: 'video',
        description: `未找到 ID "${mediaId}" 的素材。请使用 list_contents 查看正确的素材 ID。`,
        descriptionStatus: 'error'
      })
      continue
    }

    // 3. 检查已有描述
    if (mediaItem.metadata?.aiDescription) {
      results.push(formatMediaDetail(mediaItem, 'ready'))
      continue
    }

    // 4. 根据类型处理
    if (mediaItem.mediaType === 'video' || mediaItem.mediaType === 'image') {
      // 触发 AI 生成（使用提取的工具函数）
      const result = await generateAIDescription(mediaItem, unifiedStore)
      results.push(result)
    } else if (mediaItem.mediaType === 'audio') {
      // 音频特殊处理
      results.push({
        ...formatMediaDetail(mediaItem, 'ready'),
        description: '[音频素材暂不支持 AI 描述]'
      })
    } else {
      // 其他类型
      results.push(formatMediaDetail(mediaItem, 'ready'))
    }
  }

  // 5. 格式化输出
  return formatResults(results)
}

// ==================== AI 生成函数 ====================

/**
 * 生成 AI 描述
 * 使用提取的工具函数进行上传和分析
 */
async function generateAIDescription(
  mediaItem: UnifiedMediaItemData,
  unifiedStore: ReturnType<typeof useUnifiedStore>
): Promise<MediaDetail> {
  try {
    // 0. 检查并等待媒体就绪（如果处于 pending 状态）
    if (mediaItem.mediaStatus === 'pending') {
      console.log(`[read_media] 媒体 ${mediaItem.name} 处于 pending 状态，启动处理流程`)

      // 启动媒体处理
      unifiedStore.startMediaProcessing(mediaItem)

      // 等待媒体就绪
      try {
        await unifiedStore.waitForMediaItemReady(mediaItem.id)
        console.log(`[read_media] 媒体 ${mediaItem.name} 已就绪`)
      } catch (error) {
        throw new Error(`媒体处理失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 1. 上传到 BizyAir（使用提取的工具函数）
    const uploadResult = await uploadMediaForAnalysis(
      mediaItem,
      unifiedStore.getMediaItem,
      unifiedStore.getTimelineItem
    )

    if (!uploadResult.success) {
      throw new Error(uploadResult.error || 'Upload failed')
    }

    // 2. 调用分析 API（使用提取的工具函数）
    const analysisResult = await analyzeMediaContent(
      uploadResult.url!,
      mediaItem.mediaType as 'video' | 'image'
    )

    if (!analysisResult.success) {
      throw new Error(analysisResult.error || 'Analysis failed')
    }

    // 3. 保存描述到元数据
    unifiedStore.updateMediaItemMetadata(mediaItem.id, {
      aiDescription: analysisResult.description,
    })

    // 4. 返回成功结果
    return {
      id: mediaItem.id,
      name: mediaItem.name,
      mediaType: mediaItem.mediaType as 'video' | 'image',
      duration: formatDuration(mediaItem.duration),
      description: analysisResult.description || '',
      descriptionStatus: 'ready',
    }
  } catch (error) {
    // 5. 错误处理
    console.error(`AI generation failed for ${mediaItem.id}:`, error)
    return {
      id: mediaItem.id,
      name: mediaItem.name,
      mediaType: mediaItem.mediaType as 'video' | 'image',
      duration: formatDuration(mediaItem.duration),
      description: '',
      descriptionStatus: 'error',
    }
  }
}

// ==================== 辅助函数 ====================

/**
 * 格式化媒体详情
 */
function formatMediaDetail(
  mediaItem: UnifiedMediaItemData,
  status: 'ready' | 'generating' | 'error'
): MediaDetail {
  return {
    id: mediaItem.id,
    name: mediaItem.name,
    mediaType: mediaItem.mediaType as 'video' | 'image' | 'audio',
    duration: formatDuration(mediaItem.duration),
    description: mediaItem.metadata?.aiDescription || '',
    descriptionStatus: status,
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
 */
function formatResults(details: MediaDetail[]): string {
  const lines: string[] = []

  lines.push(`=== 素材详情 (${details.length}个) ===`)
  lines.push('')

  for (const detail of details) {
    lines.push(`[ID: ${detail.id}] ${detail.name}`)
    lines.push(`  类型: ${detail.mediaType}`)

    if (detail.duration) {
      lines.push(`  时长: ${detail.duration}`)
    }

    lines.push(`  描述状态: ${detail.descriptionStatus}`)

    if (detail.description) {
      lines.push(`  描述: ${detail.description}`)
    } else if (detail.descriptionStatus === 'error') {
      lines.push(`  描述: AI 描述生成失败。提示：请再次调用 read_media 重新尝试。`)
    }

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
