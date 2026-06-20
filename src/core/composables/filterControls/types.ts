import type { Ref } from 'vue'
import type { FilterParamColorValue } from '@/core/filter/color'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { DynamicFilterParamPropertyId } from '@/core/property-system/schema/propertyIds'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

export type FilterTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

export interface UnifiedFilterControlsOptions {
  selectedTimelineItem: Ref<FilterTimelineItem | null>
  currentFrame: Ref<number>
}

export type FilterChannelKey = 'filter.intensity' | DynamicFilterParamPropertyId

export type FilterDeferredPatch = Partial<Pick<ClipFilterConfig, 'intensity' | 'params'>>

export interface FilterParamVec2Value {
  x: number
  y: number
}

export type { FilterParamColorValue }
