/**
 * 统一时间轴项目查询工具函数
 * 提供各种查询和计算功能的纯函数
 */

import type { MediaType } from '@/core/mediaitem'
import type {
  UnifiedTimelineItemData,
  GetConfigs,
  VisualProps,
  AudioProps,
  TextProps,
  VisualPropPatch,
  AudioPropPatch,
  TimelineExtraRenderConfig,
} from '@/core/timelineitem/type'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
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
  const renderConfig = item.runtime.renderConfig || item.baseRenderConfig
  const positionOverlay = getTransformPositionOverlay(item.id)
  const sizeOverlay = getTransformSizeOverlay(item.id)
  const rotationOverlay = getTransformRotationOverlay(item.id)
  const opacityOverlay = getTransformOpacityOverlay(item.id)
  const volumeOverlay = getAudioVolumeOverlay(item.id)
  if (
    !positionOverlay &&
    !sizeOverlay &&
    !rotationOverlay &&
    !opacityOverlay &&
    !volumeOverlay
  ) {
    return renderConfig
  }

  const nextRenderConfig = { ...renderConfig } as GetConfigs<T>
  const visualRenderConfig = hasVisualRenderConfig(item)
    ? ({ ...getVisualRenderConfig(item, renderConfig) } as VisualProps)
    : null
  const audioRenderConfig = hasAudioRenderConfig(item)
    ? ({ ...getAudioRenderConfig(item, renderConfig) } as AudioProps)
    : null

  if (visualRenderConfig) {
    Object.assign(visualRenderConfig, {
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
        ? {
          [transformRotationSchema.valueFields[0]]: rotationOverlay.rotation,
        }
      : {}),
      ...(opacityOverlay
        ? {
          [transformOpacitySchema.valueFields[0]]: opacityOverlay.opacity,
        }
      : {}),
    })
    ;(nextRenderConfig as { visual: VisualProps }).visual = visualRenderConfig
  }

  if (audioRenderConfig) {
    Object.assign(audioRenderConfig, {
      ...(volumeOverlay
        ? {
          [audioVolumeSchema.valueFields[0]]: volumeOverlay.volume,
        }
      : {}),
    })
    ;(nextRenderConfig as { audio: AudioProps }).audio = audioRenderConfig
  }

  return nextRenderConfig
}

export function getBaseRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
): GetConfigs<T> {
  return item.baseRenderConfig
}

export function getExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
): TimelineExtraRenderConfig | undefined {
  return item.exRenderConfig
}

export function getPersistentMask(item: UnifiedTimelineItemData<MediaType>) {
  if (!hasVisualRenderConfig(item)) {
    return undefined
  }

  const visualConfig = item.baseRenderConfig.visual
  return normalizeMaskConfig(item.exRenderConfig?.mask, {
    width: visualConfig.width,
    height: visualConfig.height,
  })
}

export function hasVisualRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> | UnifiedTimelineItemData<'text'> {
  return hasVisualProperties(item)
}

export function hasAudioRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'> {
  return hasAudioProperties(item)
}

export function hasTextRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'text'> {
  return isTextTimelineItem(item)
}

export function getVisualRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
  config: GetConfigs<T> = getRenderConfig(item),
): VisualProps {
  if (!hasVisualRenderConfig(item) || !('visual' in config)) {
    throw new Error(`Timeline item ${item.id} does not have visual render config`)
  }
  return config.visual
}

export function getAudioRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
  config: GetConfigs<T> = getRenderConfig(item),
): AudioProps {
  if (!hasAudioRenderConfig(item) || !('audio' in config)) {
    throw new Error(`Timeline item ${item.id} does not have audio render config`)
  }
  return config.audio
}

export function getTextRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>,
  config: GetConfigs<T> = getRenderConfig(item),
): TextProps {
  if (!hasTextRenderConfig(item) || !('text' in config)) {
    throw new Error(`Timeline item ${item.id} does not have text render config`)
  }
  return config.text
}

export function patchVisualRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: VisualPropPatch,
): void {
  if (!hasVisualRenderConfig(item)) return
  Object.assign(item.baseRenderConfig.visual, patch)
}

export function patchAudioRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: AudioPropPatch,
): void {
  if (!hasAudioRenderConfig(item)) return
  Object.assign(item.baseRenderConfig.audio, patch)
}

export function patchTextRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: Partial<TextProps>,
): void {
  if (!hasTextRenderConfig(item)) return
  Object.assign(item.baseRenderConfig.text, {
    ...item.baseRenderConfig.text,
    ...patch,
    style: patch.style
      ? { ...item.baseRenderConfig.text.style, ...patch.style }
      : item.baseRenderConfig.text.style,
  })
}

export function patchExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: TimelineExtraRenderConfig,
): void {
  item.exRenderConfig = {
    ...(item.exRenderConfig ?? {}),
    ...patch,
  }
}

export function patchRuntimeExtraRenderConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: TimelineExtraRenderConfig,
): void {
  item.runtime.exRenderConfig = {
    ...(item.runtime.exRenderConfig ?? {}),
    ...patch,
  }
}

export function getRenderMask(item: UnifiedTimelineItemData<MediaType>) {
  if (!hasVisualRenderConfig(item)) {
    return undefined
  }

  const renderConfig = getRenderConfig(item)
  const visualRenderConfig = getVisualRenderConfig(item, renderConfig)
  const renderMask = item.runtime.exRenderConfig?.mask ?? item.exRenderConfig?.mask
  const normalizedMask = normalizeMaskConfig(renderMask, {
    width: visualRenderConfig.width,
    height: visualRenderConfig.height,
  })
  const maskCenterOverlay = getMaskCenterOverlay(item.id)
  const maskFeatherOverlay = getMaskFeatherOverlay(item.id)
  const maskIntensityOverlay = getMaskIntensityOverlay(item.id)
  const maskRectangleSizeOverlay = getMaskRectangleSizeOverlay(item.id)
  const maskRectangleCornerRadiusOverlay = getMaskRectangleCornerRadiusOverlay(item.id)
  const maskMirrorLengthOverlay = getMaskMirrorLengthOverlay(item.id)
  const maskEllipseSizeOverlay = getMaskEllipseSizeOverlay(item.id)
  const maskRotationOverlay = getMaskRotationOverlay(item.id)

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
    return normalizedMask
  }

  return {
    ...normalizedMask,
    ...(maskCenterOverlay
      ? {
          [maskCenterSchema.valueFields[0]]:
            maskCenterOverlay.centerX ?? normalizedMask.centerX,
          [maskCenterSchema.valueFields[1]]:
            maskCenterOverlay.centerY ?? normalizedMask.centerY,
        }
      : {}),
    ...(maskRotationOverlay ? { rotation: maskRotationOverlay.rotation } : {}),
    ...(maskFeatherOverlay
      ? {
          falloff: {
            ...normalizedMask.falloff,
            [maskFeatherSchema.valueFields[0]]:
              maskFeatherOverlay.outerRange ?? normalizedMask.falloff.outerRange,
          },
        }
      : {}),
    ...(maskIntensityOverlay
      ? {
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

export function getRenderTransition(
  item: UnifiedTimelineItemData<MediaType>,
): ClipTransitionOutConfig | undefined {
  return supportsClipTransitionOut(item) ? item.exRenderConfig?.transition : undefined
}

export function getRenderFilterEffect(
  item: UnifiedTimelineItemData<MediaType>,
): ClipFilterConfig | undefined {
  const filter = item.runtime.exRenderConfig?.filter ?? item.exRenderConfig?.filter
  if (!supportsClipFilter(item) || !filter) {
    return undefined
  }

  const renderFilterEffect = filter
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
  getBaseRenderConfig,
  getRenderConfig,
  getExtraRenderConfig,
  getPersistentMask,
  getRenderMask,
  getRenderTransition,
  getRenderFilterEffect,
  hasVisualRenderConfig,
  hasAudioRenderConfig,
  hasTextRenderConfig,
  getVisualRenderConfig,
  getAudioRenderConfig,
  getTextRenderConfig,
  patchVisualRenderConfig,
  patchAudioRenderConfig,
  patchTextRenderConfig,
  patchExtraRenderConfig,
  patchRuntimeExtraRenderConfig,
}
