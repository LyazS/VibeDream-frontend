import type { MediaType } from '@/core/mediaitem'
import { cloneDeep } from 'lodash'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type {
  GetConfigs,
  PropertyAnimationGroupId,
  TimelineExtraRenderConfig,
  VisualProps,
} from '@/core/timelineitem/bunnytype'
import type { ClipFilterConfig } from '@/core/filter/types'
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
  return cloneDeep(item.baseRenderConfig)
}

export function createBaseRenderFilterEffect(
  item: UnifiedTimelineItemData<MediaType>,
): ClipFilterConfig | undefined {
  return item.exRenderConfig?.filter ? normalizeClipFilterConfig(item.exRenderConfig.filter) : undefined
}

export function createBaseExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
): TimelineExtraRenderConfig {
  return cloneDeep(item.exRenderConfig ?? {})
}

function getActiveAnimationGroups(item: UnifiedTimelineItemData<MediaType>): PropertyAnimationGroupId[] {
  if (!item.animation?.groups) return []
  return getSupportedAnimationGroups(item).filter((groupId) => {
    const definition = AnimationRegistry.get(groupId)
    const track = (item.animation?.groups as Record<string, { keyframes: unknown[] }> | undefined)?.[groupId]
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

  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope !== 'transform' && definition.scope !== 'audio') {
      continue
    }
    const targetConfig =
      definition.scope === 'transform'
        ? TimelineItemQueries.getVisualRenderConfig(item, renderConfig)
        : TimelineItemQueries.getAudioRenderConfig(item, renderConfig)
    definition.applyValueToConfig(
      targetConfig as unknown as Record<string, unknown>,
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

export function resolveExtraRenderConfigAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
  resolvedVisualConfig?: VisualProps,
): TimelineExtraRenderConfig {
  const extraRenderConfig = createBaseExtraRenderConfig(item)

  if (!isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return extraRenderConfig
  }

  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope === 'filter') {
      const renderFilterEffect = extraRenderConfig.filter
      if (!renderFilterEffect) continue
      definition.applyValueToConfig(
        renderFilterEffect as unknown as Record<string, unknown>,
        getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
      )
      extraRenderConfig.filter = normalizeClipFilterConfig(
        renderFilterEffect as Partial<ClipFilterConfig>,
      )
      continue
    }

    if (definition.scope === 'mask') {
      if (!TimelineItemQueries.hasVisualProperties(item)) continue
      const visualConfig = resolvedVisualConfig
        ?? TimelineItemQueries.getVisualRenderConfig(item)
      const mutableMaskConfig = {
        mask: normalizeMaskConfig(extraRenderConfig.mask, {
          width: visualConfig.width,
          height: visualConfig.height,
        }),
        width: visualConfig.width,
        height: visualConfig.height,
      }
      definition.applyValueToConfig(
        mutableMaskConfig as unknown as Record<string, unknown>,
        getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
      )
      extraRenderConfig.mask = normalizeMaskConfig(
        mutableMaskConfig.mask,
        getItemLocalSize(visualConfig.width, visualConfig.height),
      )
    }
  }

  return extraRenderConfig
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  const resolvedRenderConfig = resolveRenderConfigAtFrame(item, currentAbsoluteFrame)
  item.runtime.renderConfig = resolvedRenderConfig
  const resolvedVisualConfig = TimelineItemQueries.hasVisualProperties(item)
    ? TimelineItemQueries.getVisualRenderConfig(item, resolvedRenderConfig as GetConfigs<'video' | 'image' | 'text'>)
    : undefined
  item.runtime.exRenderConfig = resolveExtraRenderConfigAtFrame(
    item,
    currentAbsoluteFrame,
    resolvedVisualConfig,
  )
}

export function applyAnimationsToItems(
  items: UnifiedTimelineItemData<MediaType>[],
  currentAbsoluteFrame: number,
): void {
  for (const item of items) {
    applyAnimationToConfig(item, currentAbsoluteFrame)
  }
}
