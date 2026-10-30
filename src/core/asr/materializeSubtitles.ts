import { RENDERER_FPS } from '@/core/mediabunny/constant'
import { TimelineItemMutations } from '@/core/timelineitem/mutations'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import { splitAsrSegments } from './subtitleSplitter'
import type { AsrPlaceholderPayload, MediaAsrResult } from './types'

export interface MaterializeAsrSubtitlesOptions {
  placeholderId: string
  result: MediaAsrResult
  getTimelineItem(id: string): UnifiedTimelineItemData | undefined
  getTimelineItems(): UnifiedTimelineItemData[]
  removeTimelineItem(id: string): Promise<void>
  addTimelineItem(item: UnifiedTimelineItemData): Promise<void>
}

function getPayload(item: UnifiedTimelineItemData): AsrPlaceholderPayload | null {
  if (item.timelinePlaceholder?.kind !== 'asr') return null
  const payload = item.timelinePlaceholder.payload
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<AsrPlaceholderPayload>
  if (
    typeof candidate.sourceMediaId !== 'string' ||
    typeof candidate.sourceTimelineItemId !== 'string' ||
    !candidate.requestedRange
  ) {
    return null
  }
  return candidate as AsrPlaceholderPayload
}

/** 将素材级 ASR 结果投影为字幕时间轴项目。 */
export async function materializeAsrSubtitles(
  options: MaterializeAsrSubtitlesOptions,
): Promise<string[]> {
  const placeholder = options.getTimelineItem(options.placeholderId)
  if (!placeholder) return []
  const payload = getPayload(placeholder)
  if (!payload) throw new Error('字幕占位符数据无效')

  const source = options.getTimelineItem(payload.sourceTimelineItemId)
  if (!source) throw new Error('找不到用于生成字幕的原始时间轴片段')

  const generated = options
    .getTimelineItems()
    .filter((item) => item.provenance?.generatedBy?.id === options.placeholderId)
  for (const item of generated) await options.removeTimelineItem(item.id)
  await options.removeTimelineItem(options.placeholderId)

  const generatedIds: string[] = []
  for (const segment of splitAsrSegments(options.result.segments)) {
    const startFrame =
      source.timeRange.timelineStartTime +
      Math.round(((segment.start_ms - payload.requestedRange.start_ms) / 1000) * RENDERER_FPS)
    const durationFrames = Math.max(
      1,
      Math.round(((segment.end_ms - segment.start_ms) / 1000) * RENDERER_FPS),
    )
    const item = await createTextTimelineItem(
      segment.text,
      {},
      startFrame,
      placeholder.trackId,
      durationFrames,
    )
    item.provenance = { generatedBy: { type: 'timeline-placeholder', id: options.placeholderId } }
    await setupTimelineItemBunny(item)
    if (item.runtime.textBitmap) {
      TimelineItemMutations.patchBaseVisualConfig(item, {
        width: item.runtime.textBitmap.width,
        height: item.runtime.textBitmap.height,
      })
    }
    await options.addTimelineItem(item)
    generatedIds.push(item.id)
  }
  return generatedIds
}
