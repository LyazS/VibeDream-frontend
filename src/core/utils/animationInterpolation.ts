import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData, TimelineBaseRenderConfig } from '@/core/timelineitem/type'
import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { MaskConfig } from '@/core/timelineitem/mask'
import { getItemLocalSize, normalizeMaskConfig } from '@/core/timelineitem/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { AnimationRegistry } from '@/core/animation/registry'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  getCurrentGroupValue,
  getTrack,
  getSupportedAnimationGroups,
} from '@/core/animation/engine'
import {
  getFilterIntensityOverlay,
  getFilterParamOverlay,
} from '@/core/property-system/render-state'
import { filterIntensitySchema } from '@/core/property-system/schema'
import { cloneDeep } from 'lodash'

export function createBaseRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  return cloneDeep(TimelineItemQueries.getBaseRenderConfig(item))
}

export function createBaseRenderFilterConfig(
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
  const visualConfig = TimelineItemQueries.getVisualRenderConfig(item)
  return maskConfig
    ? normalizeMaskConfig(maskConfig, getItemLocalSize(visualConfig?.width ?? 0, visualConfig?.height ?? 0))
    : undefined
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
  // Selection preview can render the clip at timelineEndTime, where 100% keyframes live.
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
    if (definition.scope === 'transform') {
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        continue
      }
      const visualConfig = (renderConfig as TimelineBaseRenderConfig<'video' | 'image' | 'text'>).visual
      if (!visualConfig) continue
      definition.applyValueToConfig(
        visualConfig as object,
        getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
      )
    } else if (definition.scope === 'audio') {
      if (!TimelineItemQueries.hasAudioProperties(item)) {
        continue
      }
      const audioConfig = (renderConfig as TimelineBaseRenderConfig<'video' | 'audio'>).audio
      if (!audioConfig) continue
      definition.applyValueToConfig(
        audioConfig as object,
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

  const visualConfig = TimelineItemQueries.getVisualRenderConfig(item)
  const mutableMask = renderMask as Partial<MaskConfig>
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope !== 'mask') {
      continue
    }
    definition.applyValueToConfig(
      mutableMask as Record<string, unknown>,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  return normalizeMaskConfig(
    mutableMask,
    getItemLocalSize(visualConfig?.width ?? 0, visualConfig?.height ?? 0),
  )
}

export function resolveRenderFilterConfigAtFrame(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): ClipFilterConfig | undefined {
  const renderFilterConfig = createBaseRenderFilterConfig(item)

  if (!renderFilterConfig || !isFrameInAnimationResolveRange(item, currentAbsoluteFrame)) {
    return renderFilterConfig
  }

  const mutableFilterConfig: Partial<ClipFilterConfig> = renderFilterConfig
  for (const groupId of getActiveAnimationGroups(item)) {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope !== 'filter') {
      continue
    }
    definition.applyValueToConfig(
      mutableFilterConfig as Record<string, unknown>,
      getCurrentGroupValue(item, currentAbsoluteFrame, groupId),
    )
  }

  const resolvedFilterConfig = normalizeClipFilterConfig(mutableFilterConfig)
  const filterIntensityOverlay = getFilterIntensityOverlay(item.id)
  const filterParamOverlay = getFilterParamOverlay(item.id)

  if (!filterIntensityOverlay && !filterParamOverlay) {
    return resolvedFilterConfig
  }

  return normalizeClipFilterConfig({
    ...resolvedFilterConfig,
    ...(filterIntensityOverlay
      ? { [filterIntensitySchema.valueFields[0]]: filterIntensityOverlay.intensity }
      : {}),
    params: {
      ...resolvedFilterConfig.params,
      ...(filterParamOverlay?.params ?? {}),
    },
  })
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  item.runtime.renderConfig = resolveRenderConfigAtFrame(item, currentAbsoluteFrame)
  const resolvedFilterConfig = resolveRenderFilterConfigAtFrame(item, currentAbsoluteFrame)
  const resolvedMask = resolveRenderMaskAtFrame(item, currentAbsoluteFrame)
  item.runtime.exRenderConfig = {
    ...item.runtime.exRenderConfig,
    filter: resolvedFilterConfig,
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
