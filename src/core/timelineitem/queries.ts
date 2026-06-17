/**
 * 统一时间轴项目查询工具函数
 * 提供各种查询和计算功能的纯函数
 */

import type { MediaType } from '@/core/mediaitem'
import type {
  UnifiedTimelineItemData,
  TimelineItemStatus,
  GetConfigs,
  TimelineExtraRenderConfig,
} from '@/core/timelineitem/type'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { MaskConfig } from '@/core/timelineitem/mask'
import { TimelineStatusDisplayUtils } from '@/core/timelineitem/statusdisplayutils'
import { useUnifiedStore } from '@/core/unifiedStore'
import { supportsClipTransitionOut as itemSupportsClipTransitionOut } from '@/core/timelineitem/transition'
import { supportsClipFilter as itemSupportsClipFilter } from '@/core/timelineitem/filter'
import {
  getFilterIntensityOverlay,
  getFilterParamOverlay,
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
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import {
  isEllipseMaskConfig,
  isMirrorMaskConfig,
  isRectangleMaskConfig,
  normalizeMaskConfig,
} from '@/core/timelineitem/mask'

// ==================== 类型守卫函数 ====================

/**
 * 媒体类型特定的类型守卫
 */
export function isVideoTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> {
  return item.mediaType === 'video'
}

export function isImageTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'image'> {
  return item.mediaType === 'image'
}

export function isAudioTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'audio'> {
  return item.mediaType === 'audio'
}

export function isTextTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'text'> {
  return item.mediaType === 'text'
}

/**
 * 检查是否为具有视觉属性的时间轴项目（video, image, text）
 */
export function hasVisualProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>
  | UnifiedTimelineItemData<'text'> {
  return isVideoTimelineItem(item) || isImageTimelineItem(item) || isTextTimelineItem(item)
}

/**
 * 检查是否为具有音频属性的时间轴项目（video, audio）
 */
export function hasAudioProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'> {
  return isVideoTimelineItem(item) || isAudioTimelineItem(item)
}

export function supportsClipTransitionOut(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> {
  return itemSupportsClipTransitionOut(item)
}

export function supportsClipFilter(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> {
  return itemSupportsClipFilter(item)
}

// ==================== 状态查询函数 ====================

/**
 * 检查是否为就绪状态
 */
export function isReady(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'ready'
}

/**
 * 检查是否正在加载
 */
export function isLoading(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'loading'
}

/**
 * 检查是否有错误
 */
export function hasError(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'error'
}

/**
 * 检查是否可以编辑
 */
export function canEdit(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus !== 'loading'
}

/**
 * 获取状态显示文本
 */
export function getStatusText(data: UnifiedTimelineItemData<MediaType>): string {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  return mediaData ? TimelineStatusDisplayUtils.getStatusText(mediaData) : '未知状态'
}

/**
 * 获取进度信息
 */
export function getProgressInfo(data: UnifiedTimelineItemData<MediaType>): {
  hasProgress: boolean
  percent: number
  text: string
} {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  if (!mediaData) {
    return { hasProgress: false, percent: 0, text: '' }
  }

  const progressInfo = TimelineStatusDisplayUtils.getProgressInfo(mediaData)
  if (!progressInfo.hasProgress) {
    return { hasProgress: false, percent: 0, text: '' }
  }

  const text = progressInfo.speed
    ? `${progressInfo.percent}% (${progressInfo.speed})`
    : `${progressInfo.percent}%`

  return {
    hasProgress: true,
    percent: progressInfo.percent,
    text,
  }
}

/**
 * 获取错误信息
 */
export function getErrorInfo(data: UnifiedTimelineItemData<MediaType>): {
  hasError: boolean
  message: string
  recoverable: boolean
} {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  if (!mediaData) {
    return { hasError: false, message: '', recoverable: false }
  }

  const errorInfo = TimelineStatusDisplayUtils.getErrorInfo(mediaData)
  return {
    hasError: errorInfo.hasError,
    message: errorInfo.message || '',
    recoverable: errorInfo.recoverable || false,
  }
}

// ==================== 配置访问函数 ====================

export function getExtraRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  return item.exRenderConfig
}

export function getRenderExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): TimelineExtraRenderConfig | undefined {
  if (!item) {
    return undefined
  }

  const persistentConfig = item.exRenderConfig
  const runtimeConfig = item.runtime.exRenderConfig

  return {
    filter: runtimeConfig.filter ?? persistentConfig.filter,
    transition: runtimeConfig.transition ?? persistentConfig.transition,
    mask: runtimeConfig.mask ?? persistentConfig.mask,
  }
}

export function getTransition(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipTransitionOutConfig | undefined {
  return item?.exRenderConfig.transition
}

export function getRenderTransition(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipTransitionOutConfig | undefined {
  return getRenderExtraRenderConfig(item)?.transition
}

export function getFilter(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipFilterConfig | undefined {
  if (!item || !supportsClipFilter(item)) {
    return undefined
  }

  return item.exRenderConfig.filter
}

export function getMask(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): MaskConfig | undefined {
  if (!item || !hasVisualProperties(item)) {
    return undefined
  }

  return item.exRenderConfig.mask
}

/**
 * 获取用于渲染的配置
 * 优先返回 renderConfig（包含动画插值），否则返回 config
 *
 * @param item 时间轴项目
 * @returns 用于渲染的配置对象
 */
export function getRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>
): GetConfigs<T> {
  const renderConfig = item.runtime.renderConfig || item.config
  const positionOverlay = getTransformPositionOverlay(item.id)
  const sizeOverlay = getTransformSizeOverlay(item.id)
  const rotationOverlay = getTransformRotationOverlay(item.id)
  const opacityOverlay = getTransformOpacityOverlay(item.id)
  const volumeOverlay = getAudioVolumeOverlay(item.id)
  if (!positionOverlay && !sizeOverlay && !rotationOverlay && !opacityOverlay && !volumeOverlay) {
    return renderConfig
  }

  const visualRenderConfig = hasVisualProperties(item)
    ? (renderConfig as typeof renderConfig & {
        x: number
        y: number
        width: number
        height: number
        rotation: number
        opacity: number
      })
    : null

  return {
    ...renderConfig,
    ...(positionOverlay && visualRenderConfig
      ? {
          [transformPositionSchema.valueFields[0]]: positionOverlay.x ?? visualRenderConfig.x,
          [transformPositionSchema.valueFields[1]]: positionOverlay.y ?? visualRenderConfig.y,
        }
      : {}),
    ...(sizeOverlay && visualRenderConfig
      ? {
          [transformSizeSchema.valueFields[0]]: sizeOverlay.width ?? visualRenderConfig.width,
          [transformSizeSchema.valueFields[1]]: sizeOverlay.height ?? visualRenderConfig.height,
        }
      : {}),
    ...(rotationOverlay && visualRenderConfig
      ? {
          [transformRotationSchema.valueFields[0]]: rotationOverlay.rotation,
        }
      : {}),
    ...(opacityOverlay && visualRenderConfig
      ? {
          [transformOpacitySchema.valueFields[0]]: opacityOverlay.opacity,
        }
      : {}),
    ...(volumeOverlay && hasAudioProperties(item)
      ? {
          [audioVolumeSchema.valueFields[0]]: volumeOverlay.volume,
        }
      : {}),
  } as GetConfigs<T>
}

export function getRenderMask(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): MaskConfig | undefined {
  if (!item || !hasVisualProperties(item)) {
    return undefined
  }

  const renderConfig = getRenderConfig(item)
  const maskCenterOverlay = getMaskCenterOverlay(item.id)
  const maskFeatherOverlay = getMaskFeatherOverlay(item.id)
  const maskIntensityOverlay = getMaskIntensityOverlay(item.id)
  const maskRectangleSizeOverlay = getMaskRectangleSizeOverlay(item.id)
  const maskRectangleCornerRadiusOverlay = getMaskRectangleCornerRadiusOverlay(item.id)
  const maskMirrorLengthOverlay = getMaskMirrorLengthOverlay(item.id)
  const maskEllipseSizeOverlay = getMaskEllipseSizeOverlay(item.id)
  const maskRotationOverlay = getMaskRotationOverlay(item.id)
  const renderMask = getRenderExtraRenderConfig(item)?.mask

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
    width: renderConfig.width,
    height: renderConfig.height,
  })

  return {
    ...normalizedMask,
    ...(maskCenterOverlay
      ? {
          [maskCenterSchema.valueFields[0]]: maskCenterOverlay.centerX ?? normalizedMask.centerX,
          [maskCenterSchema.valueFields[1]]: maskCenterOverlay.centerY ?? normalizedMask.centerY,
        }
      : {}),
    ...(maskRotationOverlay
      ? {
          rotation: maskRotationOverlay.rotation,
        }
      : {}),
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
          [maskRectangleSizeSchema.valueFields[0]]:
            maskRectangleSizeOverlay.width ?? normalizedMask.width,
          [maskRectangleSizeSchema.valueFields[1]]:
            maskRectangleSizeOverlay.height ?? normalizedMask.height,
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
          [maskMirrorLengthSchema.valueFields[0]]:
            maskMirrorLengthOverlay.length ?? normalizedMask.length,
        }
      : {}),
    ...(maskEllipseSizeOverlay && isEllipseMaskConfig(normalizedMask)
      ? {
          [maskEllipseSizeSchema.valueFields[0]]:
            maskEllipseSizeOverlay.ellipseWidth ?? normalizedMask.ellipseWidth,
          [maskEllipseSizeSchema.valueFields[1]]:
            maskEllipseSizeOverlay.ellipseHeight ?? normalizedMask.ellipseHeight,
        }
      : {}),
  }
}

export function getRenderFilter(
  item: UnifiedTimelineItemData<MediaType> | null | undefined,
): ClipFilterConfig | undefined {
  if (!item || !supportsClipFilter(item)) {
    return undefined
  }

  const renderFilterEffect = getRenderExtraRenderConfig(item)?.filter

  if (!renderFilterEffect) {
    return undefined
  }

  const filterIntensityOverlay = getFilterIntensityOverlay(item.id)
  const filterParamOverlay = getFilterParamOverlay(item.id)

  if (!filterIntensityOverlay && !filterParamOverlay) {
    return renderFilterEffect
  }

  return normalizeClipFilterConfig({
    ...renderFilterEffect,
    ...(filterIntensityOverlay
      ? { [filterIntensitySchema.valueFields[0]]: filterIntensityOverlay.intensity }
      : {}),
    params: {
      ...renderFilterEffect.params,
      ...(filterParamOverlay?.params ?? {}),
    },
  })
}

// ==================== 导出查询工具集合 ====================

export const TimelineItemQueries = {
  // 类型守卫
  isVideoTimelineItem,
  isImageTimelineItem,
  isAudioTimelineItem,
  isTextTimelineItem,
  hasVisualProperties,
  hasAudioProperties,
  supportsClipTransitionOut,
  supportsClipFilter,

  // 状态查询
  isReady,
  isLoading,
  hasError,
  canEdit,
  getStatusText,
  getProgressInfo,
  getErrorInfo,
  
  // 配置访问
  getExtraRenderConfig,
  getRenderExtraRenderConfig,
  getTransition,
  getRenderTransition,
  getFilter,
  getMask,
  getRenderFilter,
  getRenderMask,
  getRenderConfig,
}
