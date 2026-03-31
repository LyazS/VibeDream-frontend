/**
 * 动画插值工具函数
 * 按属性组通道独立插值，再合并到 renderConfig。
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type {
  AnimateKeyframe,
  AnimationChannelKey,
  LayoutAnimatableProps,
  RotationAnimatableProps,
  OpacityAnimatableProps,
  AudioAnimatableProps,
  MaskCenterAnimatableProps,
  MaskRotationAnimatableProps,
  MaskOuterRangeAnimatableProps,
  MaskDecayRateAnimatableProps,
  MaskRectangleSizeAnimatableProps,
  MaskRectangleCornerAnimatableProps,
  MaskEllipseSizeAnimatableProps,
  MaskMirrorLengthAnimatableProps,
} from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import { absoluteFrameToRelativeFrame } from './unifiedKeyframeUtils'
import { frameToPercentage } from './keyframePositionUtils'
import { type MaskPropertyPath, normalizeMaskConfig, setMaskPropertyValue } from '@/core/timelineitem/mask'

type InterpolatedKeyframe = AnimateKeyframe<MediaType, AnimationChannelKey>
type AnimationChannelEntry = { keyframes: InterpolatedKeyframe[] }
type AnimationChannelsMap = Partial<Record<AnimationChannelKey, AnimationChannelEntry>>
type InterpolatableProperties =
  | LayoutAnimatableProps
  | RotationAnimatableProps
  | OpacityAnimatableProps
  | AudioAnimatableProps
  | MaskCenterAnimatableProps
  | MaskRotationAnimatableProps
  | MaskOuterRangeAnimatableProps
  | MaskDecayRateAnimatableProps
  | MaskRectangleSizeAnimatableProps
  | MaskRectangleCornerAnimatableProps
  | MaskEllipseSizeAnimatableProps
  | MaskMirrorLengthAnimatableProps

function createBaseRenderConfig(item: UnifiedTimelineItemData<MediaType>) {
  const baseConfig = { ...item.config }
  if ('mask' in baseConfig) {
    const itemLocalSize =
      'width' in item.config && 'height' in item.config
        ? { width: item.config.width, height: item.config.height }
        : undefined
    ;(baseConfig as { mask?: ReturnType<typeof normalizeMaskConfig> }).mask = normalizeMaskConfig(
      (item.config as { mask?: unknown }).mask as never,
      itemLocalSize,
    )
  }
  return baseConfig
}

function applyAnimatedPropsToRenderConfig(
  renderConfig: Record<string, unknown>,
  animatedProps: Record<string, number>,
): void {
  const itemLocalSize =
    typeof renderConfig.width === 'number' && typeof renderConfig.height === 'number'
      ? { width: renderConfig.width, height: renderConfig.height }
      : undefined
  for (const [property, value] of Object.entries(animatedProps)) {
    if (property.startsWith('mask.')) {
      renderConfig.mask = setMaskPropertyValue(
        (renderConfig as { mask?: unknown }).mask as never,
        property as MaskPropertyPath,
        value,
        itemLocalSize,
      )
      continue
    }

    renderConfig[property] = value
  }
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

function getAnimationChannels(item: UnifiedTimelineItemData<MediaType>): AnimationChannelKey[] {
  if (!item.animation?.channels) return []
  return Object.keys(item.animation.channels) as AnimationChannelKey[]
}

function findSurroundingKeyframes<T extends MediaType>(
  keyframes: AnimateKeyframe<T, AnimationChannelKey>[],
  relativeFrame: number,
  clipDurationFrames: number,
): {
  before: AnimateKeyframe<T, AnimationChannelKey> | null
  after: AnimateKeyframe<T, AnimationChannelKey> | null
} {
  const currentPercentage = frameToPercentage(relativeFrame, clipDurationFrames)
  let before: AnimateKeyframe<T, AnimationChannelKey> | null = null
  let after: AnimateKeyframe<T, AnimationChannelKey> | null = null

  for (const kf of keyframes) {
    if (kf.position <= currentPercentage) {
      before = kf
    } else if (!after) {
      after = kf
      break
    }
  }

  return { before, after }
}

function interpolateProperties(
  before: InterpolatedKeyframe,
  after: InterpolatedKeyframe,
  relativeFrame: number,
  clipDurationFrames: number,
): Record<string, number> {
  const currentPercentage = frameToPercentage(relativeFrame, clipDurationFrames)
  const t = (currentPercentage - before.position) / (after.position - before.position)
  const result: Record<string, number> = {}
  const beforeProperties = before.properties as InterpolatableProperties & Record<string, number>
  const afterProperties = after.properties as InterpolatableProperties & Record<string, number>

  for (const prop of Object.keys(before.properties)) {
    const startValue = beforeProperties[prop]
    const endValue = afterProperties[prop]

    if (typeof startValue === 'number' && typeof endValue === 'number') {
      result[prop] = lerp(startValue, endValue, t)
    }
  }

  return result
}

function getChannelAnimatedProps(
  item: UnifiedTimelineItemData<MediaType>,
  channel: AnimationChannelKey,
  currentAbsoluteFrame: number,
): Record<string, number> {
  const keyframes = (item.animation?.channels as AnimationChannelsMap)?.[channel]?.keyframes

  if (!keyframes || keyframes.length === 0) return {}

  const relativeFrame = absoluteFrameToRelativeFrame(currentAbsoluteFrame, item.timeRange)
  const clipDurationFrames = item.timeRange.timelineEndTime - item.timeRange.timelineStartTime
  const { before, after } = findSurroundingKeyframes(keyframes, relativeFrame, clipDurationFrames)

  if (before && after) {
    return interpolateProperties(before, after, relativeFrame, clipDurationFrames)
  }
  if (before) {
    return { ...(before.properties as InterpolatableProperties & Record<string, number>) }
  }
  if (after) {
    return { ...(after.properties as InterpolatableProperties & Record<string, number>) }
  }
  return {}
}

export function applyAnimationToConfig(
  item: UnifiedTimelineItemData<MediaType>,
  currentAbsoluteFrame: number,
): void {
  item.runtime.renderConfig = createBaseRenderConfig(item) as typeof item.runtime.renderConfig

  if (!item.animation?.channels || getAnimationChannels(item).length === 0) {
    return
  }

  const isInTimeRange =
    currentAbsoluteFrame >= item.timeRange.timelineStartTime &&
    currentAbsoluteFrame <= item.timeRange.timelineEndTime

  if (!isInTimeRange) {
    return
  }

  const animatedProps = getAnimationChannels(item).reduce<Record<string, number>>((acc, channel) => {
    Object.assign(acc, getChannelAnimatedProps(item, channel, currentAbsoluteFrame))
    return acc
  }, {})

  applyAnimatedPropsToRenderConfig(
    item.runtime.renderConfig as unknown as Record<string, unknown>,
    animatedProps,
  )
}

export function applyAnimationsToItems(
  items: UnifiedTimelineItemData<MediaType>[],
  currentAbsoluteFrame: number,
): void {
  for (const item of items) {
    applyAnimationToConfig(item, currentAbsoluteFrame)
  }
}
