import type {
  AnimateKeyframe,
  AnimationGroupId,
  AnimationGroupValueMap,
  VisualProps,
} from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'

export type ClipPropertyId = 'transform.rotation' | 'transform.position' | 'transform.size'

export interface DirectPropertyMutationIntent<TValue = unknown> {
  kind: 'direct'
  propertyId: ClipPropertyId
  timelineItemId: string
  frame: number
  value: TValue
  item: UnifiedTimelineItemData<MediaType>
}

export interface PropertyKeyframeToggleIntent {
  kind: 'keyframe-toggle'
  propertyId: ClipPropertyId
  timelineItemId: string
  frame: number
  item: UnifiedTimelineItemData<MediaType>
}

export type PropertyMutationIntent = DirectPropertyMutationIntent | PropertyKeyframeToggleIntent

export interface AnimationGroupPatchOperation<G extends AnimationGroupId = AnimationGroupId> {
  kind: 'static-config-patch'
  timelineItemId: string
  frame: number
  groupId: G
  patch: Partial<AnimationGroupValueMap[G]>
}

export interface VisualConfigPatchOperation {
  kind: 'visual-config-patch'
  timelineItemId: string
  frame: number
  patch: Partial<VisualProps>
}

export interface AnimationKeyframeUpdateOperation<G extends AnimationGroupId = AnimationGroupId> {
  kind: 'animation-keyframe-update'
  timelineItemId: string
  frame: number
  groupId: G
  relativeFrame: number
  value: AnimationGroupValueMap[G]
}

export interface AnimationKeyframeCreateOperation<G extends AnimationGroupId = AnimationGroupId> {
  kind: 'animation-keyframe-create'
  timelineItemId: string
  frame: number
  groupId: G
  keyframe: AnimateKeyframe<MediaType, G>
}

export interface AnimationKeyframeDeleteOperation<G extends AnimationGroupId = AnimationGroupId> {
  kind: 'animation-keyframe-delete'
  timelineItemId: string
  frame: number
  groupId: G
  relativeFrame: number
}

export type ChangeOperation =
  | AnimationGroupPatchOperation
  | VisualConfigPatchOperation
  | AnimationKeyframeUpdateOperation
  | AnimationKeyframeCreateOperation
  | AnimationKeyframeDeleteOperation

export interface ChangePlan {
  propertyId: ClipPropertyId
  description: string
  operations: ChangeOperation[]
}
