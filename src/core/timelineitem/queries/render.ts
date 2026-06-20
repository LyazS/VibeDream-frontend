// ==================== 配置访问函数 ====================

import type { MediaType } from '@/core/mediaitem'
import type {
  AudioProps,
  MaskConfig,
  TextProps,
  TimelineBaseRenderConfig,
  TimelineExtraRenderConfig,
  UnifiedTimelineItemData,
  VisualProps,
} from '@/core/timelineitem/model/timelineItem'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { ClipFilterConfig } from '@/core/filter/types'
import {
  getFilterIntensityOverlay,
  getFilterParamOverlay,
  getTransitionParamOverlay,
  getAudioVolumeOverlay,
  getTransformOpacityOverlay,
  getTransformPositionOverlay,
  getTransformRotationOverlay,
  getTransformSizeOverlay,
  getMaskCenterOverlay,
  getMaskFeatherOverlay,
  getMaskIntensityOverlay,
  getMaskEllipseSizeOverlay,
  getMaskRectangleSizeOverlay,
  getMaskRectangleCornerRadiusOverlay,
  getMaskMirrorLengthOverlay,
  getMaskRotationOverlay,
} from '@/core/property-system/render-state'
import {
  audioVolumeSchema,
  filterIntensitySchema,
  maskCenterSchema,
  maskFeatherSchema,
  maskIntensitySchema,
  maskEllipseSizeSchema,
  maskMirrorLengthSchema,
  maskRectangleCornerRadiusSchema,
  maskRectangleSizeSchema,
  transformOpacitySchema,
  transformPositionSchema,
  transformRotationSchema,
  transformSizeSchema,
} from '@/core/property-system/schema'
import { normalizeClipFilterConfig } from '@/core/timelineitem/features/filter'
import { normalizeClipTransitionOutConfig } from '@/core/timelineitem/features/transition'
import {
  isEllipseMaskConfig,
  isMirrorMaskConfig,
  isRectangleMaskConfig,
  normalizeMaskConfig,
} from '@/core/timelineitem/features/mask'
import { hasAudioProperties, hasVisualProperties, isTextTimelineItem, supportsClipFilter } from './guards'

export function getBaseRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  return item.baseRenderConfig
}

function getTypedVisualRenderConfig(
  item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> | UnifiedTimelineItemData<'text'>,
): VisualProps {
  return item.baseRenderConfig.visual
}

function getTypedAudioRenderConfig(
  item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'>,
): AudioProps {
  return item.baseRenderConfig.audio
}

function getTypedTextRenderConfig(item: UnifiedTimelineItemData<'text'>): TextProps {
  return item.baseRenderConfig.text
}

export function getBaseVisualConfig(item: UnifiedTimelineItemData<MediaType>): VisualProps | undefined {
  if (!hasVisualProperties(item)) return undefined
  return getTypedVisualRenderConfig(item)
}

export function getBaseAudioConfig(item: UnifiedTimelineItemData<MediaType>): AudioProps | undefined {
  if (!hasAudioProperties(item)) return undefined
  return getTypedAudioRenderConfig(item)
}

export function getBaseTextConfig(item: UnifiedTimelineItemData<MediaType>): TextProps | undefined {
  if (!isTextTimelineItem(item)) return undefined
  return getTypedTextRenderConfig(item)
}

export function getBaseExtraRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  return item.exRenderConfig
}

export function getMergedExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): TimelineExtraRenderConfig | undefined {
  if (!item) return undefined

  const persistentConfig = item.exRenderConfig
  const runtimeConfig = item.runtime.exRenderConfig

  return {
    filter: runtimeConfig.filter ?? persistentConfig.filter,
    transition: runtimeConfig.transition ?? persistentConfig.transition,
    mask: runtimeConfig.mask ?? persistentConfig.mask,
  }
}

export function getBaseTransition(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipTransitionOutConfig | undefined {
  return item?.exRenderConfig.transition
}

export function getResolvedTransition(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipTransitionOutConfig | undefined {
  if (!item) return undefined

  const renderTransitionConfig = getMergedExtraRenderConfig(item)?.transition
  if (!renderTransitionConfig) return undefined

  const transitionParamOverlay = getTransitionParamOverlay(item.id)
  if (!transitionParamOverlay) {
    return renderTransitionConfig
  }

  return normalizeClipTransitionOutConfig({
    ...renderTransitionConfig,
    params: {
      ...renderTransitionConfig.params,
      ...(transitionParamOverlay.params ?? {}),
    },
  })
}

export function getBaseFilter(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipFilterConfig | undefined {
  if (!item || !supportsClipFilter(item)) return undefined
  return item.exRenderConfig.filter
}

export function getBaseMask(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): MaskConfig | undefined {
  if (!item || !hasVisualProperties(item)) return undefined
  return item.exRenderConfig.mask
}

/**
 * 获取用于渲染的配置
 * 优先返回 renderConfig（包含动画插值），否则返回 config
 *
 * @param item 时间轴项目
 * @returns 用于渲染的配置对象
 */
export function getMergedRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  return item.runtime.renderConfig || item.baseRenderConfig
}

/**
 * 获取用于渲染的最终配置。
 *
 * 在 merged config 的基础上继续叠加当前交互态 overlay。
 */
export function getResolvedRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): TimelineBaseRenderConfig<T> {
  const mergedRenderConfig = getMergedRenderConfig(item)
  const positionOverlay = getTransformPositionOverlay(item.id)
  const sizeOverlay = getTransformSizeOverlay(item.id)
  const rotationOverlay = getTransformRotationOverlay(item.id)
  const opacityOverlay = getTransformOpacityOverlay(item.id)
  const volumeOverlay = getAudioVolumeOverlay(item.id)
  if (!positionOverlay && !sizeOverlay && !rotationOverlay && !opacityOverlay && !volumeOverlay) {
    return mergedRenderConfig
  }

  const visualRenderConfig = hasVisualProperties(item)
    ? (mergedRenderConfig as TimelineBaseRenderConfig<'video' | 'image' | 'text'>).visual
    : null
  const audioRenderConfig = hasAudioProperties(item)
    ? (mergedRenderConfig as TimelineBaseRenderConfig<'video' | 'audio'>).audio
    : null
  const nextVisualRenderConfig = visualRenderConfig
    ? {
        ...visualRenderConfig,
        ...(positionOverlay
          ? {
              [transformPositionSchema.valueFields[0]]: positionOverlay.x ?? visualRenderConfig.x,
              [transformPositionSchema.valueFields[1]]: positionOverlay.y ?? visualRenderConfig.y,
            }
          : {}),
        ...(sizeOverlay
          ? {
              [transformSizeSchema.valueFields[0]]: sizeOverlay.width ?? visualRenderConfig.width,
              [transformSizeSchema.valueFields[1]]: sizeOverlay.height ?? visualRenderConfig.height,
            }
          : {}),
        ...(rotationOverlay
          ? { [transformRotationSchema.valueFields[0]]: rotationOverlay.rotation }
          : {}),
        ...(opacityOverlay
          ? { [transformOpacitySchema.valueFields[0]]: opacityOverlay.opacity }
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

export function getResolvedMask(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): MaskConfig | undefined {
  if (!item || !hasVisualProperties(item)) return undefined

  const renderConfig = getResolvedRenderConfig(item)
  const maskCenterOverlay = getMaskCenterOverlay(item.id)
  const maskFeatherOverlay = getMaskFeatherOverlay(item.id)
  const maskIntensityOverlay = getMaskIntensityOverlay(item.id)
  const maskRectangleSizeOverlay = getMaskRectangleSizeOverlay(item.id)
  const maskRectangleCornerRadiusOverlay = getMaskRectangleCornerRadiusOverlay(item.id)
  const maskMirrorLengthOverlay = getMaskMirrorLengthOverlay(item.id)
  const maskEllipseSizeOverlay = getMaskEllipseSizeOverlay(item.id)
  const maskRotationOverlay = getMaskRotationOverlay(item.id)
  const renderMask = getMergedExtraRenderConfig(item)?.mask

  if (
    !maskCenterOverlay &&
    !maskFeatherOverlay &&
    !maskIntensityOverlay &&
    !maskRectangleSizeOverlay &&
    !maskRectangleCornerRadiusOverlay &&
    !maskMirrorLengthOverlay &&
    !maskEllipseSizeOverlay &&
    !maskRotationOverlay
  ) {
    return renderMask
  }

  const normalizedMask = normalizeMaskConfig(renderMask, {
    width: hasVisualProperties(item) ? renderConfig.visual.width ?? 0 : 0,
    height: hasVisualProperties(item) ? renderConfig.visual.height ?? 0 : 0,
  })

  return {
    ...normalizedMask,
    ...(maskCenterOverlay
      ? {
          [maskCenterSchema.valueFields[0]]: maskCenterOverlay.centerX ?? normalizedMask.centerX,
          [maskCenterSchema.valueFields[1]]: maskCenterOverlay.centerY ?? normalizedMask.centerY,
        }
      : {}),
    ...(maskRotationOverlay ? { rotation: maskRotationOverlay.rotation } : {}),
    ...(maskFeatherOverlay
      ? {
          [maskFeatherSchema.valueFields[0]]:
            maskFeatherOverlay.outerRange ?? normalizedMask.falloff.outerRange,
          falloff: {
            ...normalizedMask.falloff,
            [maskFeatherSchema.valueFields[0]]:
              maskFeatherOverlay.outerRange ?? normalizedMask.falloff.outerRange,
          },
        }
      : {}),
    ...(maskIntensityOverlay
      ? {
          [maskIntensitySchema.valueFields[0]]:
            maskIntensityOverlay.decayRate ?? normalizedMask.falloff.decayRate,
          falloff: {
            ...normalizedMask.falloff,
            [maskIntensitySchema.valueFields[0]]:
              maskIntensityOverlay.decayRate ?? normalizedMask.falloff.decayRate,
          },
        }
      : {}),
    ...(maskRectangleSizeOverlay && isRectangleMaskConfig(normalizedMask)
      ? {
          [maskRectangleSizeSchema.valueFields[0]]: maskRectangleSizeOverlay.width ?? normalizedMask.width,
          [maskRectangleSizeSchema.valueFields[1]]: maskRectangleSizeOverlay.height ?? normalizedMask.height,
        }
      : {}),
    ...(maskRectangleCornerRadiusOverlay && isRectangleMaskConfig(normalizedMask)
      ? {
          [maskRectangleCornerRadiusSchema.valueFields[0]]:
            maskRectangleCornerRadiusOverlay.cornerRadius ?? normalizedMask.cornerRadius,
        }
      : {}),
    ...(maskMirrorLengthOverlay && isMirrorMaskConfig(normalizedMask)
      ? {
          [maskMirrorLengthSchema.valueFields[0]]: maskMirrorLengthOverlay.length ?? normalizedMask.length,
        }
      : {}),
    ...(maskEllipseSizeOverlay && isEllipseMaskConfig(normalizedMask)
      ? {
          [maskEllipseSizeSchema.valueFields[0]]: maskEllipseSizeOverlay.ellipseWidth ?? normalizedMask.ellipseWidth,
          [maskEllipseSizeSchema.valueFields[1]]: maskEllipseSizeOverlay.ellipseHeight ?? normalizedMask.ellipseHeight,
        }
      : {}),
  }
}

export function getResolvedFilter(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipFilterConfig | undefined {
  if (!item || !supportsClipFilter(item)) return undefined

  const renderFilterConfig = getMergedExtraRenderConfig(item)?.filter
  if (!renderFilterConfig) return undefined

  const filterIntensityOverlay = getFilterIntensityOverlay(item.id)
  const filterParamOverlay = getFilterParamOverlay(item.id)

  if (!filterIntensityOverlay && !filterParamOverlay) {
    return renderFilterConfig
  }

  return normalizeClipFilterConfig({
    ...renderFilterConfig,
    ...(filterIntensityOverlay
      ? { [filterIntensitySchema.valueFields[0]]: filterIntensityOverlay.intensity }
      : {}),
    params: {
      ...renderFilterConfig.params,
      ...(filterParamOverlay?.params ?? {}),
    },
  })
}
