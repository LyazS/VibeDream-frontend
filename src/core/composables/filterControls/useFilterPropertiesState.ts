import { computed } from 'vue'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import type { UnifiedFilterControlsOptions } from './types'

export function useFilterPropertiesState(options: UnifiedFilterControlsOptions) {
  const { selectedTimelineItem, currentFrame } = options

  const filterEffect = computed(() =>
    selectedTimelineItem.value
      ? TimelineItemQueries.getRenderFilterEffect(selectedTimelineItem.value)
      : undefined,
  )

  const filterConfig = computed(() =>
    normalizeClipFilterConfig(filterEffect.value),
  )

  const hasFilterEffect = computed(() => Boolean(filterEffect.value))

  const canOperateFilterNumbers = computed(() => {
    const item = selectedTimelineItem.value
    if (!item || !hasFilterEffect.value) return false
    return isPlayheadInTimelineItem(item, currentFrame.value)
  })

  return {
    filterEffect,
    filterConfig,
    hasFilterEffect,
    canOperateFilterNumbers,
  }
}
