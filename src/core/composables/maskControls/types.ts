import type { Ref } from 'vue'
import type { MediaType } from '@/core/mediaitem'
import type { AnimateKeyframe, AnimationChannelKey } from '@/core/timelineitem/bunnytype'
import type { MaskPropertyPath } from '@/core/timelineitem/mask'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

export interface UnifiedMaskKeyframeControlsOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

export type MaskChannelKey =
  | 'mask.center'
  | 'mask.rotation'
  | 'mask.feather'
  | 'mask.intensity'
  | 'mask.rectangle.size'
  | 'mask.rectangle.cornerRadius'
  | 'mask.ellipse.size'
  | 'mask.mirror.length'

export type MaskDeferredPatch = Partial<Record<MaskPropertyPath, number>>

export type MaskDragKeyframe = AnimateKeyframe<MediaType, AnimationChannelKey>

export type MaskChannelDragState = {
  channel: AnimationChannelKey
  initialValues: Partial<Record<MaskPropertyPath, number>>
  createdKeyframe: MaskDragKeyframe | null
  initialButtonState: 'none' | 'on-keyframe' | 'between-keyframes' | null
}

export type MaskInteractionState = {
  isActive: boolean
  channels: Partial<Record<AnimationChannelKey, MaskChannelDragState>>
  pendingPatch: MaskDeferredPatch
}
