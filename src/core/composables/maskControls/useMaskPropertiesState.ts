import { computed } from 'vue'
import {
  getItemLocalSize,
  isEllipseMaskConfig,
  isMirrorMaskConfig,
  isRectangleMaskConfig,
  normalizeMaskConfig,
} from '@/core/timelineitem/features/mask'
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

    if (TimelineItemQueries.hasVisualProperties(item)) {
      return TimelineItemQueries.getRenderConfig(item).visual
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

    return normalizeMaskConfig(
      TimelineItemQueries.getRenderMask(item),
      itemLocalSize.value,
    )
  })

  const hasMaskConfig = computed(() => {
    const item = selectedTimelineItem.value
    return Boolean(item && TimelineItemQueries.getMask(item))
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

  const canOperateMaskNumbers = computed(() => {
    const item = selectedTimelineItem.value
    if (!item) return false
    return isPlayheadInTimelineItem(item, currentFrame.value)
  })

  return {
    itemLocalSize,
    maskConfig,
    hasMaskConfig,
    rectangleMaskConfig,
    ellipseMaskConfig,
    mirrorMaskConfig,
    canOperateMaskNumbers,
  }
}
