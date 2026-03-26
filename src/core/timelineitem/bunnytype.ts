import type { MediaType } from '@/core/mediaitem'
import type { TextStyleConfig } from './texttype'

export interface VisualProps {
  x: number
  /** 相对画布中心的 Y 坐标；y > 0 表示向上。 */
  y: number
  width: number
  height: number
  /** 旋转角度（角度制，范围：-180° 到 180°） */
  rotation: number
  opacity: number
  /** 等比缩放状态（每个clip独立） */
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

export interface VisualAnimatableProps {
  x: number
  /** 相对画布中心的 Y 坐标；y > 0 表示向上。 */
  y: number
  width: number
  height: number
  /** 旋转角度（角度制，范围：-180° 到 180°） */
  rotation: number
  opacity: number
}

export interface AudioAnimatableProps {
  volume: number
}

export interface LayoutAnimatableProps {
  x: number
  /** 相对画布中心的 Y 坐标；y > 0 表示向上。 */
  y: number
  width: number
  height: number
}

export interface RotationAnimatableProps {
  /** 旋转角度（角度制，范围：-180° 到 180°） */
  rotation: number
}

export interface OpacityAnimatableProps {
  opacity: number
}

export type AnimationChannelKey = 'layout' | 'rotation' | 'opacity' | 'audio'

export type AnimationChannelPropertiesMap = {
  layout: LayoutAnimatableProps
  rotation: RotationAnimatableProps
  opacity: OpacityAnimatableProps
  audio: AudioAnimatableProps
}

export type MediaAnimationChannelMap = {
  video: {
    layout: LayoutAnimatableProps
    rotation: RotationAnimatableProps
    opacity: OpacityAnimatableProps
    audio: AudioAnimatableProps
  }
  image: {
    layout: LayoutAnimatableProps
    rotation: RotationAnimatableProps
    opacity: OpacityAnimatableProps
  }
  audio: {
    audio: AudioAnimatableProps
  }
  text: {
    layout: LayoutAnimatableProps
    rotation: RotationAnimatableProps
    opacity: OpacityAnimatableProps
  }
}

export type ChannelKeyForMedia<T extends MediaType> = Extract<
  keyof MediaAnimationChannelMap[T],
  AnimationChannelKey
>

export type KeyframePropertiesMap = {
  [C in AnimationChannelKey]: AnimationChannelPropertiesMap[C]
}

export interface AnimateKeyframe<
  T extends MediaType,
  C extends AnimationChannelKey = AnimationChannelKey,
> {
  /**
   * 关键帧位置（百分比，0-1 范围）
   * 这是主存储，是真实数据源
   * 0 = clip 开始
   * 1 = clip 结束
   * 0.5 = clip 中点
   */
  position: number
  
  /**
   * 缓存的帧位置（相对于 clip 开始）
   * 这是派生数据，用于快速查找和比较
   * 在创建关键帧或 clip 时长变化时自动更新
   *
   * @internal 不应该直接修改此字段，应该通过修改 position 来更新
   */
  cachedFrame: number
  
  /** 当前通道对应的属性组 */
  properties: KeyframePropertiesMap[C]
}

export interface AnimationChannel<T extends MediaType, C extends AnimationChannelKey> {
  keyframes: AnimateKeyframe<T, C>[]
}

export interface AnimationProps<T extends MediaType> {
  /** 按属性组划分的关键帧通道 */
  channels: Partial<{
    [C in ChannelKeyForMedia<T>]: AnimationChannel<T, C>
  }>
}

type GetConfigMap = {
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
export type GetAnimation<T extends MediaType> = GetAnimationMap[T]

export const VISUAL_CHANNELS = ['layout', 'rotation', 'opacity'] as const
export const ALL_ANIMATION_CHANNELS = ['layout', 'rotation', 'opacity', 'audio'] as const

export const PROPERTY_TO_CHANNEL_MAP = {
  x: 'layout',
  y: 'layout',
  width: 'layout',
  height: 'layout',
  rotation: 'rotation',
  opacity: 'opacity',
  volume: 'audio',
} as const satisfies Record<string, AnimationChannelKey>

export type AnimatablePropertyKey = keyof typeof PROPERTY_TO_CHANNEL_MAP

export function getAnimationChannelForProperty(
  property: string,
): AnimationChannelKey | undefined {
  return PROPERTY_TO_CHANNEL_MAP[property as AnimatablePropertyKey]
}

// 导出具体的配置类型供其他模块使用
export type VideoMediaConfig = GetConfigs<'video'>
export type ImageMediaConfig = GetConfigs<'image'>
export type AudioMediaConfig = GetConfigs<'audio'>
export type TextMediaConfig = GetConfigs<'text'>
