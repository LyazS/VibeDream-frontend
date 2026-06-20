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

export interface TransitionParamVec3Value extends TransitionParamVec2Value {
  z: number
}

export interface TransitionParamVec4Value extends TransitionParamVec3Value {
  w: number
}

export type TransitionParamVectorValue =
  | TransitionParamVec2Value
  | TransitionParamVec3Value
  | TransitionParamVec4Value

export type TransitionDeferredPatch = Partial<Pick<ClipTransitionOutConfig, 'params'>>

export type { FilterParamColorValue }
