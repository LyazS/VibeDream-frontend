import type { MediaType } from '@/core/mediaitem'
import type {
  TimelineBaseRenderConfig,
  UnifiedTimelineItemData,
} from '@/core/timelineitem/model/timelineItem'
import type { PropertyAnimationGroupId } from '@/core/timelineitem/model/render'
import { AnimationRegistry } from '@/core/animation/registry'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { getCurrentGroupValue, getSupportedAnimationGroups, getTrack } from '@/core/animation/engine'
import { cloneDeep } from 'lodash'

export function createBaseRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  return cloneDeep(TimelineItemQueries.getBaseRenderConfig(item))
}

function getActiveAnimationGroups(item: UnifiedTimelineItemData<MediaType>): PropertyAnimationGroupId[] {
  if (!item.animation?.groups) return []
  return getSupportedAnimationGroups(item).filter((groupId) => {
    const definition = AnimationRegistry.get(groupId)
    const track = getTrack(item, groupId)
    return definition.isEnabled(item) && Boolean(track && track.keyframes.length > 0)
  })
}

function isFrameInAnimationResolveRange(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): boolean {
  return (
    currentAbsoluteFrame >= item.timeRange.timelineStartTime &&
    currentAbsoluteFrame <= item.timeRange.timelineEndTime
  )
}

export function resolveRenderConfigAtFrame<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
  currentAbsoluteFrame: number,
): TimelineBaseRenderConfig<T> {
  const renderConfig = createBaseRenderConfig(item) as TimelineBaseRenderConfig<T>

  if (!isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return renderConfig
  }

  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope === 'visual') {
      if (!TimelineItemQueries.hasVisualProperties(item)) continue
      const visualConfig = (renderConfig as TimelineBaseRenderConfig<'video' | 'image'>).visual
      definition.applyValueToConfig(
        visualConfig as object,
        getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
      )
      continue
    }

    if (!TimelineItemQueries.hasAudioProperties(item)) continue
    const audioConfig = (renderConfig as TimelineBaseRenderConfig<'video' | 'audio'>).audio
    definition.applyValueToConfig(
      audioConfig as object,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  return renderConfig
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  item.runtime.renderConfig = resolveRenderConfigAtFrame(item, currentAbsoluteFrame)
}

export function applyAnimationsToItems(
  items: UnifiedTimelineItemData<MediaType>[],
  currentAbsoluteFrame: number,
): void {
  for (const item of items) {
    applyAnimationToConfig(item, currentAbsoluteFrame)
  }
}
