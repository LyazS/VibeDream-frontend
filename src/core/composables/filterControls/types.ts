import type { Ref } from 'vue'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

export type FilterTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

export interface UnifiedFilterControlsOptions {
  selectedTimelineItem: Ref<FilterTimelineItem | null>
  currentFrame: Ref<number>
}

export type FilterChannelKey = 'filter.intensity'

export type FilterDeferredPatch = Partial<Pick<ClipFilterConfig, 'intensity' | 'params'>>
