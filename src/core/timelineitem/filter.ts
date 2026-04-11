import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import {
  DEFAULT_CLIP_FILTER_INTENSITY,
  type ClipFilterConfig,
} from '@/core/filter/types'

export type ClipFilterVisualTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

function clampIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) {
    return DEFAULT_CLIP_FILTER_INTENSITY
  }
  return Math.max(0, Math.min(1, intensity))
}

export function createDefaultClipFilterConfig(): ClipFilterConfig {
  return {
    intensity: DEFAULT_CLIP_FILTER_INTENSITY,
    params: {},
  }
}

export function normalizeClipFilterConfig(
  config?: Partial<ClipFilterConfig> | null,
): ClipFilterConfig {
  const defaults = createDefaultClipFilterConfig()
  return {
    assetId: config?.assetId,
    intensity: clampIntensity(config?.intensity ?? defaults.intensity),
    params: config?.params ? JSON.parse(JSON.stringify(config.params)) : {},
    packagePayload: config?.packagePayload,
  }
}

export function areClipFilterConfigsEqual(
  a?: ClipFilterConfig,
  b?: ClipFilterConfig,
): boolean {
  if (!a && !b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.assetId === b.assetId
    && Math.abs(a.intensity - b.intensity) <= 0.0001
    && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {})
}

export function supportsClipFilterMediaType(
  mediaType: MediaType,
): mediaType is 'video' | 'image' {
  return mediaType === 'video' || mediaType === 'image'
}

export function supportsClipFilter(
  item: UnifiedTimelineItemData<MediaType>,
): item is ClipFilterVisualTimelineItem {
  return supportsClipFilterMediaType(item.mediaType)
}

export function hasEnabledClipFilter(
  item: UnifiedTimelineItemData<MediaType>,
): item is ClipFilterVisualTimelineItem & { filterEffect: ClipFilterConfig } {
  return supportsClipFilter(item) && Boolean(item.filterEffect)
}
