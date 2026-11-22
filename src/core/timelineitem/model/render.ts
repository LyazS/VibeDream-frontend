/**
 * 渲染配置与动画类型定义。
 */

import type { MediaType } from '@/core/mediaitem'
import type { BlendMode } from './blendMode'

export interface VisualProps {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  blendIntensity: number
  blendMode: BlendMode
  proportionalScale: boolean
}

export interface AudioProps {
  volume: number
  isMuted: boolean
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

export interface BlendIntensityAnimatableProps {
  blendIntensity: number
}

export interface AudioAnimatableProps {
  volume: number
}

export type AnimationGroupValueMap = {
  'visual.position': PositionAnimatableProps
  'visual.size': SizeAnimatableProps
  'visual.rotation': RotationAnimatableProps
  'visual.blendIntensity': BlendIntensityAnimatableProps
  'audio.volume': AudioAnimatableProps
}

export type AnimationGroupId = keyof AnimationGroupValueMap
export type PropertyAnimationGroupId = AnimationGroupId
export type AnimationChannelKey = PropertyAnimationGroupId

export function normalizeAnimationGroupId(groupId: AnimationChannelKey): PropertyAnimationGroupId {
  return groupId
}

export type AnimationValueByGroup<G extends AnimationGroupId> = AnimationGroupValueMap[G]
export type PropertyAnimationValueByGroup<G extends PropertyAnimationGroupId> = AnimationGroupValueMap[G]

export interface EasingSpec {
  type: 'linear'
}

export interface AnimateKeyframe<
  _T extends MediaType,
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
    'visual.position': PositionAnimatableProps
    'visual.size': SizeAnimatableProps
    'visual.rotation': RotationAnimatableProps
    'visual.blendIntensity': BlendIntensityAnimatableProps
    'audio.volume': AudioAnimatableProps
  }
  image: {
    'visual.position': PositionAnimatableProps
    'visual.size': SizeAnimatableProps
    'visual.rotation': RotationAnimatableProps
    'visual.blendIntensity': BlendIntensityAnimatableProps
  }
  audio: {
    'audio.volume': AudioAnimatableProps
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
}

type GetAnimationMap = {
  video: AnimationProps<'video'>
  image: AnimationProps<'image'>
  audio: AnimationProps<'audio'>
}

export type TimelineBaseRenderConfig<T extends MediaType> = TimelineBaseRenderConfigMap[T]
export type GetAnimation<T extends MediaType> = GetAnimationMap[T]

export const VISUAL_CHANNELS = [
  'visual.position',
  'visual.size',
  'visual.rotation',
  'visual.blendIntensity',
] as const satisfies readonly AnimationGroupId[]

export const ALL_ANIMATION_GROUPS = [
  'visual.position',
  'visual.size',
  'visual.rotation',
  'visual.blendIntensity',
  'audio.volume',
] as const satisfies readonly AnimationGroupId[]

export const PROPERTY_TO_GROUP_MAP = {
  x: 'visual.position',
  y: 'visual.position',
  width: 'visual.size',
  height: 'visual.size',
  rotation: 'visual.rotation',
  blendIntensity: 'visual.blendIntensity',
  volume: 'audio.volume',
} as const satisfies Record<string, AnimationGroupId>

export type AnimatablePropertyKey = keyof typeof PROPERTY_TO_GROUP_MAP

export function getAnimationGroupForProperty(property: string): AnimationGroupId | undefined {
  return PROPERTY_TO_GROUP_MAP[property as AnimatablePropertyKey]
}

export type VideoMediaConfig = TimelineBaseRenderConfig<'video'>
export type ImageMediaConfig = TimelineBaseRenderConfig<'image'>
export type AudioMediaConfig = TimelineBaseRenderConfig<'audio'>
