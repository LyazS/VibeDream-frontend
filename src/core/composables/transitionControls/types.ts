import type { Ref } from 'vue'
import type { FilterParamColorValue } from '@/core/filter/color'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

export type TransitionTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

export interface UnifiedTransitionControlsOptions {
  selectedTimelineItem: Ref<TransitionTimelineItem | null>
}

export interface TransitionParamVec2Value {
  x: number
  y: number
}

export type TransitionDeferredPatch = Partial<Pick<ClipTransitionOutConfig, 'params'>>

export type { FilterParamColorValue }
