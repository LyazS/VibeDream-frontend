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
    effectPackageId: '',
    templateId: '',
    packageVersion: '',
    catalogVersion: '',
    intensity: DEFAULT_CLIP_FILTER_INTENSITY,
    params: {},
    packagePayload: {
      effectType: 'filter',
      packageDir: '',
      packageId: '',
      version: '',
      entryFile: '',
      parameterSchema: {},
      defaultParams: {},
      manifestSnapshot: {
        name: { zh: '', en: '' },
        category: {
          key: '',
          label: { zh: '', en: '' },
        },
        summary: { zh: '', en: '' },
        tags: { zh: [], en: [] },
        cover: null,
      },
      scriptHash: '',
      host: {
        filter: {
          supportedMediaTypes: ['video', 'image'],
        },
      },
    },
  }
}

export function normalizeClipFilterConfig(
  config?: Partial<ClipFilterConfig> | null,
): ClipFilterConfig {
  const defaults = createDefaultClipFilterConfig()
  return {
    effectPackageId: config?.effectPackageId ?? defaults.effectPackageId,
    templateId: config?.templateId ?? defaults.templateId,
    packageVersion: config?.packageVersion ?? defaults.packageVersion,
    catalogVersion: config?.catalogVersion ?? defaults.catalogVersion,
    intensity: clampIntensity(config?.intensity ?? defaults.intensity),
    params: config?.params ? JSON.parse(JSON.stringify(config.params)) : {},
    packagePayload: config?.packagePayload
      ? JSON.parse(JSON.stringify(config.packagePayload))
      : defaults.packagePayload,
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

  return a.effectPackageId === b.effectPackageId
    && a.templateId === b.templateId
    && a.packageVersion === b.packageVersion
    && a.catalogVersion === b.catalogVersion
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
): item is ClipFilterVisualTimelineItem & { exRenderConfig: { filter: ClipFilterConfig } } {
  return supportsClipFilter(item) && Boolean(item.exRenderConfig?.filter)
}
