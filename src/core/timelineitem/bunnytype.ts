import type { MediaType } from '@/core/mediaitem'
import { isFilterParamPropertyId } from '@/core/property-system/schema/propertyIds'
import type { TextStyleConfig } from './texttype'
import type { BlendMode } from './blendMode'
import type {
  MaskCenterValue,
  MaskConfig,
  MaskEllipseSizeValue,
  MaskFeatherValue,
  MaskIntensityValue,
  MaskMirrorValue,
  MaskRectangleCornerRadiusValue,
  MaskRectangleSizeValue,
  MaskRotationValue,
  MaskType,
} from './mask'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { ClipFilterConfig } from '@/core/filter/types'

export type {
  MaskConfig,
  MaskCenterValue,
  MaskRotationValue,
  MaskFeatherValue,
  MaskIntensityValue,
  MaskRectangleSizeValue,
  MaskRectangleCornerRadiusValue,
  MaskEllipseSizeValue,
  MaskMirrorValue,
  MaskType,
} from './mask'

export interface VisualProps {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  blendMode: BlendMode
  proportionalScale: boolean
}

export interface AudioProps {
  volume: number
  isMuted: boolean
}

export interface TextProps {
  text: string
  style: TextStyleConfig
}

export interface PositionAnimatableProps {
  x: number
  y: number
}

export interface SizeAnimatableProps {
  width: number
  height: number
}

export interface RotationAnimatableProps {
  rotation: number
}

export interface OpacityAnimatableProps {
  opacity: number
}

export interface AudioAnimatableProps {
  volume: number
}

export interface FilterIntensityValue {
  intensity: number
}

export type DynamicFilterParamAnimationGroupId = `filter.param.${string}`

export interface DynamicFilterParamNumberValue {
  value: number
}

export interface DynamicFilterParamVec2Value {
  x: number
  y: number
}

export type DynamicFilterParamValue =
  | DynamicFilterParamNumberValue
  | DynamicFilterParamVec2Value

export type AnimationGroupValueMap = {
  'transform.position': PositionAnimatableProps
  'transform.size': SizeAnimatableProps
  'transform.rotation': RotationAnimatableProps
  'transform.opacity': OpacityAnimatableProps
  'audio.volume': AudioAnimatableProps
  'filter.intensity': FilterIntensityValue
  'mask.center': MaskCenterValue
  'mask.rotation': MaskRotationValue
  'mask.feather': MaskFeatherValue
  'mask.intensity': MaskIntensityValue
  'mask.rectangle.size': MaskRectangleSizeValue
  'mask.rectangle.cornerRadius': MaskRectangleCornerRadiusValue
  'mask.ellipse.size': MaskEllipseSizeValue
  'mask.linear': Record<string, never>
  'mask.mirror.length': MaskMirrorValue
}

export type AnimationGroupId = keyof AnimationGroupValueMap
export type DynamicAnimationGroupId = DynamicFilterParamAnimationGroupId
export type PropertyAnimationGroupId = AnimationGroupId | DynamicAnimationGroupId
export type AnimationChannelKey = PropertyAnimationGroupId

export function isDynamicFilterParamAnimationGroupId(
  groupId: string,
): groupId is DynamicFilterParamAnimationGroupId {
  return isFilterParamPropertyId(groupId)
}

export function normalizeAnimationGroupId(groupId: AnimationChannelKey): PropertyAnimationGroupId {
  return groupId
}

export interface EasingSpec {
  type: 'linear'
}

export type AnimationValueByGroup<G extends AnimationGroupId> = AnimationGroupValueMap[G]
export type PropertyAnimationValueByGroup<G extends PropertyAnimationGroupId> =
  G extends AnimationGroupId ? AnimationGroupValueMap[G] : DynamicFilterParamValue

export interface AnimateKeyframe<
  T extends MediaType,
  G extends PropertyAnimationGroupId = AnimationGroupId,
> {
  position: number
  frame: number
  cachedFrame: number
  value: PropertyAnimationValueByGroup<G>
  easing?: EasingSpec
  properties: PropertyAnimationValueByGroup<G>
}

export interface AnimationGroupTrack<
  T extends MediaType,
  G extends PropertyAnimationGroupId = AnimationGroupId,
> {
  groupId: G
  strategyKey: G
  keyframes: Array<AnimateKeyframe<T, G>>
}

export type MediaAnimationGroupMap = {
  video: {
    'transform.position': PositionAnimatableProps
    'transform.size': SizeAnimatableProps
    'transform.rotation': RotationAnimatableProps
    'transform.opacity': OpacityAnimatableProps
    'audio.volume': AudioAnimatableProps
    'filter.intensity': FilterIntensityValue
    'mask.center': MaskCenterValue
    'mask.rotation': MaskRotationValue
    'mask.feather': MaskFeatherValue
    'mask.intensity': MaskIntensityValue
    'mask.rectangle.size': MaskRectangleSizeValue
    'mask.rectangle.cornerRadius': MaskRectangleCornerRadiusValue
    'mask.ellipse.size': MaskEllipseSizeValue
    'mask.linear': Record<string, never>
    'mask.mirror.length': MaskMirrorValue
  }
  image: {
    'transform.position': PositionAnimatableProps
    'transform.size': SizeAnimatableProps
    'transform.rotation': RotationAnimatableProps
    'transform.opacity': OpacityAnimatableProps
    'filter.intensity': FilterIntensityValue
    'mask.center': MaskCenterValue
    'mask.rotation': MaskRotationValue
    'mask.feather': MaskFeatherValue
    'mask.intensity': MaskIntensityValue
    'mask.rectangle.size': MaskRectangleSizeValue
    'mask.rectangle.cornerRadius': MaskRectangleCornerRadiusValue
    'mask.ellipse.size': MaskEllipseSizeValue
    'mask.linear': Record<string, never>
    'mask.mirror.length': MaskMirrorValue
  }
  audio: {
    'audio.volume': AudioAnimatableProps
  }
  text: {
    'transform.position': PositionAnimatableProps
    'transform.size': SizeAnimatableProps
    'transform.rotation': RotationAnimatableProps
    'transform.opacity': OpacityAnimatableProps
    'mask.center': MaskCenterValue
    'mask.rotation': MaskRotationValue
    'mask.feather': MaskFeatherValue
    'mask.intensity': MaskIntensityValue
    'mask.rectangle.size': MaskRectangleSizeValue
    'mask.rectangle.cornerRadius': MaskRectangleCornerRadiusValue
    'mask.ellipse.size': MaskEllipseSizeValue
    'mask.linear': Record<string, never>
    'mask.mirror.length': MaskMirrorValue
  }
}

export type GroupKeyForMedia<T extends MediaType> = Extract<
  keyof MediaAnimationGroupMap[T],
  AnimationGroupId
>
export type ChannelKeyForMedia<T extends MediaType> = GroupKeyForMedia<T>

export type AnimationChannelPropertiesMap = AnimationGroupValueMap
export type KeyframePropertiesMap = AnimationGroupValueMap

export interface AnimationProps<T extends MediaType> {
  groups: Partial<{
    [G in GroupKeyForMedia<T>]: AnimationGroupTrack<T, G>
  }>
}

export type TimelineBaseRenderConfigMap = {
  video: {
    visual: VisualProps
    audio: AudioProps
  }
  image: {
    visual: VisualProps
  }
  audio: {
    audio: AudioProps
  }
  text: {
    visual: VisualProps
    text: TextProps
  }
}

export interface TimelineExtraRenderConfig {
  mask?: MaskConfig
  transition?: ClipTransitionOutConfig
  filter?: ClipFilterConfig
}

type GetConfigMap = TimelineBaseRenderConfigMap

type LegacyFlatConfigMap = {
  video: VisualProps & AudioProps
  image: VisualProps
  audio: AudioProps
  text: VisualProps & TextProps
}

type GetAnimationMap = {
  video: AnimationProps<'video'>
  image: AnimationProps<'image'>
  audio: AnimationProps<'audio'>
  text: AnimationProps<'text'>
}

export type GetConfigs<T extends MediaType> = GetConfigMap[T]
export type TimelineBaseRenderConfig<T extends MediaType> = TimelineBaseRenderConfigMap[T]
export type GetAnimation<T extends MediaType> = GetAnimationMap[T]

export const VISUAL_CHANNELS = [
  'transform.position',
  'transform.size',
  'transform.rotation',
  'transform.opacity',
] as const satisfies readonly AnimationGroupId[]

export const ALL_ANIMATION_GROUPS = [
  'transform.position',
  'transform.size',
  'transform.rotation',
  'transform.opacity',
  'audio.volume',
  'filter.intensity',
  'mask.center',
  'mask.rotation',
  'mask.feather',
  'mask.intensity',
  'mask.rectangle.size',
  'mask.rectangle.cornerRadius',
  'mask.ellipse.size',
  'mask.linear',
  'mask.mirror.length',
] as const satisfies readonly AnimationGroupId[]

export const PROPERTY_TO_GROUP_MAP = {
  x: 'transform.position',
  y: 'transform.position',
  width: 'transform.size',
  height: 'transform.size',
  rotation: 'transform.rotation',
  opacity: 'transform.opacity',
  volume: 'audio.volume',
  'filter.intensity': 'filter.intensity',
  'mask.centerX': 'mask.center',
  'mask.centerY': 'mask.center',
  'mask.rotation': 'mask.rotation',
  'mask.outerRange': 'mask.feather',
  'mask.decayRate': 'mask.intensity',
  'mask.width': 'mask.rectangle.size',
  'mask.height': 'mask.rectangle.size',
  'mask.cornerRadius': 'mask.rectangle.cornerRadius',
  'mask.ellipseWidth': 'mask.ellipse.size',
  'mask.ellipseHeight': 'mask.ellipse.size',
  'mask.length': 'mask.mirror.length',
} as const satisfies Record<string, AnimationGroupId>

export type AnimatablePropertyKey = keyof typeof PROPERTY_TO_GROUP_MAP

export function getAnimationGroupForProperty(
  property: string,
): AnimationGroupId | undefined {
  return PROPERTY_TO_GROUP_MAP[property as AnimatablePropertyKey]
}

export type VideoMediaConfig = TimelineBaseRenderConfig<'video'>
export type ImageMediaConfig = TimelineBaseRenderConfig<'image'>
export type AudioMediaConfig = TimelineBaseRenderConfig<'audio'>
export type TextMediaConfig = TimelineBaseRenderConfig<'text'>
export type LegacyFlatConfig<T extends MediaType> = LegacyFlatConfigMap[T]
