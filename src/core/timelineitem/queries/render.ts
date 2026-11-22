// ==================== 配置访问函数 ====================

import type { MediaType } from '@/core/mediaitem'
import type {
  AudioProps,
  TimelineBaseRenderConfig,
  UnifiedTimelineItemData,
  VisualProps,
} from '@/core/timelineitem/model/timelineItem'
import {
  getAudioVolumeOverlay,
  getVisualBlendIntensityOverlay,
  getVisualPositionOverlay,
  getVisualRotationOverlay,
  getVisualSizeOverlay,
} from '@/core/property-system/render-state'
import {
  audioVolumeSchema,
  visualBlendIntensitySchema,
  visualPositionSchema,
  visualRotationSchema,
  visualSizeSchema,
} from '@/core/property-system/schema'
import { hasAudioProperties, hasVisualProperties } from './guards'

export function getBaseRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  return item.baseRenderConfig
}

function getTypedVisualRenderConfig(
  item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
): VisualProps {
  return item.baseRenderConfig.visual
}

function getTypedAudioRenderConfig(
  item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'>,
): AudioProps {
  return item.baseRenderConfig.audio
}

export function getBaseVisualConfig(item: UnifiedTimelineItemData<MediaType>): VisualProps | undefined {
  if (!hasVisualProperties(item)) return undefined
  return getTypedVisualRenderConfig(item)
}

export function getBaseAudioConfig(item: UnifiedTimelineItemData<MediaType>): AudioProps | undefined {
  if (!hasAudioProperties(item)) return undefined
  return getTypedAudioRenderConfig(item)
}

export function getMergedRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  return item.runtime.renderConfig || item.baseRenderConfig
}

export function getResolvedRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  const mergedRenderConfig = getMergedRenderConfig(item)
  const positionOverlay = getVisualPositionOverlay(item.id)
  const sizeOverlay = getVisualSizeOverlay(item.id)
  const rotationOverlay = getVisualRotationOverlay(item.id)
  const blendIntensityOverlay = getVisualBlendIntensityOverlay(item.id)
  const volumeOverlay = getAudioVolumeOverlay(item.id)

  if (!positionOverlay && !sizeOverlay && !rotationOverlay && !blendIntensityOverlay && !volumeOverlay) {
    return mergedRenderConfig
  }

  const visualRenderConfig = hasVisualProperties(item)
    ? (mergedRenderConfig as TimelineBaseRenderConfig<'video' | 'image'>).visual
    : null
  const audioRenderConfig = hasAudioProperties(item)
    ? (mergedRenderConfig as TimelineBaseRenderConfig<'video' | 'audio'>).audio
    : null
  const nextVisualRenderConfig = visualRenderConfig
    ? {
        ...visualRenderConfig,
        ...(positionOverlay
          ? {
              [visualPositionSchema.valueFields[0]]: positionOverlay.x ?? visualRenderConfig.x,
              [visualPositionSchema.valueFields[1]]: positionOverlay.y ?? visualRenderConfig.y,
            }
          : {}),
        ...(sizeOverlay
          ? {
              [visualSizeSchema.valueFields[0]]: sizeOverlay.width ?? visualRenderConfig.width,
              [visualSizeSchema.valueFields[1]]: sizeOverlay.height ?? visualRenderConfig.height,
            }
          : {}),
        ...(rotationOverlay
          ? { [visualRotationSchema.valueFields[0]]: rotationOverlay.rotation }
          : {}),
        ...(blendIntensityOverlay
          ? { [visualBlendIntensitySchema.valueFields[0]]: blendIntensityOverlay.blendIntensity }
          : {}),
      }
    : null
  const nextAudioRenderConfig = audioRenderConfig
    ? {
        ...audioRenderConfig,
        ...(volumeOverlay
          ? { [audioVolumeSchema.valueFields[0]]: volumeOverlay.volume }
          : {}),
      }
    : null

  return {
    ...mergedRenderConfig,
    ...(nextVisualRenderConfig ? { visual: nextVisualRenderConfig } : {}),
    ...(nextAudioRenderConfig ? { audio: nextAudioRenderConfig } : {}),
  } as TimelineBaseRenderConfig<T>
}
