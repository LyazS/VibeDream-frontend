import type {
  AnimateKeyframe,
  AudioProps,
  AnimationGroupId,
  AnimationGroupValueMap,
  VisualProps,
} from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'

export type AnimatablePropertyId =
  | 'transform.rotation'
  | 'transform.position'
  | 'transform.size'
  | 'transform.opacity'
  | 'audio.volume'

export type ConfigPropertyId =
  | 'transform.blendMode'
  | 'transform.proportionalScale'
  | 'audio.isMuted'

export type ChangePlanPropertyId = AnimatablePropertyId | ConfigPropertyId

export interface DirectPropertyPlanIntent<TValue = unknown> {
  kind: 'direct'
  propertyId: AnimatablePropertyId
  timelineItemId: string
  frame: number
  value: TValue
  item: UnifiedTimelineItemData<MediaType>
}

export interface PropertyKeyframeTogglePlanIntent {
  kind: 'keyframe-toggle'
  propertyId: AnimatablePropertyId
  timelineItemId: string
  frame: number
  item: UnifiedTimelineItemData<MediaType>
}

export type PropertyPlanIntent = DirectPropertyPlanIntent | PropertyKeyframeTogglePlanIntent

export interface NoAnimationGroupPatchOperation<G extends AnimationGroupId = AnimationGroupId> {
  kind: 'no-animation-group-patch'
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

export interface AudioConfigPatchOperation {
  kind: 'audio-config-patch'
  timelineItemId: string
  frame: number
  patch: Partial<AudioProps>
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
  | NoAnimationGroupPatchOperation
  | VisualConfigPatchOperation
  | AudioConfigPatchOperation
  | AnimationKeyframeUpdateOperation
  | AnimationKeyframeCreateOperation
  | AnimationKeyframeDeleteOperation

export interface ChangePlan {
  propertyId: ChangePlanPropertyId
  description: string
  operations: ChangeOperation[]
}
