/**
 * read_timelineitem 工具实现
 * 读取时间轴项目详细属性信息
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { MediaItemQueries } from '@/core/mediaitem/queries'
import type { ToolDefinition } from '../core/toolTypes'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { VisualProps, AudioProps, TextProps } from '@/core/timelineitem/bunnytype'

/**
 * 时间范围信息
 */
interface TimeRangeInfo {
  /** 开始时间（时间码格式） */
  start: string
  /** 结束时间（时间码格式） */
  end: string
}

/**
 * 原始属性
 */
interface OriginalInfo {
  /** 原始宽度（像素） */
  width?: number
  /** 原始高度（像素） */
  height?: number
  /** 原始时长（帧数） */
  duration?: number
}

/**
 * 变换属性
 */
interface TransformInfo {
  /** X位置（像素） */
  x?: number
  /** Y位置（像素） */
  y?: number
  /** 宽度（像素） */
  width?: number
  /** 高度（像素） */
  height?: number
  /** 旋转角度（度） */
  rotation?: number
  /** 不透明度（0-1） */
  opacity?: number
  /** 音量（0-1，音频轨道） */
  volume?: number
  /** 播放速度 */
  playbackRate?: number
}

/**
 * 文本内容信息
 */
interface TextContentInfo {
  /** 文本内容 */
  text: string
  /** 字体名称 */
  fontFamily?: string
  /** 字体大小 */
  fontSize?: number
  /** 文字颜色 */
  color?: string
}

/**
 * read_timelineitem 工具执行函数
 *
 * 批量获取多个时间轴项目的详细属性信息。
 *
 * @param args - 工具参数
 * @param args.ids - 时间轴项目ID数组（1-10个）
 * @returns 格式化的时间轴项目详细信息文本
 */
export async function executeReadTimelineitem(args: Record<string, any>): Promise<string> {
  const { ids } = args

  // 1. 参数验证
  if (!Array.isArray(ids) || ids.length === 0) {
    return 'Error: ids must be a non-empty array'
  }

  if (ids.length > 10) {
    return 'Error: Maximum 10 timeline item IDs per request'
  }

  try {
    const store = useUnifiedStore()
    const results: string[] = []

    // 2. 遍历处理每个ID
    for (const id of ids) {
      const item = store.getTimelineItem(id)

      if (!item) {
        // 未找到的时间轴项目
        results.push(`=== 时间轴项目详情 ===`)
        results.push(`ID: ${id}`)
        results.push(`状态: ❌ 未找到该时间轴项目`)
        results.push(`请使用 read_track 查看正确的时间轴项目 ID。`)
        results.push('')
        continue
      }

      // 获取关联的 mediaItem 和原始属性
      const mediaItem = item.mediaItemId ? store.getMediaItem(item.mediaItemId) : null
      const originalInfo = extractOriginalInfo(mediaItem, item)

      // 成功找到，使用格式化函数
      results.push(formatTimelineItemDetail(item, originalInfo))
    }

    // 3. 返回按顺序拼接的结果
    return results.join('\n\n---\n\n')
  } catch (error: any) {
    return `Error reading timeline items: ${error.message}`
  }
}

/**
 * 格式化单个时间轴项目详情
 */
function formatTimelineItemDetail(item: UnifiedTimelineItemData, originalInfo: OriginalInfo): string {
  const lines: string[] = []

  // 1. 基本信息
  lines.push(`=== 时间轴项目详情 ===`)
  lines.push(`ID: ${item.id}`)
  lines.push(`素材ID: ${item.mediaItemId || '(无)'}`)
  lines.push(`轨道ID: ${item.trackId || '(未分配)'}`)
  lines.push(`媒体类型: ${item.mediaType}`)
  lines.push(`状态: ${item.timelineStatus}`)

  // 2. 时间范围信息
  const timelineTimeRange: TimeRangeInfo = {
    start: framesToTimecode(item.timeRange.timelineStartTime),
    end: framesToTimecode(item.timeRange.timelineEndTime),
  }
  lines.push('')
  lines.push(`=== 时间范围（HH:MM:SS+FF格式） ===`)
  lines.push(`时间轴: '${timelineTimeRange.start}' - '${timelineTimeRange.end}'`)

  // 源时间范围（视频/音频/图片）
  if (item.mediaType === 'video' || item.mediaType === 'audio') {
    const sourceTimeRange: TimeRangeInfo = {
      start: framesToTimecode(item.timeRange.clipStartTime),
      end: framesToTimecode(item.timeRange.clipEndTime),
    }
    lines.push(`源素材: ${sourceTimeRange.start} - ${sourceTimeRange.end}`)
  }

  // 3. 原始属性
  if (Object.keys(originalInfo).length > 0) {
    lines.push('')
    lines.push(`=== 原始属性 ===`)
    if (originalInfo.width !== undefined) lines.push(`原始宽度: ${originalInfo.width}px`)
    if (originalInfo.height !== undefined) lines.push(`原始高度: ${originalInfo.height}px`)
    if (originalInfo.duration !== undefined) {
      // duration 是帧数，直接转换为时间码格式
      const durationTimecode = framesToTimecode(originalInfo.duration)
      lines.push(`原始时长: ${durationTimecode}`)
    }
  }

  // 4. 变换属性
  const baseRenderConfig = item.baseRenderConfig
  if (baseRenderConfig) {
    const transformInfo = extractTransformInfo({
      ...('visual' in baseRenderConfig ? baseRenderConfig.visual : {}),
      ...('audio' in baseRenderConfig ? baseRenderConfig.audio : {}),
    } as VisualProps & AudioProps)
    if (Object.keys(transformInfo).length > 0) {
      lines.push('')
      lines.push(`=== 变换属性 ===`)
      if (transformInfo.x !== undefined) lines.push(`X位置: ${transformInfo.x}px`)
      if (transformInfo.y !== undefined) lines.push(`Y位置: ${transformInfo.y}px`)
      if (transformInfo.width !== undefined) lines.push(`宽度: ${transformInfo.width}px`)
      if (transformInfo.height !== undefined) lines.push(`高度: ${transformInfo.height}px`)
      if (transformInfo.rotation !== undefined) lines.push(`旋转: ${transformInfo.rotation}°`)
      if (transformInfo.opacity !== undefined) lines.push(`不透明度: ${(transformInfo.opacity * 100).toFixed(0)}%`)
      if (transformInfo.volume !== undefined) lines.push(`音量: ${(transformInfo.volume * 100).toFixed(0)}%`)
      if (transformInfo.playbackRate !== undefined) lines.push(`播放速度: ${transformInfo.playbackRate}x`)
    }
  }

  // 4. 文本内容（文本类型）
  if (item.mediaType === 'text') {
    const textInfo = extractTextContentInfo(
      (item as UnifiedTimelineItemData<'text'>).baseRenderConfig.text,
    )
    if (textInfo) {
      lines.push('')
      lines.push(`=== 文本内容 ===`)
      lines.push(`文本: ${textInfo.text}`)
      if (textInfo.fontFamily) lines.push(`字体: ${textInfo.fontFamily}`)
      if (textInfo.fontSize) lines.push(`字号: ${textInfo.fontSize}`)
      if (textInfo.color) lines.push(`颜色: ${textInfo.color}`)
    }
  }

  return lines.join('\n')
}

/**
 * 从媒体项目和时间轴项目中提取原始属性
 */
function extractOriginalInfo(mediaItem: any, timelineItem: UnifiedTimelineItemData): OriginalInfo {
  const info: OriginalInfo = {}

  // 根据时间轴项目的媒体类型获取不同的原始属性
  switch (timelineItem.mediaType) {
    case 'video':
    case 'image':
      // 视频和图片：从 mediaItem 获取原始宽高
      if (!mediaItem) break
      const size = MediaItemQueries.getOriginalSize(mediaItem)
      if (size) {
        info.width = size.width
        info.height = size.height
      }
      // 只有视频有原始时长，图片没有
      if (timelineItem.mediaType === 'video' && mediaItem.duration !== undefined && mediaItem.duration > 0) {
        info.duration = mediaItem.duration
      }
      break

    case 'audio':
      // 音频：从 mediaItem 获取时长
      if (!mediaItem) break
      if (mediaItem.duration !== undefined && mediaItem.duration > 0) {
        info.duration = mediaItem.duration
      }
      break

    case 'text':
      // 文本类型：从 timelineItem.runtime.textBitmap 获取原始宽高
      if (timelineItem.runtime?.textBitmap) {
        info.width = timelineItem.runtime.textBitmap.width
        info.height = timelineItem.runtime.textBitmap.height
      }
      break

    default:
      // 未知类型或其他
      break
  }

  return info
}

/**
 * 从配置中提取变换属性
 */
function extractTransformInfo(config: VisualProps | AudioProps | TextProps): TransformInfo {
  const info: TransformInfo = {}

  // VisualProps 相关属性
  if ('x' in config && config.x !== undefined) {
    info.x = config.x
  }
  if ('y' in config && config.y !== undefined) {
    info.y = config.y
  }
  if ('width' in config && config.width !== undefined) {
    info.width = config.width
  }
  if ('height' in config && config.height !== undefined) {
    info.height = config.height
  }
  if ('rotation' in config && config.rotation !== undefined) {
    // 存储和 Agent 都是角度，直接使用
    info.rotation = config.rotation
  }
  if ('opacity' in config && config.opacity !== undefined) {
    info.opacity = config.opacity
  }

  // AudioProps 相关属性
  if ('volume' in config && config.volume !== undefined) {
    info.volume = config.volume
  }

  return info
}

/**
 * 从配置中提取文本内容信息
 */
function extractTextContentInfo(config: TextProps): TextContentInfo | null {
  if ('text' in config && typeof config.text === 'string') {
    return {
      text: config.text,
      fontFamily: config.style.fontFamily,
      fontSize: config.style.fontSize,
      color: config.style.color,
    }
  }
  return null
}

/**
 * read_timelineitem 工具定义
 * 供 index.ts 注册使用
 */
export const readTimelineitemTool: ToolDefinition = {
  name: 'read_timelineitem',
  execute: executeReadTimelineitem
} as ToolDefinition
