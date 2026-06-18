import type {
  AnimateKeyframe,
  AudioProps,
  AnimationGroupId,
  AnimationGroupValueMap,
  PropertyAnimationGroupId,
  PropertyAnimationValueByGroup,
  VisualProps,
} from '@/core/timelineitem/model/render'
import type { AnimatablePropertyTarget } from '@/core/property-system/schema'
import type { DynamicFilterParamPropertyId } from '@/core/property-system/schema/propertyIds'
import type { MediaType } from '@/core/mediaitem'
import type { TimelineExtraRenderConfig, UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

export type AnimatablePropertyId =
  | 'transform.rotation'
  | 'transform.position'
  | 'transform.size'
  | 'transform.opacity'
  | 'filter.intensity'
  | DynamicFilterParamPropertyId
  | 'audio.volume'
  | 'mask.rotation'
  | 'mask.center'
  | 'mask.rectangle.size'
  | 'mask.rectangle.cornerRadius'
  | 'mask.ellipse.size'
  | 'mask.mirror.length'
  | 'mask.feather'
  | 'mask.intensity'

export type ConfigPropertyId =
  | 'transform.blendMode'
  | 'transform.proportionalScale'
  | 'audio.isMuted'
  | 'mask.enabled'
  | 'mask.type'
  | 'mask.inverted'

export type DirectOnlyPropertyId =
  | 'text.content'
  | 'text.style.fontSize'
  | 'text.style.fontFamily'
  | 'text.style.fontWeight'
  | 'text.style.fontStyle'
  | 'text.style.color'
  | 'text.style.backgroundColor'
  | 'text.style.textAlign'
  | 'text.style.textShadow'
  | 'text.style.textStroke'
  | 'text.style.textGlow'

export type DirectPropertyId = AnimatablePropertyId | DirectOnlyPropertyId

export type ChangePlanPropertyId = DirectPropertyId | ConfigPropertyId | 'filter.batch'

export interface DirectPropertyPlanIntent<TValue = unknown> {
  kind: 'direct'
  propertyId: DirectPropertyId
  timelineItemId: string
  frame: number
  value: TValue
  item: UnifiedTimelineItemData<MediaType>
}

export interface DirectPropertyBatchPlanEntry<TValue = unknown> {
  propertyId: DirectPropertyId
  value: TValue
}

export interface DirectPropertyBatchPlanIntent {
  timelineItemId: string
  frame: number
  item: UnifiedTimelineItemData<MediaType>
  entries: DirectPropertyBatchPlanEntry[]
  description?: string
}

export interface PropertyKeyframeTogglePlanIntent {
  kind: 'keyframe-toggle'
  propertyId: AnimatablePropertyId
  timelineItemId: string
  frame: number
  item: UnifiedTimelineItemData<MediaType>
}

export type PropertyPlanIntent = DirectPropertyPlanIntent | PropertyKeyframeTogglePlanIntent

export type FilterEffectPatch = {
  intensity?: number
  params?: Record<string, unknown>
}

export interface NoAnimationGroupPatchOperation<G extends PropertyAnimationGroupId = PropertyAnimationGroupId> {
  kind: 'no-animation-group-patch'
  timelineItemId: string
  frame: number
  groupId?: G
  target: AnimatablePropertyTarget
  patch: G extends AnimationGroupId ? Partial<AnimationGroupValueMap[G]> | FilterEffectPatch : FilterEffectPatch
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

export interface ExtraRenderConfigPatchOperation {
  kind: 'extra-render-config-patch'
  timelineItemId: string
  frame: number
  patch: Partial<TimelineExtraRenderConfig>
}

export interface AnimationKeyframeUpdateOperation<G extends PropertyAnimationGroupId = PropertyAnimationGroupId> {
  kind: 'animation-keyframe-update'
  timelineItemId: string
  frame: number
  groupId: G
  relativeFrame: number
  value: PropertyAnimationValueByGroup<G>
}

export interface AnimationKeyframeCreateOperation<G extends PropertyAnimationGroupId = PropertyAnimationGroupId> {
  kind: 'animation-keyframe-create'
  timelineItemId: string
  frame: number
  groupId: G
  keyframe: AnimateKeyframe<MediaType, G>
}

export interface AnimationKeyframeDeleteOperation<G extends PropertyAnimationGroupId = PropertyAnimationGroupId> {
  kind: 'animation-keyframe-delete'
  timelineItemId: string
  frame: number
  groupId: G
  relativeFrame: number
}

export interface TextRebuildOperation {
  kind: 'text-rebuild'
  timelineItemId: string
  frame: number
  text?: string
  stylePatch?: Record<string, unknown>
}

export type ChangeOperation =
  | NoAnimationGroupPatchOperation
  | VisualConfigPatchOperation
  | AudioConfigPatchOperation
  | ExtraRenderConfigPatchOperation
  | AnimationKeyframeUpdateOperation
  | AnimationKeyframeCreateOperation
  | AnimationKeyframeDeleteOperation
  | TextRebuildOperation

export interface ChangePlan {
  propertyId: ChangePlanPropertyId
  description: string
  operations: ChangeOperation[]
}
