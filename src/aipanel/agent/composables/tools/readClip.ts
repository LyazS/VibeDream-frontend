/**
 * read_clip 工具实现
 * 读取时间轴片段详细属性信息
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { MediaItemQueries } from '@/core/mediaitem/queries'
import type { ToolDefinition } from '../core/toolTypes'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { buildXmlAttributes, escapeXmlText } from './utils/xml'

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
 * read_clip 工具执行函数
 *
 * 批量获取多个时间轴片段的详细属性信息。
 *
 * @param args - 工具参数
 * @param args.ids - 时间轴片段ID数组（1-10个）
 * @returns XML 格式的时间轴片段详细信息
 */
export async function executeReadClip(args: Record<string, any>): Promise<string> {
  const { ids } = args

  // 1. 参数验证
  if (!Array.isArray(ids) || ids.length === 0) {
    return '<error>ids must be a non-empty array</error>'
  }

  if (ids.length > 10) {
    return '<error>Maximum 10 clip IDs per request</error>'
  }

  try {
    const store = useUnifiedStore()
    const clipNodes: string[] = []
    let foundCount = 0

    // 2. 遍历处理每个ID
    for (const id of ids) {
      const item = store.getTimelineItem(id)

      if (!item) {
        clipNodes.push(buildMissingClipNode(id))
        continue
      }

      // 获取关联的 mediaItem 和原始属性
      const mediaItem = item.mediaItemId ? store.getMediaItem(item.mediaItemId) : null
      const originalInfo = extractOriginalInfo(mediaItem, item)

      foundCount += 1
      clipNodes.push(buildClipNode(item, originalInfo))
    }

    const missingCount = ids.length - foundCount
    const lines = [
      `<read_clip ${buildXmlAttributes([
        ['returned', foundCount],
        ['missing', missingCount > 0 ? missingCount : undefined],
      ])}>`,
    ]

    for (const clipNode of clipNodes) {
      lines.push(...clipNode.split('\n').map((line) => `  ${line}`))
    }

    lines.push('</read_clip>')
    return lines.join('\n')
  } catch (error: any) {
    return `<error>${escapeXmlText(error.message)}</error>`
  }
}

/**
 * 构建单个时间轴片段 XML
 */
function buildClipNode(item: UnifiedTimelineItemData, originalInfo: OriginalInfo): string {
  const lines: string[] = []
  const resolvedRenderConfig = TimelineItemQueries.getResolvedRenderConfig(item)
  const resolvedTransition = TimelineItemQueries.getResolvedTransition(item)
  const resolvedFilter = TimelineItemQueries.getResolvedFilter(item)
  const resolvedMask = TimelineItemQueries.getResolvedMask(item)

  lines.push(
    `<clip ${buildXmlAttributes([
      ['id', item.id],
      ['media_id', item.mediaItemId || undefined],
      ['track_id', item.trackId || undefined],
      ['type', item.mediaType],
      ['status', item.timelineStatus],
    ])}>`,
  )

  const timelineTimeRange: TimeRangeInfo = {
    start: framesToTimecode(item.timeRange.timelineStartTime),
    end: framesToTimecode(item.timeRange.timelineEndTime),
  }
  const sourceTimeRange = item.mediaType === 'video' || item.mediaType === 'audio'
    ? {
        start: framesToTimecode(item.timeRange.clipStartTime),
        end: framesToTimecode(item.timeRange.clipEndTime),
      }
    : null
  lines.push(
    `  <time_range ${buildXmlAttributes([
      ['start', timelineTimeRange.start],
      ['end', timelineTimeRange.end],
      ['clip_start', sourceTimeRange?.start],
      ['clip_end', sourceTimeRange?.end],
    ])} />`,
  )

  if (Object.keys(originalInfo).length > 0) {
    lines.push(
      `  <original ${buildXmlAttributes([
        ['width', originalInfo.width],
        ['height', originalInfo.height],
        ['duration', originalInfo.duration !== undefined ? framesToTimecode(originalInfo.duration) : undefined],
      ])} />`,
    )
  }

  lines.push(...buildBaseRenderConfigNodes(resolvedRenderConfig).map((line) => `  ${line}`))
  lines.push(
    ...buildExtraRenderConfigNodes({
      transition: resolvedTransition,
      filter: resolvedFilter,
      mask: resolvedMask,
    }).map((line) => `  ${line}`),
  )

  lines.push(`</clip>`)
  return lines.join('\n')
}

function buildMissingClipNode(id: string): string {
  return `<clip ${buildXmlAttributes([
    ['id', id],
    ['status', 'not_found'],
  ])}>
  <error>未找到该时间轴片段。请使用 read_track 查看正确的时间轴片段 ID。</error>
</clip>`
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

function buildBaseRenderConfigNodes(config: Record<string, any>): string[] {
  const lines: string[] = []

  if (config.visual) {
    lines.push(
      `<visual ${buildXmlAttributes([
        ['x', config.visual.x],
        ['y', config.visual.y],
        ['width', config.visual.width],
        ['height', config.visual.height],
        ['rotation', config.visual.rotation],
        ['opacity', config.visual.opacity],
        ['blend_mode', config.visual.blendMode],
        ['proportional_scale', config.visual.proportionalScale],
      ])} />`,
    )
  }

  if (config.audio) {
    lines.push(
      `<audio ${buildXmlAttributes([
        ['volume', config.audio.volume],
        ['is_muted', config.audio.isMuted],
      ])} />`,
    )
  }

  if (config.text) {
    lines.push(
      `<text ${buildXmlAttributes([
        ['font_family', config.text.style?.fontFamily],
        ['font_size', config.text.style?.fontSize],
        ['color', config.text.style?.color],
      ])}>${escapeXmlText(String(config.text.text ?? ''))}</text>`,
    )
  }

  return lines
}

function buildExtraRenderConfigNodes(config: Record<string, any>): string[] {
  const lines: string[] = []

  if (config.filter) {
    lines.push(
      `<filter ${buildXmlAttributes([
        ['effect_package_id', config.filter.effectPackageId],
        ['template_id', config.filter.templateId],
        ['package_version', config.filter.packageVersion],
        ['catalog_version', config.filter.catalogVersion],
      ])}>`,
    )
    lines.push(`  <intensity ${buildXmlAttributes([['value', config.filter.intensity]])} />`)
    lines.push(...buildParamsNodes(config.filter.params).map((line) => `  ${line}`))
    lines.push(`</filter>`)
  }

  if (config.transition) {
    lines.push(
      `<transition ${buildXmlAttributes([
        ['effect_package_id', config.transition.effectPackageId],
        ['template_id', config.transition.templateId],
        ['package_version', config.transition.packageVersion],
        ['catalog_version', config.transition.catalogVersion],
        ['duration_frames', config.transition.durationFrames],
      ])}>`,
    )
    lines.push(...buildParamsNodes(config.transition.params).map((line) => `  ${line}`))
    lines.push(`</transition>`)
  }

  if (config.mask) {
    lines.push(
      `<mask ${buildXmlAttributes([
        ['enabled', config.mask.enabled],
        ['type', config.mask.type],
        ['inverted', config.mask.inverted],
        ['center_x', config.mask.centerX],
        ['center_y', config.mask.centerY],
        ['rotation', config.mask.rotation],
      ])}>`,
    )
    if (config.mask.falloff) {
      lines.push(
        `  <falloff ${buildXmlAttributes([
          ['outer_range', config.mask.falloff.outerRange],
          ['decay_rate', config.mask.falloff.decayRate],
        ])} />`,
      )
    }
    if (config.mask.type === 'rectangle') {
      lines.push(
        `  <shape ${buildXmlAttributes([
          ['width', config.mask.width],
          ['height', config.mask.height],
          ['corner_radius', config.mask.cornerRadius],
        ])} />`,
      )
    } else if (config.mask.type === 'ellipse') {
      lines.push(
        `  <shape ${buildXmlAttributes([
          ['ellipse_width', config.mask.ellipseWidth],
          ['ellipse_height', config.mask.ellipseHeight],
        ])} />`,
      )
    } else if (config.mask.type === 'mirror') {
      lines.push(`  <shape ${buildXmlAttributes([['length', config.mask.length]])} />`)
    }
    lines.push(`</mask>`)
  }

  return lines
}

function buildParamsNodes(params: unknown): string[] {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return []
  }

  return Object.entries(params).map(([key, value]) => {
    const tagName = key
    return `<${tagName} ${buildXmlAttributes([['value', serializeValue(value)]])} />`
  })
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}


/**
 * read_clip 工具定义
 * 供 index.ts 注册使用
 */
export const readClipTool: ToolDefinition = {
  name: 'read_clip',
  execute: executeReadClip
} as ToolDefinition
