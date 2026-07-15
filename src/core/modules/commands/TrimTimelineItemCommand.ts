/**
 * NLE 语义的单边 Trim/Extend 命令。
 * Trim 会移动时间轴边界，并对音视频同步移动 source in/out 以保持当前倍速。
 */

import { cloneDeep } from 'lodash'
import { generateCommandId } from '@/core/utils/idGenerator'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type {
  AnimateKeyframe,
  AnimationGroupId,
  AnimationGroupTrack,
  GetAnimation,
} from '@/core/timelineitem/model/render'
import {
  interpolateKeyframeAtPosition,
  percentageToFrame,
} from '@/core/utils/keyframePositionUtils'

export type TrimTimelineItemSide = 'start' | 'end'

type TrimKeyframe = AnimateKeyframe<MediaType, AnimationGroupId>
type TrimChannelEntry = AnimationGroupTrack<MediaType, AnimationGroupId>
type TrimChannelMap = Partial<Record<AnimationGroupId, TrimChannelEntry>>
const interpolateTrimKeyframeAtPosition = interpolateKeyframeAtPosition as (
  keyframes: TrimKeyframe[],
  position: number,
  clipDuration: number,
) => TrimKeyframe | null

const MIN_DURATION_FRAMES = 1

function isSourceBackedMediaType(mediaType: MediaType): boolean {
  return mediaType === 'video' || mediaType === 'audio'
}

function getTimelineDuration(timeRange: UnifiedTimeRange): number {
  return timeRange.timelineEndTime - timeRange.timelineStartTime
}

function getSourceDuration(timeRange: UnifiedTimeRange): number {
  return timeRange.clipEndTime - timeRange.clipStartTime
}

function cloneAnimation(animation: GetAnimation<MediaType> | undefined): GetAnimation<MediaType> | undefined {
  return animation ? cloneDeep(animation) : undefined
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function remapKeyframeToWindow(
  keyframe: TrimKeyframe,
  keptStartRatio: number,
  keptSpan: number,
  nextDurationFrames: number,
): TrimKeyframe {
  const nextKeyframe = cloneDeep(keyframe)
  nextKeyframe.position = clampRatio((keyframe.position - keptStartRatio) / keptSpan)
  nextKeyframe.frame = percentageToFrame(nextKeyframe.position, nextDurationFrames)
  nextKeyframe.cachedFrame = nextKeyframe.frame
  nextKeyframe.properties = cloneDeep(nextKeyframe.value)
  return nextKeyframe
}

function sampleBoundaryKeyframe(
  keyframes: TrimKeyframe[],
  sourceRatio: number,
  originalDurationFrames: number,
  targetPosition: 0 | 1,
  nextDurationFrames: number,
): TrimKeyframe | null {
  const sampleRatio = clampRatio(sourceRatio)
  const exact = keyframes.find((keyframe) => keyframe.position === sampleRatio)
  const sampled = exact
    ? cloneDeep(exact)
    : interpolateTrimKeyframeAtPosition(keyframes, sampleRatio, originalDurationFrames)

  if (!sampled) {
    return null
  }

  sampled.position = targetPosition
  sampled.frame = percentageToFrame(targetPosition, nextDurationFrames)
  sampled.cachedFrame = sampled.frame
  sampled.properties = cloneDeep(sampled.value)
  return sampled
}

function rebuildChannelKeyframesForTrim(
  keyframes: TrimKeyframe[],
  keptStartRatio: number,
  keptEndRatio: number,
  originalDurationFrames: number,
  nextDurationFrames: number,
): TrimKeyframe[] {
  const keptSpan = keptEndRatio - keptStartRatio
  if (keptSpan <= 0) {
    return []
  }

  const result: TrimKeyframe[] = []
  const visibleStartRatio = Math.max(0, keptStartRatio)
  const visibleEndRatio = Math.min(1, keptEndRatio)

  for (const keyframe of keyframes) {
    if (keyframe.position < visibleStartRatio || keyframe.position > visibleEndRatio) {
      continue
    }
    result.push(remapKeyframeToWindow(keyframe, keptStartRatio, keptSpan, nextDurationFrames))
  }

  const startBoundary = sampleBoundaryKeyframe(
    keyframes,
    keptStartRatio,
    originalDurationFrames,
    0,
    nextDurationFrames,
  )
  if (startBoundary) {
    result.push(startBoundary)
  }

  const endBoundary = sampleBoundaryKeyframe(
    keyframes,
    keptEndRatio,
    originalDurationFrames,
    1,
    nextDurationFrames,
  )
  if (endBoundary) {
    result.push(endBoundary)
  }

  const deduped = new Map<number, TrimKeyframe>()
  for (const keyframe of result) {
    deduped.set(keyframe.frame, keyframe)
  }

  return Array.from(deduped.values()).sort((a, b) => a.position - b.position)
}

function rebuildAnimationForTrim(
  originalAnimation: GetAnimation<MediaType> | undefined,
  originalDurationFrames: number,
  keptStartRatio: number,
  keptEndRatio: number,
  nextDurationFrames: number,
): GetAnimation<MediaType> | undefined {
  if (!originalAnimation?.groups || Object.keys(originalAnimation.groups).length === 0) {
    return undefined
  }

  const nextChannels: TrimChannelMap = {}
  const originalChannels = originalAnimation.groups as Partial<
    Record<AnimationGroupId, TrimChannelEntry>
  >

  for (const [channel, channelConfig] of Object.entries(originalChannels) as Array<
    [AnimationGroupId, TrimChannelEntry]
  >) {
    const keyframes = rebuildChannelKeyframesForTrim(
      channelConfig.keyframes,
      keptStartRatio,
      keptEndRatio,
      originalDurationFrames,
      nextDurationFrames,
    )

    if (keyframes.length > 0) {
      nextChannels[channel] = {
        groupId: channel,
        strategyKey: channel,
        keyframes,
      }
    }
  }

  return Object.keys(nextChannels).length > 0
    ? ({ groups: nextChannels } as GetAnimation<MediaType>)
    : undefined
}

function calculateTrimTimeRange(params: {
  item: UnifiedTimelineItemData<MediaType>
  mediaItem?: UnifiedMediaItemData
  side: TrimTimelineItemSide
  targetBoundaryFrame: number
}): UnifiedTimeRange {
  const { item, mediaItem, side } = params
  const current = item.timeRange
  const timelineDuration = getTimelineDuration(current)
  const sourceDuration = getSourceDuration(current)
  const next: UnifiedTimeRange = { ...current }

  if (side === 'start') {
    const maxStart = current.timelineEndTime - MIN_DURATION_FRAMES
    let targetStart = Math.min(params.targetBoundaryFrame, maxStart)
    targetStart = Math.max(0, targetStart)

    if (isSourceBackedMediaType(item.mediaType) && timelineDuration > 0) {
      const playbackRate = sourceDuration / timelineDuration
      const minStartBySource = current.timelineStartTime - current.clipStartTime / playbackRate
      targetStart = Math.max(targetStart, Math.ceil(minStartBySource))
      const sourceDelta = Math.round((targetStart - current.timelineStartTime) * playbackRate)
      next.clipStartTime = current.clipStartTime + sourceDelta
    }

    next.timelineStartTime = targetStart
  } else {
    const minEnd = current.timelineStartTime + MIN_DURATION_FRAMES
    let targetEnd = Math.max(params.targetBoundaryFrame, minEnd)

    if (isSourceBackedMediaType(item.mediaType) && timelineDuration > 0) {
      const playbackRate = sourceDuration / timelineDuration
      const mediaDuration = mediaItem?.duration
      if (typeof mediaDuration === 'number' && Number.isFinite(mediaDuration)) {
        const maxEndBySource =
          current.timelineEndTime + (mediaDuration - current.clipEndTime) / playbackRate
        targetEnd = Math.min(targetEnd, Math.floor(maxEndBySource))
      }
      const sourceDelta = Math.round((targetEnd - current.timelineEndTime) * playbackRate)
      next.clipEndTime = current.clipEndTime + sourceDelta
    }

    next.timelineEndTime = targetEnd
  }

  if (isSourceBackedMediaType(item.mediaType)) {
    next.clipStartTime = Math.max(0, next.clipStartTime)
    if (typeof mediaItem?.duration === 'number' && Number.isFinite(mediaItem.duration)) {
      next.clipEndTime = Math.min(mediaItem.duration, next.clipEndTime)
    }
    if (next.clipStartTime >= next.clipEndTime) {
      if (side === 'start') {
        next.clipStartTime = Math.max(0, next.clipEndTime - MIN_DURATION_FRAMES)
      } else {
        const maxClipEnd =
          typeof mediaItem?.duration === 'number' && Number.isFinite(mediaItem.duration)
            ? mediaItem.duration
            : next.clipStartTime + MIN_DURATION_FRAMES
        next.clipEndTime = Math.min(maxClipEnd, next.clipStartTime + MIN_DURATION_FRAMES)
      }
    }
  }

  return next
}

/**
 * 导出纯计算函数，便于后续补充细粒度单测。
 */
export function calculateTrimTimelineItemTimeRange(params: {
  item: UnifiedTimelineItemData<MediaType>
  mediaItem?: UnifiedMediaItemData
  side: TrimTimelineItemSide
  targetBoundaryFrame: number
}): UnifiedTimeRange {
  return calculateTrimTimeRange(params)
}

export class TrimTimelineItemCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private originalTimeRange: UnifiedTimeRange
  private originalAnimation?: GetAnimation<MediaType>
  private newTimeRange: UnifiedTimeRange
  private nextAnimation?: GetAnimation<MediaType>
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    originalTimelineItem: UnifiedTimelineItemData<MediaType>,
    side: TrimTimelineItemSide,
    targetBoundaryFrame: number,
    private timelineModule: {
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
      setTimelineItemTimeRangeForCmd: (
        id: string,
        timeRange: Partial<UnifiedTimeRange>,
      ) => void
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ) {
    this.id = generateCommandId()
    this.originalTimeRange = { ...originalTimelineItem.timeRange }
    this.originalAnimation = cloneAnimation(originalTimelineItem.animation)

    const mediaItem = this.mediaModule.getMediaItem(originalTimelineItem.mediaItemId)
    this.newTimeRange = calculateTrimTimeRange({
      item: originalTimelineItem,
      mediaItem,
      side,
      targetBoundaryFrame,
    })

    const originalDuration = getTimelineDuration(this.originalTimeRange)
    const nextDuration = getTimelineDuration(this.newTimeRange)
    const keptStartRatio = originalDuration <= 0
      ? 0
      : (this.newTimeRange.timelineStartTime - this.originalTimeRange.timelineStartTime) / originalDuration
    const keptEndRatio = originalDuration <= 0
      ? 1
      : (this.newTimeRange.timelineEndTime - this.originalTimeRange.timelineStartTime) / originalDuration
    this.nextAnimation = rebuildAnimationForTrim(
      this.originalAnimation,
      originalDuration,
      keptStartRatio,
      keptEndRatio,
      nextDuration,
    )

    this.description = `Trim 时间轴项目: ${mediaItem?.name || '未知素材'} (${side === 'start' ? '开始' : '结束'} → ${framesToTimecode(side === 'start' ? this.newTimeRange.timelineStartTime : this.newTimeRange.timelineEndTime)})`
  }

  private applyState(timeRange: UnifiedTimeRange, animation?: GetAnimation<MediaType>): void {
    const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!timelineItem) {
      throw new Error(`找不到时间轴项目: ${this.timelineItemId}`)
    }

    this.timelineModule.setTimelineItemTimeRangeForCmd(this.timelineItemId, timeRange)
    timelineItem.animation = cloneAnimation(animation)
  }

  async execute(): Promise<void> {
    this.applyState(this.newTimeRange, this.nextAnimation)
  }

  async undo(): Promise<void> {
    this.applyState(this.originalTimeRange, this.originalAnimation)
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    this._isDisposed = true
  }
}
