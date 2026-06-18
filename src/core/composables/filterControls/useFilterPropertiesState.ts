import { computed } from 'vue'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import type { UnifiedFilterControlsOptions } from './types'

export function useFilterPropertiesState(options: UnifiedFilterControlsOptions) {
  const { selectedTimelineItem, currentFrame } = options

  const filterConfig = computed(() =>
    selectedTimelineItem.value
      ? TimelineItemQueries.getRenderFilter(selectedTimelineItem.value)
      : undefined,
  )

  const normalizedFilterConfig = computed(() =>
    normalizeClipFilterConfig(filterConfig.value),
  )

  const hasFilterConfig = computed(() => Boolean(filterConfig.value))

  const canOperateFilterNumbers = computed(() => {
    const item = selectedTimelineItem.value
    if (!item || !hasFilterConfig.value) return false
    return isPlayheadInTimelineItem(item, currentFrame.value)
  })

  return {
    filterConfig,
    normalizedFilterConfig,
    hasFilterConfig,
    canOperateFilterNumbers,
  }
}
