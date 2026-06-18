import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import {
  normalizeAnimationGroupId,
  type AnimateKeyframe,
  type AnimationChannelKey,
  type AnimationGroupId,
  type AnimationGroupTrack,
  type AnimationGroupValueMap,
  type PropertyAnimationGroupId,
  type PropertyAnimationValueByGroup,
  type GetAnimation,
} from '@/core/timelineitem/model/render'
import { AnimationRegistry } from './registry'
import { isFilterParamPropertyId } from '@/core/property-system/schema/propertyIds'

export type AnimationButtonState = 'none' | 'on-keyframe' | 'between-keyframes'

function cloneValue<G extends PropertyAnimationGroupId>(
  value: PropertyAnimationValueByGroup<G>,
): PropertyAnimationValueByGroup<G> {
  return { ...(value as Record<string, unknown>) } as PropertyAnimationValueByGroup<G>
}

function createKeyframeValueAlias<G extends PropertyAnimationGroupId>(
  frame: number,
  position: number,
  value: PropertyAnimationValueByGroup<G>,
): AnimateKeyframe<MediaType, G> {
  const payload = cloneValue(value)
  return {
    position,
    frame,
    cachedFrame: frame,
    value: payload,
    properties: payload,
    easing: { type: 'linear' },
  } as AnimateKeyframe<MediaType, G>
}

export function getRelativeFrame(item: UnifiedTimelineItemData<MediaType>, absoluteFrame: number) {
  return Math.max(0, absoluteFrame - item.timeRange.timelineStartTime)
}

export function getPosition(item: UnifiedTimelineItemData<MediaType>, relativeFrame: number) {
  const duration = Math.max(1, item.timeRange.timelineEndTime - item.timeRange.timelineStartTime)
  return relativeFrame / duration
}

export function createEmptyAnimation<T extends MediaType>(): GetAnimation<T> {
  return { groups: {} } as GetAnimation<T>
}

export function initializeAnimation(item: UnifiedTimelineItemData<MediaType>): void {
  if (!item.animation || !item.animation.groups) {
    item.animation = createEmptyAnimation()
  }
}

export function getTrack<G extends PropertyAnimationGroupId>(
  item: UnifiedTimelineItemData<MediaType>,
  groupId: G,
): AnimationGroupTrack<MediaType, G> | undefined {
  return (item.animation?.groups as Record<string, unknown> | undefined)?.[groupId] as AnimationGroupTrack<
    MediaType,
    G
  > | undefined
}

export function ensureTrack<G extends PropertyAnimationGroupId>(
  item: UnifiedTimelineItemData<MediaType>,
  groupId: G,
): AnimationGroupTrack<MediaType, G> {
  initializeAnimation(item)
  const groups = item.animation!.groups as Record<string, unknown>
  const existing = groups[groupId] as AnimationGroupTrack<MediaType, G> | undefined
  if (existing) {
    return existing
  }
  const track: AnimationGroupTrack<MediaType, G> = {
    groupId,
    strategyKey: groupId,
    keyframes: [],
  }
  groups[groupId] = track
  return track
}

export function sortGroupKeyframes(
  item: UnifiedTimelineItemData<MediaType>,
  groupId?: PropertyAnimationGroupId,
): void {
  const sortTrack = (track?: AnimationGroupTrack<MediaType, PropertyAnimationGroupId>) => {
    track?.keyframes.sort((a, b) => a.frame - b.frame)
  }

  if (!item.animation?.groups) return
  if (groupId) {
    sortTrack(getTrack(item, groupId))
    return
  }
  for (const track of Object.values(item.animation.groups) as Array<
    AnimationGroupTrack<MediaType, PropertyAnimationGroupId> | undefined
  >) {
    sortTrack(track)
  }
}

export function removeEmptyTrack(item: UnifiedTimelineItemData<MediaType>, groupId: PropertyAnimationGroupId): void {
  if (!item.animation?.groups) return
  const track = getTrack(item, groupId)
  const groups = item.animation.groups as Record<string, unknown>
  if (track && track.keyframes.length === 0) {
    delete groups[groupId]
  }
  if (Object.keys(groups).length === 0) {
    item.animation = undefined
  }
}

export function getSupportedAnimationGroups(item: UnifiedTimelineItemData<MediaType>): PropertyAnimationGroupId[] {
  const staticGroups = AnimationRegistry.list()
    .filter((definition) => definition.supports(item))
    .map((definition) => definition.id)
  const dynamicGroups = Object.keys(item.animation?.groups ?? {})
    .filter(isFilterParamPropertyId) as PropertyAnimationGroupId[]
  return [...new Set([...staticGroups, ...dynamicGroups])]
}

export function createGroupKeyframe<G extends PropertyAnimationGroupId>(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: G | AnimationChannelKey,
): AnimateKeyframe<MediaType, G> {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) {
    throw new Error(`未知动画组: ${String(rawGroupId)}`)
  }
  const baseValue = getCurrentGroupValue(item, absoluteFrame, groupId) as PropertyAnimationValueByGroup<G>
  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  return createKeyframeValueAlias(relativeFrame, getPosition(item, relativeFrame), baseValue) as AnimateKeyframe<
    MediaType,
    G
  >
}

export function findKeyframeAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): AnimateKeyframe<MediaType, PropertyAnimationGroupId> | undefined {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return undefined
  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  return getTrack(item, groupId)?.keyframes.find((keyframe) => keyframe.frame === relativeFrame)
}

export function hasAnimation(
  item: UnifiedTimelineItemData<MediaType>,
  rawGroupId?: AnimationChannelKey,
): boolean {
  if (!item.animation?.groups) return false
  if (rawGroupId) {
    const groupId = normalizeAnimationGroupId(rawGroupId)
    return groupId ? (getTrack(item, groupId)?.keyframes.length ?? 0) > 0 : false
  }
  return Object.values(item.animation.groups).some((track) => (track?.keyframes.length ?? 0) > 0)
}

export function isCurrentFrameOnKeyframe(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): boolean {
  return Boolean(findKeyframeAtFrame(item, absoluteFrame, rawGroupId))
}

export function getKeyframeButtonState(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): AnimationButtonState {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return 'none'
  if (!hasAnimation(item, groupId)) return 'none'
  return isCurrentFrameOnKeyframe(item, absoluteFrame, groupId) ? 'on-keyframe' : 'between-keyframes'
}

export function removeKeyframeAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): boolean {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return false
  const track = getTrack(item, groupId)
  if (!track) return false
  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  const next = track.keyframes.filter((keyframe) => keyframe.frame !== relativeFrame)
  const removed = next.length !== track.keyframes.length
  if (removed) {
    track.keyframes = next
    removeEmptyTrack(item, groupId)
  }
  return removed
}

export function getPreviousKeyframeFrame(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): number | null {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return null
  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  const frames = (getTrack(item, groupId)?.keyframes ?? [])
    .map((keyframe) => keyframe.frame)
    .filter((frame) => frame < relativeFrame)
  if (frames.length === 0) return null
  return Math.max(...frames) + item.timeRange.timelineStartTime
}

export function getNextKeyframeFrame(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): number | null {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return null
  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  const frames = (getTrack(item, groupId)?.keyframes ?? [])
    .map((keyframe) => keyframe.frame)
    .filter((frame) => frame > relativeFrame)
  if (frames.length === 0) return null
  return Math.min(...frames) + item.timeRange.timelineStartTime
}

export function getCurrentGroupValue<G extends PropertyAnimationGroupId>(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  groupId: G,
): PropertyAnimationValueByGroup<G> {
  const definition = AnimationRegistry.get(groupId)
  const track = getTrack(item, groupId)
  if (!track || track.keyframes.length === 0) {
    return cloneValue(definition.getBaseValue(item)) as PropertyAnimationValueByGroup<G>
  }

  const relativeFrame = getRelativeFrame(item, absoluteFrame)
  let before: AnimateKeyframe<MediaType, G> | null = null
  let after: AnimateKeyframe<MediaType, G> | null = null
  for (const keyframe of track.keyframes as Array<AnimateKeyframe<MediaType, G>>) {
    if (keyframe.frame <= relativeFrame) {
      before = keyframe
      continue
    }
    after = keyframe
    break
  }

  if (before && after) {
    const span = Math.max(after.frame - before.frame, 1)
    const t = (relativeFrame - before.frame) / span
    return definition.interpolate(before.value, after.value, t) as PropertyAnimationValueByGroup<G>
  }
  if (before) return cloneValue(before.value) as PropertyAnimationValueByGroup<G>
  if (after) return cloneValue(after.value) as PropertyAnimationValueByGroup<G>
  return cloneValue(definition.getBaseValue(item)) as PropertyAnimationValueByGroup<G>
}

export function toggleGroupKeyframe(
  item: UnifiedTimelineItemData<MediaType>,
  absoluteFrame: number,
  rawGroupId: AnimationChannelKey,
): void {
  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId) return
  const buttonState = getKeyframeButtonState(item, absoluteFrame, groupId)
  if (buttonState === 'on-keyframe') {
    removeKeyframeAtFrame(item, absoluteFrame, groupId)
    return
  }

  const track = ensureTrack(item, groupId)
  track.keyframes.push(createGroupKeyframe(item, absoluteFrame, groupId))
  sortGroupKeyframes(item, groupId)
}

export function clearAllAnimationGroups(
  item: UnifiedTimelineItemData<MediaType>,
  rawGroupId?: AnimationChannelKey,
): void {
  if (!rawGroupId) {
    item.animation = undefined
    return
  }

  const groupId = normalizeAnimationGroupId(rawGroupId)
  if (!groupId || !item.animation?.groups) return
  const groups = item.animation.groups as Record<string, unknown>
  delete groups[groupId]
  if (Object.keys(groups).length === 0) {
    item.animation = undefined
  }
}

export function adjustGroupKeyframesForDurationChange(
  item: UnifiedTimelineItemData<MediaType>,
  oldDurationFrames: number,
  newDurationFrames: number,
): void {
  if (!item.animation?.groups) return
  for (const track of Object.values(item.animation.groups) as Array<
    AnimationGroupTrack<MediaType, PropertyAnimationGroupId> | undefined
  >) {
    if (!track) continue
    track.keyframes = track.keyframes
      .map((keyframe) => {
        const position = Math.max(0, Math.min(1, keyframe.position))
        const nextFrame = Math.max(0, Math.round(position * newDurationFrames))
        return {
          ...keyframe,
          position,
          frame: nextFrame,
          cachedFrame: nextFrame,
          value: cloneValue(keyframe.value),
          properties: cloneValue(keyframe.value),
        }
      })
      .filter((keyframe) => keyframe.frame <= newDurationFrames)
  }
}

export function debugAnimationGroups(item: UnifiedTimelineItemData<MediaType>): void {
  console.log('Animation Groups:', item.animation?.groups ?? {})
}
