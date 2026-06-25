import { useUnifiedStore } from '@/core/unifiedStore'
import { AnimationRegistry } from '@/core/animation/registry'
import {
  getRelativeFrame,
  getPosition,
  getTrack,
} from '@/core/animation/engine'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { MediaType } from '@/core/mediaitem'
import type { ChangeOperation, ChangePlan } from '@/core/property-system'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type {
  AnimateKeyframe,
  PropertyAnimationGroupId,
  PropertyAnimationValueByGroup,
} from '@/core/timelineitem/model/render'

type KeyframePayload = {
  frame: number
  value: Record<string, unknown>
  easing?: {
    type: 'linear'
  }
}

type ReadArgs = {
  itemId: string
  groupId: PropertyAnimationGroupId
}

type WriteArgs = {
  itemId: string
  groupId: PropertyAnimationGroupId
  keyframes: KeyframePayload[]
  options?: {
    frameMode?: 'absolute'
    replaceMode?: 'entire-channel'
    atomic?: boolean
    normalizeBeforeApply?: boolean
  }
}

type DiffApplyArgs = {
  itemId: string
  groupId: PropertyAnimationGroupId
  match: {
    range: {
      startFrame: number
      endFrame: number
    }
    keyframes: KeyframePayload[]
  }
  apply: {
    replaceWith: KeyframePayload[]
  }
  options?: {
    onMismatch?: 'reject'
    frameMode?: 'absolute'
    atomic?: boolean
  }
}

type TimelineKeyframeRecord = {
  frame: number
  relativeFrame: number
  position: number
  value: Record<string, unknown>
  easing: {
    type: 'linear'
  }
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toolError(code: string, message: string, details?: Record<string, any>): Error & {
  toolCode: string
  toolDetails?: Record<string, any>
} {
  const error = new Error(message) as Error & {
    toolCode: string
    toolDetails?: Record<string, any>
  }
  error.toolCode = code
  error.toolDetails = details
  return error
}

function normalizeFrame(frame: unknown, field: string): number {
  if (typeof frame !== 'number' || !Number.isInteger(frame)) {
    throw toolError('invalid_arguments', `${field} 必须是整数帧`, { field, frame })
  }
  return frame
}

function normalizeLinearEasing(
  easing: unknown,
): {
  type: 'linear'
} {
  if (easing === undefined) {
    return { type: 'linear' }
  }
  if (
    typeof easing === 'object' &&
    easing !== null &&
    !Array.isArray(easing) &&
    (easing as Record<string, unknown>).type === 'linear'
  ) {
    return { type: 'linear' }
  }
  throw toolError('invalid_easing', '当前仅支持 linear easing', { easing })
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class KeyframeChannelEditService {
  async readKeyframeTimeline(args: ReadArgs) {
    const item = this.requireClip(args.itemId)
    const groupId = this.requireSupportedGroup(item, args.groupId)
    const keyframes = this.readTimelineKeyframes(item, groupId)

    return {
      itemId: item.id,
      mediaType: item.mediaType,
      groupId,
      timelineRange: {
        startFrame: item.timeRange.timelineStartTime,
        endFrame: item.timeRange.timelineEndTime,
        durationFrames: item.timeRange.timelineEndTime - item.timeRange.timelineStartTime,
      },
      keyframes,
    }
  }

  async writeKeyframeChannel(args: WriteArgs) {
    const item = this.requireClip(args.itemId)
    const groupId = this.requireSupportedGroup(item, args.groupId)
    this.assertFrameMode(args.options?.frameMode)

    const current = this.readTimelineKeyframes(item, groupId)
    const next = this.normalizeInputKeyframes(item, groupId, args.keyframes)
    const plan = this.buildPlan(item, groupId, current, next, `重写 ${groupId} 关键帧`)
    const diff = this.summarizeDiff(current, next)

    if (plan.operations.length > 0) {
      await useUnifiedStore().applyChangePlanWithHistory(plan)
    }

    return {
      itemId: item.id,
      groupId,
      status: 'applied' as const,
      diff: {
        replaceMode: 'entire-channel' as const,
        previousKeyframeCount: current.length,
        finalKeyframeCount: next.length,
        createdFrames: diff.createdFrames,
        updatedFrames: diff.updatedFrames,
        deletedFrames: diff.deletedFrames,
        normalized: true,
      },
    }
  }

  async diffApplyKeyframeChannel(args: DiffApplyArgs) {
    const item = this.requireClip(args.itemId)
    const groupId = this.requireSupportedGroup(item, args.groupId)
    this.assertFrameMode(args.options?.frameMode)

    const current = this.readTimelineKeyframes(item, groupId)
    const startFrame = normalizeFrame(args.match?.range?.startFrame, 'match.range.startFrame')
    const endFrame = normalizeFrame(args.match?.range?.endFrame, 'match.range.endFrame')
    if (endFrame < startFrame) {
      throw toolError('invalid_arguments', 'match.range.endFrame 不能小于 startFrame', {
        startFrame,
        endFrame,
      })
    }

    const expected = this.normalizeInputKeyframes(item, groupId, args.match?.keyframes ?? [])
    const replacement = this.normalizeInputKeyframes(item, groupId, args.apply?.replaceWith ?? [])
    const matched = current.filter((entry) => entry.frame >= startFrame && entry.frame <= endFrame)

    if (!this.keyframeListsEqual(matched, expected)) {
      throw toolError('match_failed', '关键帧 patch 匹配失败，请先重新读取当前通道。', {
        matched: false,
        conflictRange: { startFrame, endFrame },
        expected,
        actual: matched,
      })
    }

    const next = this.normalizeTimelineKeyframes([
      ...current.filter((entry) => entry.frame < startFrame || entry.frame > endFrame),
      ...replacement,
    ])

    const plan = this.buildPlan(item, groupId, current, next, `局部更新 ${groupId} 关键帧`)
    const diff = this.summarizeDiff(current, next)

    if (plan.operations.length > 0) {
      await useUnifiedStore().applyChangePlanWithHistory(plan)
    }

    return {
      itemId: item.id,
      groupId,
      status: 'applied' as const,
      matched: true,
      diff: {
        previousKeyframeCount: current.length,
        finalKeyframeCount: next.length,
        createdFrames: diff.createdFrames,
        updatedFrames: diff.updatedFrames,
        deletedFrames: diff.deletedFrames,
        normalized: true,
      },
    }
  }

  private requireClip(itemId: string) {
    if (!itemId || typeof itemId !== 'string') {
      throw toolError('invalid_arguments', 'itemId 必须是非空字符串')
    }
    const item = useUnifiedStore().getTimelineItem(itemId)
    if (!item) {
      throw toolError('clip_not_found', '未找到该时间轴片段。', { itemId })
    }
    return item
  }

  private requireSupportedGroup(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: PropertyAnimationGroupId,
  ) {
    if (!groupId || typeof groupId !== 'string') {
      throw toolError('invalid_group', 'groupId 必须是非空字符串')
    }
    const definition = AnimationRegistry.get(groupId)
    if (!definition.supports(item)) {
      throw toolError('group_not_supported', `该 clip 不支持关键帧组 ${groupId}`, {
        itemId: item.id,
        mediaType: item.mediaType,
        groupId,
        supportedGroups: getSupportedAnimationGroups(item),
      })
    }
    return groupId
  }

  private assertFrameMode(frameMode: 'absolute' | undefined) {
    if (frameMode && frameMode !== 'absolute') {
      throw toolError('invalid_arguments', '当前仅支持 absolute frameMode', { frameMode })
    }
  }

  private readTimelineKeyframes(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: PropertyAnimationGroupId,
  ): TimelineKeyframeRecord[] {
    const track = getTrack(item, groupId)
    return (track?.keyframes ?? [])
      .map((keyframe) => this.toTimelineRecord(item, keyframe))
      .sort((left, right) => left.frame - right.frame)
  }

  private toTimelineRecord(
    item: UnifiedTimelineItemData<MediaType>,
    keyframe: AnimateKeyframe<MediaType, PropertyAnimationGroupId>,
  ): TimelineKeyframeRecord {
    return {
      frame: item.timeRange.timelineStartTime + keyframe.frame,
      relativeFrame: keyframe.frame,
      position: keyframe.position,
      value: cloneRecord(keyframe.value as Record<string, unknown>),
      easing: normalizeLinearEasing(keyframe.easing),
    }
  }

  private normalizeInputKeyframes(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: PropertyAnimationGroupId,
    keyframes: KeyframePayload[],
  ): TimelineKeyframeRecord[] {
    if (!Array.isArray(keyframes)) {
      throw toolError('invalid_arguments', 'keyframes 必须是数组')
    }
    const definition = AnimationRegistry.get(groupId)
    return this.normalizeTimelineKeyframes(
      keyframes.map((entry, index) => {
        const frame = normalizeFrame(entry?.frame, `keyframes[${index}].frame`)
        this.assertFrameInRange(item, frame)
        const value = this.normalizeGroupValue(definition.id, definition.getBaseValue(item), entry?.value, index)
        return {
          frame,
          relativeFrame: getRelativeFrame(item, frame),
          position: getPosition(item, getRelativeFrame(item, frame)),
          value,
          easing: normalizeLinearEasing(entry?.easing),
        }
      }),
    )
  }

  private normalizeGroupValue(
    groupId: PropertyAnimationGroupId,
    baseValue: PropertyAnimationValueByGroup<PropertyAnimationGroupId>,
    value: unknown,
    index: number,
  ): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw toolError('invalid_value', `keyframes[${index}].value 必须是对象`, { groupId, value })
    }
    const nextValue = value as Record<string, unknown>
    const baseKeys = Object.keys(baseValue as Record<string, unknown>)
    const nextKeys = Object.keys(nextValue)
    if (baseKeys.length !== nextKeys.length || !baseKeys.every((key) => nextKeys.includes(key))) {
      throw toolError('invalid_value_shape', `关键帧值结构不匹配: ${groupId}`, {
        groupId,
        expectedKeys: baseKeys,
        actualKeys: nextKeys,
      })
    }
    for (const key of baseKeys) {
      const entry = nextValue[key]
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw toolError('invalid_value', `关键帧值必须是有限数字: ${groupId}.${key}`, {
          groupId,
          key,
          value: entry,
        })
      }
    }
    return cloneRecord(nextValue)
  }

  private normalizeTimelineKeyframes(keyframes: TimelineKeyframeRecord[]): TimelineKeyframeRecord[] {
    const deduped = new Map<number, TimelineKeyframeRecord>()
    for (const keyframe of keyframes) {
      deduped.set(keyframe.frame, keyframe)
    }
    return Array.from(deduped.values()).sort((left, right) => left.frame - right.frame)
  }

  private assertFrameInRange(item: UnifiedTimelineItemData<MediaType>, frame: number) {
    if (frame < item.timeRange.timelineStartTime || frame > item.timeRange.timelineEndTime) {
      throw toolError('frame_out_of_range', '关键帧帧号超出 clip 时间范围', {
        frame,
        startFrame: item.timeRange.timelineStartTime,
        endFrame: item.timeRange.timelineEndTime,
      })
    }
  }

  private buildPlan(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: PropertyAnimationGroupId,
    current: TimelineKeyframeRecord[],
    next: TimelineKeyframeRecord[],
    description: string,
  ): ChangePlan {
    const operations: ChangeOperation[] = []
    const currentMap = new Map(current.map((entry) => [entry.relativeFrame, entry]))
    const nextMap = new Map(next.map((entry) => [entry.relativeFrame, entry]))

    for (const [relativeFrame, currentKeyframe] of currentMap) {
      if (!nextMap.has(relativeFrame)) {
        operations.push({
          kind: 'animation-keyframe-delete',
          timelineItemId: item.id,
          frame: currentKeyframe.frame,
          groupId,
          relativeFrame,
        })
      }
    }

    for (const [relativeFrame, nextKeyframe] of nextMap) {
      const currentKeyframe = currentMap.get(relativeFrame)
      if (!currentKeyframe) {
        operations.push({
          kind: 'animation-keyframe-create',
          timelineItemId: item.id,
          frame: nextKeyframe.frame,
          groupId,
          keyframe: {
            frame: relativeFrame,
            cachedFrame: relativeFrame,
            position: nextKeyframe.position,
            value: cloneRecord(nextKeyframe.value),
            properties: cloneRecord(nextKeyframe.value),
            easing: nextKeyframe.easing,
          } as AnimateKeyframe<MediaType, PropertyAnimationGroupId>,
        })
        continue
      }

      if (!valuesEqual(currentKeyframe.value, nextKeyframe.value)) {
        operations.push({
          kind: 'animation-keyframe-update',
          timelineItemId: item.id,
          frame: nextKeyframe.frame,
          groupId,
          relativeFrame,
          value: cloneRecord(nextKeyframe.value) as PropertyAnimationValueByGroup<PropertyAnimationGroupId>,
        })
      }
    }

    operations.sort((left, right) => {
      const frameDelta = ('frame' in left ? left.frame : 0) - ('frame' in right ? right.frame : 0)
      if (frameDelta !== 0) return frameDelta
      return left.kind.localeCompare(right.kind)
    })

    return {
      propertyId: groupId === 'mask.linear' ? 'mask.center' : groupId,
      description,
      operations,
      toolMode: true,
    }
  }

  private summarizeDiff(current: TimelineKeyframeRecord[], next: TimelineKeyframeRecord[]) {
    const currentMap = new Map(current.map((entry) => [entry.frame, entry]))
    const nextMap = new Map(next.map((entry) => [entry.frame, entry]))
    const createdFrames: number[] = []
    const updatedFrames: number[] = []
    const deletedFrames: number[] = []

    for (const frame of currentMap.keys()) {
      if (!nextMap.has(frame)) {
        deletedFrames.push(frame)
      }
    }

    for (const [frame, nextEntry] of nextMap) {
      const currentEntry = currentMap.get(frame)
      if (!currentEntry) {
        createdFrames.push(frame)
        continue
      }
      if (!valuesEqual(currentEntry.value, nextEntry.value)) {
        updatedFrames.push(frame)
      }
    }

    return {
      createdFrames,
      updatedFrames,
      deletedFrames,
    }
  }

  private keyframeListsEqual(left: TimelineKeyframeRecord[], right: TimelineKeyframeRecord[]) {
    if (left.length !== right.length) return false
    return left.every((entry, index) => {
      const other = right[index]
      return (
        entry.frame === other.frame &&
        valuesEqual(entry.value, other.value) &&
        valuesEqual(entry.easing, other.easing)
      )
    })
  }
}
