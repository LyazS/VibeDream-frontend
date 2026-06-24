/**
 * read_clip 工具实现
 * 读取时间轴片段详细属性信息
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { buildToolError, buildToolSuccess } from './utils/result'

/**
 * read_clip 工具执行函数
 *
 * 批量获取多个时间轴片段的详细属性信息。
 *
 * @param args - 工具参数
 * @param args.ids - 时间轴片段ID数组（1-10个）
 * @returns JSON 格式的时间轴片段详细信息
 */
export async function executeReadClip(args: Record<string, any>) {
  const { ids } = args

  if (!Array.isArray(ids) || ids.length === 0) {
    return buildToolError('read_clip', 'invalid_arguments', 'ids must be a non-empty array')
  }

  if (ids.length > 10) {
    return buildToolError('read_clip', 'invalid_arguments', 'Maximum 10 clip IDs per request', {
      maxItems: 10,
    })
  }

  try {
    const store = useUnifiedStore()
    const clips: Array<Record<string, any>> = []

    for (const id of ids) {
      const item = store.getTimelineItem(id)

      if (!item) {
        clips.push(buildMissingClipNode(id))
        continue
      }

      clips.push(buildClipNode(item))
    }
    const foundCount = clips.filter((clip) => clip.status === 'found').length
    return buildToolSuccess(
      'read_clip',
      {
        clips,
      },
      `已读取 ${foundCount} 个时间轴片段。`,
    )
  } catch (error: any) {
    return buildToolError(
      'read_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function buildClipNode(item: UnifiedTimelineItemData): Record<string, any> {
  const resolvedRenderConfig = TimelineItemQueries.getResolvedRenderConfig(item)
  const resolvedTransition = TimelineItemQueries.getResolvedTransition(item)
  const resolvedFilter = TimelineItemQueries.getResolvedFilter(item)
  const resolvedMask = TimelineItemQueries.getResolvedMask(item)
  const timelineTimeRange = {
    start: framesToTimecode(item.timeRange.timelineStartTime),
    end: framesToTimecode(item.timeRange.timelineEndTime),
    duration: framesToTimecode(item.timeRange.timelineEndTime - item.timeRange.timelineStartTime),
  }
  const sourceTimeRange = item.mediaType === 'video' || item.mediaType === 'audio'
    ? {
        mediaId: item.mediaItemId || undefined,
        start: framesToTimecode(item.timeRange.clipStartTime),
        end: framesToTimecode(item.timeRange.clipEndTime),
      }
    : null

  return {
    clipId: item.id,
    timelineStatus: item.timelineStatus,
    mediaType: item.mediaType,
    trackId: item.trackId || undefined,
    timeline: timelineTimeRange,
    source: sourceTimeRange || undefined,
    properties: {
      ...buildBaseRenderConfigObject(resolvedRenderConfig),
      ...buildExtraRenderConfigObject({
        transition: resolvedTransition,
        filter: resolvedFilter,
        mask: resolvedMask,
      }),
    },
  }
}

function buildMissingClipNode(id: string): Record<string, any> {
  return {
    clipId: id,
    error: {
      code: 'clip_not_found',
      message: '未找到该时间轴片段。请使用 read_track 查看正确的时间轴片段 ID。',
    },
  }
}

function buildBaseRenderConfigObject(config: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}

  if (config.visual) {
    result.visual = {
      x: config.visual.x,
      y: config.visual.y,
      width: config.visual.width,
      height: config.visual.height,
      rotation: config.visual.rotation,
      opacity: config.visual.opacity,
      blendMode: config.visual.blendMode,
      proportionalScale: config.visual.proportionalScale,
    }
  }

  if (config.audio) {
    result.audio = {
      volume: config.audio.volume,
      isMuted: config.audio.isMuted,
    }
  }

  if (config.text) {
    result.text = {
      text: String(config.text.text ?? ''),
      style: {
        fontFamily: config.text.style?.fontFamily,
        fontSize: config.text.style?.fontSize,
        color: config.text.style?.color,
      },
    }
  }

  return result
}

function buildExtraRenderConfigObject(config: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}

  if (config.filter) {
    result.filter = {
      effectPackageId: config.filter.effectPackageId,
      templateId: config.filter.templateId,
      packageVersion: config.filter.packageVersion,
      catalogVersion: config.filter.catalogVersion,
      intensity: config.filter.intensity,
      params: serializeParams(config.filter.params),
    }
  }

  if (config.transition) {
    result.transition = {
      effectPackageId: config.transition.effectPackageId,
      templateId: config.transition.templateId,
      packageVersion: config.transition.packageVersion,
      catalogVersion: config.transition.catalogVersion,
      durationFrames: config.transition.durationFrames,
      params: serializeParams(config.transition.params),
    }
  }

  if (config.mask) {
    result.mask = {
      enabled: config.mask.enabled,
      type: config.mask.type,
      inverted: config.mask.inverted,
      centerX: config.mask.centerX,
      centerY: config.mask.centerY,
      rotation: config.mask.rotation,
      falloff: config.mask.falloff
        ? {
            outerRange: config.mask.falloff.outerRange,
            decayRate: config.mask.falloff.decayRate,
          }
        : undefined,
      shape: buildMaskShape(config.mask),
    }
  }

  return result
}

function buildMaskShape(mask: Record<string, any>): Record<string, any> | undefined {
  if (mask.type === 'rectangle') {
    return {
      width: mask.width,
      height: mask.height,
      cornerRadius: mask.cornerRadius,
    }
  }

  if (mask.type === 'ellipse') {
    return {
      ellipseWidth: mask.ellipseWidth,
      ellipseHeight: mask.ellipseHeight,
    }
  }

  if (mask.type === 'mirror') {
    return {
      length: mask.length,
    }
  }

  return undefined
}

function serializeParams(params: unknown): Record<string, any> | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, serializeValue(value)]),
  )
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
