import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { AnimationGroupId } from '@/core/timelineitem/bunnytype'
import { normalizeMaskConfig } from '@/core/timelineitem/mask'
import { AnimationRegistry } from '@/core/animation/registry'
import {
  getCurrentGroupValue,
  getSupportedAnimationGroups,
} from '@/core/animation/engine'

function createBaseRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  const baseConfig = { ...item.config }
  if ('mask' in baseConfig) {
    const width = typeof baseConfig.width === 'number' ? baseConfig.width : undefined
    const height = typeof baseConfig.height === 'number' ? baseConfig.height : undefined
    ;(baseConfig as { mask?: ReturnType<typeof normalizeMaskConfig> }).mask = normalizeMaskConfig(
      (item.config as { mask?: unknown }).mask as never,
      width && height ? { width, height } : undefined,
    )
  }
  return baseConfig
}

function getActiveAnimationGroups(item: UnifiedTimelineItemData<MediaType>): AnimationGroupId[] {
  if (!item.animation?.groups) return []
  return getSupportedAnimationGroups(item).filter((groupId) => {
    const definition = AnimationRegistry.get(groupId)
    const track = (item.animation?.groups as Record<string, any> | undefined)?.[groupId]
    return definition.isEnabled(item) && Boolean(track && track.keyframes.length > 0)
  })
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  item.runtime.renderConfig = createBaseRenderConfig(item) as typeof item.runtime.renderConfig

  if (currentAbsoluteFrame < item.timeRange.timelineStartTime || currentAbsoluteFrame > item.timeRange.timelineEndTime) {
    return
  }

  const renderConfig = item.runtime.renderConfig as unknown as Record<string, unknown>
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    definition.applyValueToConfig(renderConfig, getCurrentGroupValue(item, currentAbsoluteFrame, groupId))
  }
}

export function applyAnimationsToItems(
  items: UnifiedTimelineItemData<MediaType>[],
  currentAbsoluteFrame: number,
): void {
  for (const item of items) {
    applyAnimationToConfig(item, currentAbsoluteFrame)
  }
}
