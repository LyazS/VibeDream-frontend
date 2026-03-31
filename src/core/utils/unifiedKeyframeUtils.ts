/**
 * 统一关键帧工具函数
 * 基于分组通道模型管理关键帧的增删改查、状态判断和交互逻辑。
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { KeyframeButtonState, KeyframeUIState } from '@/core/timelineitem/animationtypes'
import type {
  AnimateKeyframe,
  AnimationChannelKey,
  GetAnimation,
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
import {
  getAnimationChannelForProperty,
} from '@/core/timelineitem/bunnytype'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { MediaType } from '../mediaitem'
import {
  MASK_CENTER_PATHS,
  MASK_ROTATION_PATHS,
  MASK_OUTER_RANGE_PATHS,
  MASK_DECAY_RATE_PATHS,
  MASK_RECTANGLE_SIZE_PATHS,
  MASK_RECTANGLE_CORNER_PATHS,
  MASK_ELLIPSE_SIZE_PATHS,
  MASK_MIRROR_LENGTH_PATHS,
  type MaskPropertyPath,
  getMaskAnimatableProps,
  setMaskPropertyValue,
} from '@/core/timelineitem/mask'
import {
  percentageToFrame,
  frameToPercentage,
  clampPercentage,
  updateAllKeyframesCachedFrames,
} from './keyframePositionUtils'

type AnyKeyframe = AnimateKeyframe<MediaType, AnimationChannelKey>
type AnyChannelEntry = { keyframes: AnyKeyframe[] }
type AnyAnimationChannels = Partial<Record<AnimationChannelKey, AnyChannelEntry>>
type AnyAnimatableProperties =
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

const CHANNEL_PROPERTIES: Record<AnimationChannelKey, readonly string[]> = {
  layout: ['x', 'y', 'width', 'height'],
  rotation: ['rotation'],
  opacity: ['opacity'],
  audio: ['volume'],
  maskCenter: MASK_CENTER_PATHS,
  maskRotation: MASK_ROTATION_PATHS,
  maskOuterRange: MASK_OUTER_RANGE_PATHS,
  maskDecayRate: MASK_DECAY_RATE_PATHS,
  maskRectangleSize: MASK_RECTANGLE_SIZE_PATHS,
  maskRectangleCorner: MASK_RECTANGLE_CORNER_PATHS,
  maskEllipseSize: MASK_ELLIPSE_SIZE_PATHS,
  maskMirrorLength: MASK_MIRROR_LENGTH_PATHS,
}

type ActionResult = 'no-animation' | 'updated-keyframe' | 'created-keyframe'

function getSupportedChannels(item: UnifiedTimelineItemData): AnimationChannelKey[] {
  switch (item.mediaType) {
    case 'video':
      return ['layout', 'rotation', 'opacity', 'audio', 'maskCenter', 'maskRotation', 'maskOuterRange', 'maskDecayRate', 'maskRectangleSize', 'maskRectangleCorner', 'maskEllipseSize', 'maskMirrorLength']
    case 'image':
    case 'text':
      return ['layout', 'rotation', 'opacity', 'maskCenter', 'maskRotation', 'maskOuterRange', 'maskDecayRate', 'maskRectangleSize', 'maskRectangleCorner', 'maskEllipseSize', 'maskMirrorLength']
    case 'audio':
      return ['audio']
    default:
      return []
  }
}

function assertChannelSupported(
  item: UnifiedTimelineItemData,
  channel: AnimationChannelKey,
): void {
  if (!getSupportedChannels(item).includes(channel)) {
    throw new Error(`Channel "${channel}" is not supported for media type "${item.mediaType}"`)
  }
}

function getChannelForProperty(
  item: UnifiedTimelineItemData,
  property: string,
): AnimationChannelKey | undefined {
  const channel = getAnimationChannelForProperty(property)
  if (!channel) return undefined
  return getSupportedChannels(item).includes(channel) ? channel : undefined
}

function getChannelPropertySnapshot(
  item: UnifiedTimelineItemData,
  channel: AnimationChannelKey,
): Record<string, number> {
  switch (channel) {
    case 'layout':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const visualConfig = TimelineItemQueries.getRenderConfig(item)
      return {
        x: visualConfig.x,
        y: visualConfig.y,
        width: visualConfig.width,
        height: visualConfig.height,
      }
    case 'rotation': {
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const visualConfig = TimelineItemQueries.getRenderConfig(item)
      return { rotation: visualConfig.rotation }
    }
    case 'opacity': {
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const visualConfig = TimelineItemQueries.getRenderConfig(item)
      return { opacity: visualConfig.opacity }
    }
    case 'audio':
      if (!TimelineItemQueries.hasAudioProperties(item)) {
        throw new Error(`Channel "${channel}" requires audio properties`)
      }
      return { volume: TimelineItemQueries.getRenderConfig(item).volume }
    case 'maskCenter':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskCenterProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.centerX': maskCenterProps['mask.centerX'],
        'mask.centerY': maskCenterProps['mask.centerY'],
      }
    case 'maskRotation':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskRotationProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.rotation': maskRotationProps['mask.rotation'],
      }
    case 'maskOuterRange':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskOuterRangeProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.outerRange': maskOuterRangeProps['mask.outerRange'],
      }
    case 'maskDecayRate':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskDecayRateProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.decayRate': maskDecayRateProps['mask.decayRate'],
      }
    case 'maskRectangleSize':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskRectangleSizeProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.width': maskRectangleSizeProps['mask.width'],
        'mask.height': maskRectangleSizeProps['mask.height'],
      }
    case 'maskRectangleCorner':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskRectangleCornerProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.cornerRadius': maskRectangleCornerProps['mask.cornerRadius'],
      }
    case 'maskEllipseSize':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskEllipseSizeProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.ellipseWidth': maskEllipseSizeProps['mask.ellipseWidth'],
        'mask.ellipseHeight': maskEllipseSizeProps['mask.ellipseHeight'],
      }
    case 'maskMirrorLength':
      if (!TimelineItemQueries.hasVisualProperties(item)) {
        throw new Error(`Channel "${channel}" requires visual properties`)
      }
      const maskMirrorLengthProps = getMaskAnimatableProps(
        TimelineItemQueries.getRenderConfig(item).mask,
        getItemLocalSize(item),
      )
      return {
        'mask.length': maskMirrorLengthProps['mask.length'],
      }
  }
}

function getChannelKeyframesInternal(
  item: UnifiedTimelineItemData,
  channel: AnimationChannelKey,
): AnyKeyframe[] {
  if (!item.animation?.channels) return []
  const entry = (item.animation.channels as AnyAnimationChannels)[channel]
  return entry?.keyframes ?? []
}

function ensureChannel(item: UnifiedTimelineItemData, channel: AnimationChannelKey): AnyKeyframe[] {
  initializeAnimation(item)
  const channels = item.animation!.channels as AnyAnimationChannels

  if (!channels[channel]) {
    channels[channel] = { keyframes: [] }
  }

  return channels[channel]!.keyframes
}

function removeEmptyChannel(item: UnifiedTimelineItemData, channel: AnimationChannelKey): void {
  if (!item.animation?.channels) return

  const channels = item.animation.channels as AnyAnimationChannels
  if (channels[channel]?.keyframes.length === 0) {
    delete channels[channel]
  }

  if (Object.keys(channels).length === 0) {
    item.animation = undefined
  }
}

function getAllChannelKeyframes(item: UnifiedTimelineItemData): AnyKeyframe[] {
  return getSupportedChannels(item).flatMap((channel) => getChannelKeyframesInternal(item, channel))
}

export function absoluteFrameToRelativeFrame(
  absoluteFrame: number,
  timeRange: UnifiedTimeRange,
): number {
  const tlStartFrame = timeRange.timelineStartTime
  const relativeFrame = absoluteFrame - tlStartFrame
  return Math.max(0, relativeFrame)
}

export function relativeFrameToAbsoluteFrame(
  relativeFrame: number,
  timeRange: UnifiedTimeRange,
): number {
  const clipStartFrame = timeRange.timelineStartTime
  return clipStartFrame + relativeFrame
}

export function initializeAnimation(item: UnifiedTimelineItemData): void {
  if (!item.animation) {
    item.animation = createEmptyAnimation()
  } else if (!item.animation.channels) {
    console.warn('🎬 [Unified Keyframe] Detected legacy animation structure without channels', {
      itemId: item.id,
      mediaType: item.mediaType,
    })
    item.animation = createEmptyAnimation()
  }
}

function createEmptyAnimation(): GetAnimation<MediaType> {
  return { channels: {} } as GetAnimation<MediaType>
}

function getItemLocalSize(item: UnifiedTimelineItemData) {
  if (!TimelineItemQueries.hasVisualProperties(item)) {
    return { width: 0, height: 0 }
  }
  const renderConfig = TimelineItemQueries.getRenderConfig(item)
  return {
    width: renderConfig.width,
    height: renderConfig.height,
  }
}

function setConfigProperty(
  item: UnifiedTimelineItemData,
  property: string,
  value: unknown,
): void {
  if (property.startsWith('mask.') && typeof value === 'number' && TimelineItemQueries.hasVisualProperties(item)) {
    item.config.mask = setMaskPropertyValue(
      item.config.mask,
      property as MaskPropertyPath,
      value,
      getItemLocalSize(item),
    )
    return
  }

  const config = (item.config as unknown) as Record<string, unknown>
  if (!(property in config)) return
  config[property] = value
}

function setKeyframePropertyValue(
  keyframe: AnyKeyframe,
  property: string,
  value: unknown,
): void {
  const properties = keyframe.properties as AnyAnimatableProperties & Record<string, unknown>
  properties[property] = value
}

export function createChannelKeyframe(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): AnyKeyframe {
  assertChannelSupported(item, channel)

  const relativeFrame = absoluteFrameToRelativeFrame(absoluteFrame, item.timeRange)
  const clipDurationFrames = item.timeRange.timelineEndTime - item.timeRange.timelineStartTime
  const position = clampPercentage(frameToPercentage(relativeFrame, clipDurationFrames))

  return {
    position,
    cachedFrame: relativeFrame,
    properties: getChannelPropertySnapshot(item, channel),
  } as unknown as AnyKeyframe
}

export function hasAnimation(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): boolean {
  if (!item.animation?.channels) return false
  if (channel) {
    return getChannelKeyframesInternal(item, channel).length > 0
  }
  return getSupportedChannels(item).some((key) => getChannelKeyframesInternal(item, key).length > 0)
}

export function isCurrentFrameOnKeyframe(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel?: AnimationChannelKey,
): boolean {
  const relativeFrame = absoluteFrameToRelativeFrame(absoluteFrame, item.timeRange)
  const keyframes = channel ? getChannelKeyframesInternal(item, channel) : getAllChannelKeyframes(item)
  return keyframes.some((kf) => kf.cachedFrame === relativeFrame)
}

export function getKeyframeButtonState(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): KeyframeButtonState {
  if (!hasAnimation(item, channel)) return 'none'
  if (isCurrentFrameOnKeyframe(item, currentFrame, channel)) return 'on-keyframe'
  return 'between-keyframes'
}

export function getKeyframeUIState(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): KeyframeUIState {
  return {
    hasAnimation: hasAnimation(item, channel),
    isOnKeyframe: isCurrentFrameOnKeyframe(item, currentFrame, channel),
  }
}

export function findKeyframeAtFrame(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): AnyKeyframe | undefined {
  const relativeFrame = absoluteFrameToRelativeFrame(absoluteFrame, item.timeRange)
  return getChannelKeyframesInternal(item, channel).find((kf) => kf.cachedFrame === relativeFrame)
}

export function enableAnimation(item: UnifiedTimelineItemData): void {
  initializeAnimation(item)
}

export function disableAnimation(item: UnifiedTimelineItemData): void {
  item.animation = undefined
}

export function removeKeyframeAtFrame(
  item: UnifiedTimelineItemData,
  absoluteFrame: number,
  channel: AnimationChannelKey,
): boolean {
  if (!item.animation?.channels) return false

  const relativeFrame = absoluteFrameToRelativeFrame(absoluteFrame, item.timeRange)
  const keyframes = getChannelKeyframesInternal(item, channel)
  const nextKeyframes = keyframes.filter((kf) => kf.cachedFrame !== relativeFrame)
  const removed = nextKeyframes.length < keyframes.length

  if (removed) {
    ;(item.animation!.channels as AnyAnimationChannels)[channel] = { keyframes: nextKeyframes }
    removeEmptyChannel(item, channel)
  }

  return removed
}

export function adjustKeyframesForDurationChange(
  item: UnifiedTimelineItemData,
  oldDurationFrames: number,
  newDurationFrames: number,
): void {
  if (!item.animation?.channels) return

  console.log('🎬 [Keyframe] Adjusting keyframes for duration change:', {
    itemId: item.id,
    oldDuration: oldDurationFrames,
    newDuration: newDurationFrames,
  })

  for (const channel of getSupportedChannels(item)) {
    const keyframes = getChannelKeyframesInternal(item, channel)
    if (keyframes.length === 0) continue

    updateAllKeyframesCachedFrames(keyframes, newDurationFrames)
    const validKeyframes = keyframes.filter((kf) => kf.position <= 1.0)
    ;(item.animation!.channels as AnyAnimationChannels)[channel] = { keyframes: validKeyframes }
    sortKeyframes(item, channel)
    removeEmptyChannel(item, channel)
  }
}

export function sortKeyframes(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): void {
  if (!item.animation?.channels) return

  const sortList = (keyframes: AnyKeyframe[]) => {
    keyframes.sort((a, b) => a.position - b.position)
  }

  if (channel) {
    sortList(getChannelKeyframesInternal(item, channel))
    return
  }

  for (const key of getSupportedChannels(item)) {
    sortList(getChannelKeyframesInternal(item, key))
  }
}

function handleClick_NoAnimation(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel: AnimationChannelKey,
): void {
  enableAnimation(item)
  ensureChannel(item, channel).push(createChannelKeyframe(item, currentFrame, channel))
}

function handleClick_OnKeyframe(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel: AnimationChannelKey,
): void {
  removeKeyframeAtFrame(item, currentFrame, channel)
}

function handleClick_BetweenKeyframes(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel: AnimationChannelKey,
): void {
  ensureChannel(item, channel).push(createChannelKeyframe(item, currentFrame, channel))
}

export function toggleKeyframe(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel: AnimationChannelKey,
): void {
  const buttonState = getKeyframeButtonState(item, currentFrame, channel)

  switch (buttonState) {
    case 'none':
      handleClick_NoAnimation(item, currentFrame, channel)
      break
    case 'on-keyframe':
      handleClick_OnKeyframe(item, currentFrame, channel)
      break
    case 'between-keyframes':
      handleClick_BetweenKeyframes(item, currentFrame, channel)
      break
  }

  sortKeyframes(item, channel)
  removeEmptyChannel(item, channel)
}

async function updateProperty(
  item: UnifiedTimelineItemData,
  property: string,
  value: unknown,
): Promise<void> {
  setConfigProperty(item, property, value)
}

async function handlePropertyChange_NoAnimation(
  item: UnifiedTimelineItemData,
  property: string,
  value: unknown,
): Promise<void> {
  await updateProperty(item, property, value)
}

async function handlePropertyChange_OnKeyframe(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  property: string,
  value: unknown,
  channel: AnimationChannelKey,
): Promise<void> {
  const keyframe = findKeyframeAtFrame(item, currentFrame, channel)
  if (keyframe) {
    setKeyframePropertyValue(keyframe, property, value)
  }
  await updateProperty(item, property, value)
}

async function handlePropertyChange_BetweenKeyframes(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  property: string,
  value: unknown,
  channel: AnimationChannelKey,
): Promise<void> {
  const keyframe = createChannelKeyframe(item, currentFrame, channel)
  setKeyframePropertyValue(keyframe, property, value)
  ensureChannel(item, channel).push(keyframe)
  await updateProperty(item, property, value)
}

export async function handlePropertyChange(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  property: string,
  value: unknown,
): Promise<ActionResult> {
  const channel = getChannelForProperty(item, property)
  if (!channel) {
    await updateProperty(item, property, value)
    return 'no-animation'
  }

  const buttonState = getKeyframeButtonState(item, currentFrame, channel)

  switch (buttonState) {
    case 'none':
      await handlePropertyChange_NoAnimation(item, property, value)
      return 'no-animation'
    case 'on-keyframe':
      await handlePropertyChange_OnKeyframe(item, currentFrame, property, value, channel)
      sortKeyframes(item, channel)
      return 'updated-keyframe'
    case 'between-keyframes':
      await handlePropertyChange_BetweenKeyframes(item, currentFrame, property, value, channel)
      sortKeyframes(item, channel)
      return 'created-keyframe'
  }
}

function getSortedFrames(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): number[] {
  const relativeFrames = (channel
    ? getChannelKeyframesInternal(item, channel)
    : getAllChannelKeyframes(item)
  ).map((kf) => kf.cachedFrame)

  return Array.from(new Set(relativeFrames))
    .sort((a, b) => a - b)
    .map((frame) => relativeFrameToAbsoluteFrame(frame, item.timeRange))
}

export function getPreviousKeyframeFrame(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): number | null {
  const previous = getSortedFrames(item, channel).filter((frame) => frame < currentFrame)
  return previous.length > 0 ? previous[previous.length - 1] : null
}

export function getNextKeyframeFrame(
  item: UnifiedTimelineItemData,
  currentFrame: number,
  channel?: AnimationChannelKey,
): number | null {
  const next = getSortedFrames(item, channel).filter((frame) => frame > currentFrame)
  return next.length > 0 ? next[0] : null
}

export function clearAllKeyframes(item: UnifiedTimelineItemData): void {
  item.animation = undefined
}

export function clearChannelKeyframes(
  item: UnifiedTimelineItemData,
  channel: AnimationChannelKey,
): void {
  if (!item.animation?.channels) return
  delete (item.animation.channels as AnyAnimationChannels)[channel]
  removeEmptyChannel(item, channel)
}

export function getKeyframeCount(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): number {
  if (channel) return getChannelKeyframesInternal(item, channel).length
  return getAllChannelKeyframes(item).length
}

export function getAllKeyframeFrames(
  item: UnifiedTimelineItemData,
  channel?: AnimationChannelKey,
): number[] {
  return getSortedFrames(item, channel)
}

export function getVisibleKeyframesForTimeline(item: UnifiedTimelineItemData): AnyKeyframe[] {
  const merged = new Map<number, AnyKeyframe>()

  for (const keyframe of getAllChannelKeyframes(item)) {
    if (!merged.has(keyframe.cachedFrame)) {
      merged.set(keyframe.cachedFrame, keyframe)
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.cachedFrame - b.cachedFrame)
}

export function validateKeyframes(item: UnifiedTimelineItemData): boolean {
  if (!item.animation?.channels) return true

  const clipDurationFrames = item.timeRange.timelineEndTime - item.timeRange.timelineStartTime

  for (const channel of getSupportedChannels(item)) {
    for (const keyframe of getChannelKeyframesInternal(item, channel)) {
      if (keyframe.position < 0 || keyframe.position > 1) {
        return false
      }

      const expectedCachedFrame = percentageToFrame(keyframe.position, clipDurationFrames)
      if (keyframe.cachedFrame !== expectedCachedFrame) {
        return false
      }

      const expectedProps = CHANNEL_PROPERTIES[channel]
      const properties = keyframe.properties as AnyAnimatableProperties & Record<string, number>
      for (const prop of expectedProps) {
        if (typeof properties[prop] !== 'number') {
          return false
        }
      }
    }
  }

  return true
}

export function debugKeyframes(item: UnifiedTimelineItemData): void {
  console.group('🎬 [Unified Keyframe Debug]')
  console.log('Item:', {
    id: item.id,
    hasAnimation: hasAnimation(item),
    keyframeCount: getKeyframeCount(item),
    channelCounts: Object.fromEntries(
      getSupportedChannels(item).map((channel) => [channel, getKeyframeCount(item, channel)]),
    ),
  })
  console.log('Animation Config:', item.animation)
  console.log('Keyframe Frames:', getAllKeyframeFrames(item))
  console.log('Validation:', validateKeyframes(item))
  console.groupEnd()
}
