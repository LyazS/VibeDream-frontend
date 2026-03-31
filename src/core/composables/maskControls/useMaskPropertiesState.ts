import { computed } from 'vue'
import {
  getItemLocalSize,
  isEllipseMaskConfig,
  isMirrorMaskConfig,
  isRectangleMaskConfig,
  normalizeMaskConfig,
} from '@/core/timelineitem/mask'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import type { UnifiedMaskKeyframeControlsOptions } from './types'

export function useMaskPropertiesState(options: UnifiedMaskKeyframeControlsOptions) {
  const { selectedTimelineItem, currentFrame } = options

  const getVisualRenderConfig = () => {
    const item = selectedTimelineItem.value
    if (!item) {
      return { width: 0, height: 0 }
    }

    const renderConfig = TimelineItemQueries.getRenderConfig(item)
    if ('width' in renderConfig && 'height' in renderConfig) {
      return renderConfig
    }

    return { width: 0, height: 0 }
  }

  const itemLocalSize = computed(() => {
    const item = selectedTimelineItem.value
    if (!item) {
      return getItemLocalSize(0, 0)
    }

    const renderConfig = getVisualRenderConfig()
    return getItemLocalSize(renderConfig.width, renderConfig.height)
  })

  const maskConfig = computed(() => {
    const item = selectedTimelineItem.value
    if (!item) {
      return normalizeMaskConfig(undefined, itemLocalSize.value)
    }

    const renderConfig = TimelineItemQueries.getRenderConfig(item)
    return normalizeMaskConfig(
      'mask' in renderConfig
        ? renderConfig.mask
        : 'mask' in item.config
          ? item.config.mask
          : undefined,
      itemLocalSize.value,
    )
  })

  const rectangleMaskConfig = computed(() =>
    isRectangleMaskConfig(maskConfig.value) ? maskConfig.value : null,
  )

  const ellipseMaskConfig = computed(() =>
    isEllipseMaskConfig(maskConfig.value) ? maskConfig.value : null,
  )

  const mirrorMaskConfig = computed(() =>
    isMirrorMaskConfig(maskConfig.value) ? maskConfig.value : null,
  )

  const rectangleCornerRadiusMax = computed(
    () =>
      Math.min(
        rectangleMaskConfig.value?.width ?? 0,
        rectangleMaskConfig.value?.height ?? 0,
      ) * 0.5,
  )

  const canOperateMaskNumbers = computed(() => {
    const item = selectedTimelineItem.value
    if (!item) return false
    return isPlayheadInTimelineItem(item, currentFrame.value)
  })

  return {
    itemLocalSize,
    maskConfig,
    rectangleMaskConfig,
    ellipseMaskConfig,
    mirrorMaskConfig,
    rectangleCornerRadiusMax,
    canOperateMaskNumbers,
  }
}
