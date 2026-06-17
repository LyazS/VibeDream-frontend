import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { GetConfigs, PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { MaskConfig } from '@/core/timelineitem/mask'
import { getItemLocalSize, normalizeMaskConfig } from '@/core/timelineitem/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { AnimationRegistry } from '@/core/animation/registry'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
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
  return { ...item.config }
}

export function createBaseRenderFilterEffect(
  item: UnifiedTimelineItemData<MediaType>,
): ClipFilterConfig | undefined {
  const filterConfig = item.exRenderConfig?.filter
  return filterConfig ? normalizeClipFilterConfig(filterConfig) : undefined
}

export function createBaseRenderMask(item: UnifiedTimelineItemData<MediaType>): MaskConfig | undefined {
  if (!TimelineItemQueries.hasVisualProperties(item)) {
    return undefined
  }

  const maskConfig = item.exRenderConfig?.mask
  return maskConfig
    ? normalizeMaskConfig(maskConfig, getItemLocalSize(item.config.width, item.config.height))
    : undefined
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
    if (definition.scope === 'transform' || definition.scope === 'audio') {
      definition.applyValueToConfig(
        mutableRenderConfig,
        getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
      )
    }
  }

  return renderConfig
}

export function resolveRenderMaskAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): MaskConfig | undefined {
  const renderMask = createBaseRenderMask(item)

  if (!renderMask || !isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return renderMask
  }

  const visualConfig = item.config as { width: number; height: number }
  const mutableMask = renderMask as unknown as Record<string, unknown>
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope !== 'mask') {
      continue
    }
    definition.applyValueToConfig(
      mutableMask,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  return normalizeMaskConfig(
    mutableMask as Partial<MaskConfig>,
    getItemLocalSize(visualConfig.width, visualConfig.height),
  )
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
  const resolvedFilterEffect = resolveRenderFilterEffectAtFrame(item, currentAbsoluteFrame)
  const resolvedMask = resolveRenderMaskAtFrame(item, currentAbsoluteFrame)
  item.runtime.exRenderConfig = {
    ...item.runtime.exRenderConfig,
    filter: resolvedFilterEffect,
    mask: resolvedMask,
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
