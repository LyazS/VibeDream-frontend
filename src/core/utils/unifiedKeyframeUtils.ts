import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import {
  getAnimationGroupForProperty,
  normalizeAnimationGroupId,
  type AnimateKeyframe,
  type AnimationChannelKey,
  type AnimationGroupId,
} from '@/core/timelineitem/bunnytype'
import {
  clearAllAnimationGroups,
  createEmptyAnimation,
  createGroupKeyframe,
  debugAnimationGroups,
  findKeyframeAtFrame as findGroupKeyframeAtFrame,
  getKeyframeButtonState as getGroupKeyframeButtonState,
  getNextKeyframeFrame as getNextGroupKeyframeFrame,
  getPreviousKeyframeFrame as getPreviousGroupKeyframeFrame,
  hasAnimation as hasGroupAnimation,
  initializeAnimation as initializeAnimationGroups,
  isCurrentFrameOnKeyframe as isGroupCurrentFrameOnKeyframe,
  removeEmptyTrack,
  removeKeyframeAtFrame as removeGroupKeyframeAtFrame,
  setGroupValue,
  sortGroupKeyframes,
  toggleGroupKeyframe,
  adjustGroupKeyframesForDurationChange,
} from '@/core/animation/engine'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { setMaskPropertyValue } from '@/core/timelineitem/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import type { KeyframeButtonState, KeyframeUIState } from '@/core/timelineitem/animationtypes'

export type ActionResult = 'no-animation' | 'updated-keyframe' | 'created-keyframe'

export function absoluteFrameToRelativeFrame(
  absoluteFrame: number,
  timeRange: UnifiedTimeRange,
): number {
  return Math.max(0, absoluteFrame - timeRange.timelineStartTime)
}

export function relativeFrameToAbsoluteFrame(
  relativeFrame: number,
  timeRange: UnifiedTimeRange,
): number {
  return timeRange.timelineStartTime + relativeFrame
}

export function initializeAnimation(item: UnifiedTimelineItemData): void {
  initializeAnimationGroups(item as UnifiedTimelineItemData<MediaType>)
}

export function enableAnimation(item: UnifiedTimelineItemData): void {
  initializeAnimation(item)
}

export function disableAnimation(item: UnifiedTimelineItemData): void {
  item.animation = undefined
}

export function createChannelKeyframe(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): AnimateKeyframe<MediaType, AnimationGroupId> {
  return createGroupKeyframe(item as UnifiedTimelineItemData<MediaType>, absoluteFrame, channel)
}

export function hasAnimation(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): boolean {
  return hasGroupAnimation(item as UnifiedTimelineItemData<MediaType>, channel)
}

export function isCurrentFrameOnKeyframe(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel?: AnimationChannelKey,
): boolean {
  if (!channel) {
    return Object.keys(item.animation?.groups ?? {}).some((groupId) =>
      isGroupCurrentFrameOnKeyframe(
        item as UnifiedTimelineItemData<MediaType>,
        absoluteFrame,
        groupId as AnimationGroupId,
      ),
    )
  }
  return isGroupCurrentFrameOnKeyframe(item as UnifiedTimelineItemData<MediaType>, absoluteFrame, channel)
}

export function getKeyframeButtonState(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): KeyframeButtonState {
  if (!channel) {
    return Object.keys(item.animation?.groups ?? {}).length === 0
      ? 'none'
      : isCurrentFrameOnKeyframe(item, currentFrame)
        ? 'on-keyframe'
        : 'between-keyframes'
  }
  return getGroupKeyframeButtonState(
    item as UnifiedTimelineItemData<MediaType>,
    currentFrame,
    channel,
  ) as KeyframeButtonState
}

export function getKeyframeUIState(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): KeyframeUIState {
  return {
    hasAnimation: hasAnimation(item, channel),
    isOnKeyframe: isCurrentFrameOnKeyframe(item, currentFrame, channel),
  }
}

export function findKeyframeAtFrame(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): AnimateKeyframe<MediaType, AnimationGroupId> | undefined {
  return findGroupKeyframeAtFrame(item as UnifiedTimelineItemData<MediaType>, absoluteFrame, channel)
}

export function removeKeyframeAtFrame(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): boolean {
  return removeGroupKeyframeAtFrame(
    item as UnifiedTimelineItemData<MediaType>,
    absoluteFrame,
    channel,
  )
}

export function adjustKeyframesForDurationChange(
  item: UnifiedTimelineItemData,
  oldDurationFrames: number,
  newDurationFrames: number,
): void {
  adjustGroupKeyframesForDurationChange(
    item as UnifiedTimelineItemData<MediaType>,
    oldDurationFrames,
    newDurationFrames,
  )
}

export function sortKeyframes(item: UnifiedTimelineItemData, channel?: AnimationChannelKey): void {
  const groupId = channel ? normalizeAnimationGroupId(channel) : undefined
  sortGroupKeyframes(item as UnifiedTimelineItemData<MediaType>, groupId)
}

export function toggleKeyframe(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel: AnimationChannelKey,
): void {
  toggleGroupKeyframe(item as UnifiedTimelineItemData<MediaType>, currentFrame, channel)
}

function setConfigProperty(
  item: UnifiedTimelineItemData,
  property: string,
  value: unknown,
): void {
  if (property.startsWith('mask.') && typeof value === 'number' && TimelineItemQueries.hasVisualProperties(item)) {
    item.config.mask = setMaskPropertyValue(item.config.mask, property as never, value, {
      width: item.config.width,
      height: item.config.height,
    })
    return
  }
  if (
    property === 'filter.intensity' &&
    typeof value === 'number' &&
    TimelineItemQueries.supportsClipFilter(item) &&
    item.filterEffect
  ) {
    const nextFilterEffect = normalizeClipFilterConfig({
      ...item.filterEffect,
      intensity: value,
    })
    item.filterEffect = nextFilterEffect
    item.runtime.renderFilterEffect = normalizeClipFilterConfig(nextFilterEffect)
    return
  }
  const config = item.config as unknown as Record<string, unknown>
  if (!(property in config)) return
  config[property] = value
}

export async function handlePropertyChange(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  property: string,
  value: unknown,
): Promise<ActionResult> {
  const groupId = getAnimationGroupForProperty(property)
  if (!groupId || typeof value !== 'number') {
    setConfigProperty(item, property, value)
    return 'no-animation'
  }

  const patchKey = property.startsWith('mask.')
    ? property.replace('mask.', '')
    : property.startsWith('filter.')
      ? property.replace('filter.', '')
    : property

  const next = setGroupValue(
    item as UnifiedTimelineItemData<MediaType>,
    currentFrame,
    groupId,
    { [patchKey]: value } as never,
  )

  return next
}

export function getPreviousKeyframeFrame(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): number | null {
  if (!channel) return null
  return getPreviousGroupKeyframeFrame(
    item as UnifiedTimelineItemData<MediaType>,
    currentFrame,
    channel,
  )
}

export function getNextKeyframeFrame(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): number | null {
  if (!channel) return null
  return getNextGroupKeyframeFrame(
    item as UnifiedTimelineItemData<MediaType>,
    currentFrame,
    channel,
  )
}

export function getAllKeyframeFrames(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): number[] {
  if (!item.animation?.groups) return []
  if (channel) {
    const groupId = normalizeAnimationGroupId(channel)
    if (!groupId) return []
    const track = (item.animation.groups as Record<string, any>)[groupId]
    return ((track?.keyframes ?? []) as Array<{ frame: number }>)
      .map((keyframe) => relativeFrameToAbsoluteFrame(keyframe.frame, item.timeRange))
      .sort((a, b) => a - b)
  }
  return Object.values(item.animation.groups as Record<string, any>)
    .flatMap((track: any) => track?.keyframes ?? [])
    .map((keyframe: any) => relativeFrameToAbsoluteFrame(keyframe.frame, item.timeRange))
    .sort((a, b) => a - b)
}

export function getVisibleKeyframesForTimeline(
  item: UnifiedTimelineItemData,
): Array<{ frame: number; cachedFrame: number; position: number; groupIds: string[] }> {
  if (!item.animation?.groups) return []

  const merged = new Map<number, { frame: number; cachedFrame: number; position: number; groupIds: string[] }>()
  for (const [groupId, track] of Object.entries(item.animation.groups as Record<string, any>)) {
    for (const keyframe of (track?.keyframes ?? []) as Array<{ frame: number; cachedFrame: number; position: number }>) {
      const existing = merged.get(keyframe.frame)
      if (existing) {
        existing.groupIds.push(groupId)
        continue
      }
      merged.set(keyframe.frame, {
        frame: keyframe.frame,
        cachedFrame: keyframe.cachedFrame,
        position: keyframe.position,
        groupIds: [groupId],
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.frame - b.frame)
}

export function getKeyframeCount(item: UnifiedTimelineItemData, channel?: AnimationChannelKey): number {
  return getAllKeyframeFrames(item, channel).length
}

export function validateKeyframes(item: UnifiedTimelineItemData): boolean {
  return getVisibleKeyframesForTimeline(item).every((keyframe) => {
    const absoluteFrame = relativeFrameToAbsoluteFrame(keyframe.frame, item.timeRange)
    return absoluteFrame >= item.timeRange.timelineStartTime &&
      absoluteFrame <= item.timeRange.timelineEndTime
  })
}

export function clearAllKeyframes(item: UnifiedTimelineItemData): void {
  clearAllAnimationGroups(item as UnifiedTimelineItemData<MediaType>)
}

export function clearChannelKeyframes(item: UnifiedTimelineItemData, channel: AnimationChannelKey): void {
  clearAllAnimationGroups(item as UnifiedTimelineItemData<MediaType>, channel)
}

export function removeChannel(item: UnifiedTimelineItemData, channel: AnimationChannelKey): void {
  const groupId = normalizeAnimationGroupId(channel)
  if (!groupId || !item.animation?.groups) return
  delete (item.animation.groups as Record<string, unknown>)[groupId]
  removeEmptyTrack(item as UnifiedTimelineItemData<MediaType>, groupId)
}

export function isAnimationEmpty(item: UnifiedTimelineItemData): boolean {
  return !item.animation?.groups || Object.keys(item.animation.groups).length === 0
}

export function debugKeyframes(item: UnifiedTimelineItemData): void {
  debugAnimationGroups(item as UnifiedTimelineItemData<MediaType>)
}

export { createEmptyAnimation }
