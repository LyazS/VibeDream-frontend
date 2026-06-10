import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { GetConfigs, PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { ClipFilterConfig } from '@/core/filter/types'
import { normalizeMaskConfig } from '@/core/timelineitem/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { AnimationRegistry } from '@/core/animation/registry'
import {
  getCurrentGroupValue,
  getSupportedAnimationGroups,
} from '@/core/animation/engine'
import {
  getFilterIntensityOverlay,
  getFilterParamOverlay,
} from '@/core/property-system/render-state'
import { filterIntensitySchema } from '@/core/property-system/schema'

export function createBaseRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
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

export function createBaseRenderFilterEffect(
  item: UnifiedTimelineItemData<MediaType>,
): ClipFilterConfig | undefined {
  return item.filterEffect ? normalizeClipFilterConfig(item.filterEffect) : undefined
}

function getActiveAnimationGroups(item: UnifiedTimelineItemData<MediaType>): PropertyAnimationGroupId[] {
  if (!item.animation?.groups) return []
  return getSupportedAnimationGroups(item).filter((groupId) => {
    const definition = AnimationRegistry.get(groupId)
    const track = (item.animation?.groups as Record<string, any> | undefined)?.[groupId]
    return definition.isEnabled(item) && Boolean(track && track.keyframes.length > 0)
  })
}

function isFrameInAnimationResolveRange(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): boolean {
  // Selection preview can render the clip at timelineEndTime, where 100% keyframes live.
  return (
    currentAbsoluteFrame >= item.timeRange.timelineStartTime &&
    currentAbsoluteFrame <= item.timeRange.timelineEndTime
  )
}

export function resolveRenderConfigAtFrame<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
  currentAbsoluteFrame: number,
): GetConfigs<T> {
  const renderConfig = createBaseRenderConfig(item) as GetConfigs<T>

  if (!isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return renderConfig
  }

  const mutableRenderConfig = renderConfig as unknown as Record<string, unknown>
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope === 'filter') {
      continue
    }
    definition.applyValueToConfig(
      mutableRenderConfig,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  return renderConfig
}

export function resolveRenderFilterEffectAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): ClipFilterConfig | undefined {
  const renderFilterEffect = createBaseRenderFilterEffect(item)

  if (!renderFilterEffect || !isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return renderFilterEffect
  }

  const mutableFilterEffect = renderFilterEffect as unknown as Record<string, unknown>
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope !== 'filter') {
      continue
    }
    definition.applyValueToConfig(
      mutableFilterEffect,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  const resolvedFilterEffect = normalizeClipFilterConfig(mutableFilterEffect as Partial<ClipFilterConfig>)
  const filterIntensityOverlay = getFilterIntensityOverlay(item.id)
  const filterParamOverlay = getFilterParamOverlay(item.id)

  if (!filterIntensityOverlay && !filterParamOverlay) {
    return resolvedFilterEffect
  }

  return normalizeClipFilterConfig({
    ...resolvedFilterEffect,
    ...(filterIntensityOverlay
      ? { [filterIntensitySchema.valueFields[0]]: filterIntensityOverlay.intensity }
      : {}),
    params: {
      ...resolvedFilterEffect.params,
      ...(filterParamOverlay?.params ?? {}),
    },
  })
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  item.runtime.renderConfig = resolveRenderConfigAtFrame(item, currentAbsoluteFrame)
  item.runtime.renderFilterEffect = resolveRenderFilterEffectAtFrame(item, currentAbsoluteFrame)
}

export function applyAnimationsToItems(
  items: UnifiedTimelineItemData<MediaType>[],
  currentAbsoluteFrame: number,
): void {
  for (const item of items) {
    applyAnimationToConfig(item, currentAbsoluteFrame)
  }
}
