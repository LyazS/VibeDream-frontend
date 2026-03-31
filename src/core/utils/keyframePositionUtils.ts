/**
 * 关键帧位置转换工具函数
 * 提供百分比和帧位置之间的转换，以及缓存管理
 */

import type {
  AnimateKeyframe,
  AnimationGroupId,
  ChannelKeyForMedia,
} from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import { cloneDeep } from 'lodash'

/**
 * 百分比位置转换为帧位置
 * @param percentage 百分比位置 (0-1)
 * @param clipDurationFrames clip 时长（帧数）
 * @returns 帧位置
 */
export function percentageToFrame(
  percentage: number,
  clipDurationFrames: number
): number {
  return Math.round(percentage * clipDurationFrames)
}

/**
 * 帧位置转换为百分比位置
 * @param frame 帧位置
 * @param clipDurationFrames clip 时长（帧数）
 * @returns 百分比位置 (0-1)
 */
export function frameToPercentage(
  frame: number,
  clipDurationFrames: number
): number {
  if (clipDurationFrames === 0) return 0
  return frame / clipDurationFrames
}

/**
 * 限制百分比在有效范围内 (0-1)
 * @param percentage 百分比位置
 * @returns 限制后的百分比位置
 */
export function clampPercentage(percentage: number): number {
  return Math.max(0, Math.min(1, percentage))
}

/**
 * 更新关键帧的缓存帧位置
 * 在创建关键帧或 clip 时长变化时调用
 * @param keyframe 关键帧对象
 * @param clipDurationFrames clip 时长（帧数）
 */
export function updateKeyframeCachedFrame(
  keyframe: AnimateKeyframe<MediaType, AnimationGroupId>,
  clipDurationFrames: number
): void {
  keyframe.frame = percentageToFrame(keyframe.position, clipDurationFrames)
  keyframe.cachedFrame = keyframe.frame
}

/**
 * 批量更新所有关键帧的缓存帧位置
 * 在 clip 时长变化时调用
 * @param keyframes 关键帧数组
 * @param clipDurationFrames clip 时长（帧数）
 */
export function updateAllKeyframesCachedFrames(
  keyframes: AnimateKeyframe<MediaType, AnimationGroupId>[],
  clipDurationFrames: number
): void {
  for (const keyframe of keyframes) {
    updateKeyframeCachedFrame(keyframe, clipDurationFrames)
  }
}

/**
 * 在指定位置通过插值创建关键帧
 *
 * @param keyframes 关键帧数组
 * @param position 目标位置的百分比 (0-1)
 * @param clipDuration clip 时长（帧数）
 * @returns 插值后的关键帧，如果无法插值则返回 null
 */
export function interpolateKeyframeAtPosition<
  T extends MediaType,
  C extends ChannelKeyForMedia<T>,
>(
  keyframes: AnimateKeyframe<T, C>[],
  position: number,
  clipDuration: number
): AnimateKeyframe<T, C> | null {
  // 找到前后关键帧
  let before: AnimateKeyframe<T, C> | null = null
  let after: AnimateKeyframe<T, C> | null = null

  for (const kf of keyframes) {
    if (kf.position <= position) {
      before = kf
    } else if (kf.position > position && !after) {
      after = kf
      break
    }
  }

  // 无法插值的情况
  if (!before && !after) return null
  if (!before) return cloneDeep(after!)
  if (!after) return cloneDeep(before)

  // 计算插值因子
  const t = (position - before.position) / (after.position - before.position)

  // 创建新关键帧
  const newKeyframe: AnimateKeyframe<T, C> = {
    position,
    frame: percentageToFrame(position, clipDuration),
    cachedFrame: percentageToFrame(position, clipDuration),
    value: {} as AnimateKeyframe<T, C>['value'],
    properties: {} as AnimateKeyframe<T, C>['properties'],
  }
  const mutableProperties = newKeyframe.value as Record<keyof typeof before.value, number>

  // 对每个属性进行线性插值
  const props = Object.keys(before.value as unknown as Record<string, unknown>) as Array<
    keyof typeof before.value
  >
  for (const prop of props) {
    const startValue = before.value[prop] as number
    const endValue = after.value[prop] as number

    if (typeof startValue === 'number' && typeof endValue === 'number') {
      mutableProperties[prop] = startValue + (endValue - startValue) * t
    } else {
      mutableProperties[prop] = startValue
    }
  }

  newKeyframe.properties = newKeyframe.value

  return newKeyframe as AnimateKeyframe<T, C>
}

/**
 * 在指定位置切割关键帧数组
 *
 * 核心逻辑：
 * 1. 根据切割位置将关键帧分为两组
 * 2. 重新映射每组关键帧的 position 到新的 [0, 1] 范围
 * 3. 更新 cachedFrame 基于新的 clip 时长
 * 4. 在切割点创建关键帧（如果需要）
 *
 * @param keyframes 原始关键帧数组（已按 position 排序）
 * @param splitPosition 切割位置的百分比 (0-1)，相对于原始 clip
 * @param originalDuration 原始 clip 时长（帧数）
 * @param firstDuration 第一个片段的时长（帧数）
 * @param secondDuration 第二个片段的时长（帧数）
 * @returns 切割后的两组关键帧和切割点关键帧
 */
export function splitKeyframesAtPosition<
  T extends MediaType,
  C extends ChannelKeyForMedia<T>,
>(
  keyframes: AnimateKeyframe<T, C>[],
  splitPosition: number,
  originalDuration: number,
  firstDuration: number,
  secondDuration: number
): {
  firstKeyframes: AnimateKeyframe<T, C>[]
  secondKeyframes: AnimateKeyframe<T, C>[]
  splitKeyframe: AnimateKeyframe<T, C> | null
} {
  const firstKeyframes: AnimateKeyframe<T, C>[] = []
  const secondKeyframes: AnimateKeyframe<T, C>[] = []
  let splitKeyframe: AnimateKeyframe<T, C> | null = null
  let exactSplitKeyframe: AnimateKeyframe<T, C> | null = null

  // 1. 分类关键帧
  for (const kf of keyframes) {
    if (kf.position < splitPosition) {
      // 属于第一个片段
      // 边界情况：如果 splitPosition 为 0，则第一个片段时长为 0，不应该有关键帧
      if (splitPosition > 0) {
        const newPosition = kf.position / splitPosition
        const newKeyframe = cloneDeep(kf)
        newKeyframe.position = newPosition
        newKeyframe.frame = percentageToFrame(newPosition, firstDuration)
        newKeyframe.cachedFrame = newKeyframe.frame
        firstKeyframes.push(newKeyframe)
      }
    } else if (kf.position > splitPosition) {
      // 属于第二个片段
      // 边界情况：如果 splitPosition 为 1，则第二个片段时长为 0，不应该有关键帧
      if (splitPosition < 1) {
        const newPosition = (kf.position - splitPosition) / (1 - splitPosition)
        const newKeyframe = cloneDeep(kf)
        newKeyframe.position = newPosition
        newKeyframe.frame = percentageToFrame(newPosition, secondDuration)
        newKeyframe.cachedFrame = newKeyframe.frame
        secondKeyframes.push(newKeyframe)
      }
    } else {
      // 恰好在切割点上
      exactSplitKeyframe = kf
    }
  }

  // 2. 处理切割点关键帧
  if (exactSplitKeyframe) {
    // 切割点恰好有关键帧，复制到两个片段
    const firstSplit = cloneDeep(exactSplitKeyframe)
    firstSplit.position = 1.0
    firstSplit.frame = firstDuration
    firstSplit.cachedFrame = firstSplit.frame
    firstKeyframes.push(firstSplit)

    const secondSplit = cloneDeep(exactSplitKeyframe)
    secondSplit.position = 0.0
    secondSplit.frame = 0
    secondSplit.cachedFrame = secondSplit.frame
    secondKeyframes.push(secondSplit)

    splitKeyframe = exactSplitKeyframe
  } else {
    // 需要通过插值创建切割点关键帧
    splitKeyframe = interpolateKeyframeAtPosition(
      keyframes,
      splitPosition,
      originalDuration
    )

    if (splitKeyframe) {
      // 添加到第一个片段的末尾
      const firstSplit = cloneDeep(splitKeyframe)
      firstSplit.position = 1.0
      firstSplit.frame = firstDuration
      firstSplit.cachedFrame = firstSplit.frame
      firstKeyframes.push(firstSplit)

      // 添加到第二个片段的开头
      const secondSplit = cloneDeep(splitKeyframe)
      secondSplit.position = 0.0
      secondSplit.frame = 0
      secondSplit.cachedFrame = secondSplit.frame
      secondKeyframes.push(secondSplit)
    }
  }

  // 3. 对关键帧数组进行排序（确保 position 顺序正确）
  firstKeyframes.sort((a, b) => a.position - b.position)
  secondKeyframes.sort((a, b) => a.position - b.position)

  return {
    firstKeyframes,
    secondKeyframes,
    splitKeyframe,
  }
}

export function sliceKeyframesToSegment<
  T extends MediaType,
  C extends ChannelKeyForMedia<T>,
>(
  keyframes: AnimateKeyframe<T, C>[],
  startRatio: number,
  endRatio: number,
  originalDuration: number,
  segmentDuration: number,
): AnimateKeyframe<T, C>[] {
  const safeStartRatio = clampPercentage(startRatio)
  const safeEndRatio = clampPercentage(endRatio)

  if (safeEndRatio < safeStartRatio) {
    return []
  }

  const segmentSpan = safeEndRatio - safeStartRatio
  const result: AnimateKeyframe<T, C>[] = []
  const hasExactKeyframeAt = (position: number) =>
    keyframes.some((keyframe) => keyframe.position === position)

  if (segmentSpan === 0) {
    const boundaryKeyframe = hasExactKeyframeAt(safeStartRatio)
      ? cloneDeep(keyframes.find((keyframe) => keyframe.position === safeStartRatio)!)
      : interpolateKeyframeAtPosition(keyframes, safeStartRatio, originalDuration)

    if (!boundaryKeyframe) {
      return []
    }

    boundaryKeyframe.position = 0
    boundaryKeyframe.frame = 0
    boundaryKeyframe.cachedFrame = 0
    boundaryKeyframe.properties = boundaryKeyframe.value
    return [boundaryKeyframe]
  }

  for (const keyframe of keyframes) {
    if (keyframe.position < safeStartRatio || keyframe.position > safeEndRatio) {
      continue
    }

    const nextKeyframe = cloneDeep(keyframe)
    nextKeyframe.position = clampPercentage((keyframe.position - safeStartRatio) / segmentSpan)
    nextKeyframe.frame = percentageToFrame(nextKeyframe.position, segmentDuration)
    nextKeyframe.cachedFrame = nextKeyframe.frame
    nextKeyframe.properties = nextKeyframe.value
    result.push(nextKeyframe)
  }

  if (!hasExactKeyframeAt(safeStartRatio)) {
    const startKeyframe = interpolateKeyframeAtPosition(keyframes, safeStartRatio, originalDuration)
    if (startKeyframe) {
      startKeyframe.position = 0
      startKeyframe.frame = 0
      startKeyframe.cachedFrame = 0
      startKeyframe.properties = startKeyframe.value
      result.push(startKeyframe)
    }
  }

  if (!hasExactKeyframeAt(safeEndRatio)) {
    const endKeyframe = interpolateKeyframeAtPosition(keyframes, safeEndRatio, originalDuration)
    if (endKeyframe) {
      endKeyframe.position = 1
      endKeyframe.frame = percentageToFrame(1, segmentDuration)
      endKeyframe.cachedFrame = endKeyframe.frame
      endKeyframe.properties = endKeyframe.value
      result.push(endKeyframe)
    }
  }

  const deduped = new Map<number, AnimateKeyframe<T, C>>()
  for (const keyframe of result) {
    deduped.set(keyframe.frame, keyframe)
  }

  return Array.from(deduped.values()).sort((a, b) => a.position - b.position)
}
