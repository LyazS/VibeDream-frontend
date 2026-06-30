import { useUnifiedStore } from '@/core/unifiedStore'
import { AnimationRegistry } from '@/core/animation/registry'
import {
  getRelativeFrame,
  getPosition,
  getSupportedAnimationGroups,
  getTrack,
} from '@/core/animation/engine'
import type { MediaType } from '@/core/mediaitem'
import type { ChangeOperation, ChangePlan } from '@/core/property-system'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type {
  AnimateKeyframe,
  PropertyAnimationGroupId,
  PropertyAnimationValueByGroup,
} from '@/core/timelineitem/model/render'

type ToolChannelId =
  | 'visual.position'
  | 'visual.size'
  | 'visual.rotation'
  | 'visual.blendIntensity'
  | 'audio.volume'

type ExternalKeyframeValue = number | Record<string, unknown>

type KeyframePayload = {
  frame: number
  value: ExternalKeyframeValue
  easing?: {
    type: 'linear'
  }
}

type ReadArgs = {
  clipId: string
  channelId: string
}

type WriteArgs = {
  clipId: string
  channelId: string
  keyframes: KeyframePayload[]
  options?: {
    frameMode?: 'absolute'
    replaceMode?: 'entire-channel'
    atomic?: boolean
    normalizeBeforeApply?: boolean
  }
}

type DiffApplyArgs = {
  clipId: string
  channelId: string
  match: KeyframePayload[]
  apply: KeyframePayload[]
  options?: {
    onMismatch?: 'reject'
    frameMode?: 'absolute'
    atomic?: boolean
  }
}

type SerializedKeyframeRecord = {
  frame: number
  relativeFrame: number
  position: number
  value: ExternalKeyframeValue
  easing: {
    type: 'linear'
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

const SUPPORTED_TOOL_CHANNEL_IDS: ToolChannelId[] = [
  'visual.position',
  'visual.size',
  'visual.rotation',
  'visual.blendIntensity',
  'audio.volume',
]

const CHANNEL_VALUE_SHAPES: Record<
  ToolChannelId,
  {
    kind: 'scalar' | 'object'
    keys: readonly string[]
  }
> = {
  'visual.position': { kind: 'object', keys: ['x', 'y'] },
  'visual.size': { kind: 'object', keys: ['width', 'height'] },
  'visual.rotation': { kind: 'scalar', keys: ['rotation'] },
  'visual.blendIntensity': { kind: 'scalar', keys: ['blendIntensity'] },
  'audio.volume': { kind: 'scalar', keys: ['volume'] },
}

function cloneJson<T>(value: T): T {
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

function isToolChannelId(groupId: string): groupId is ToolChannelId {
  return SUPPORTED_TOOL_CHANNEL_IDS.includes(groupId as ToolChannelId)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export class KeyframeChannelEditService {
  async readClipKeyframe(args: ReadArgs) {
    const item = this.requireClip(args.clipId)
    const groupId = this.requireSupportedGroup(item, args.channelId)
    const keyframes = this.readTimelineKeyframes(item, groupId)

    return {
      clipId: item.id,
      mediaType: item.mediaType,
      channelId: groupId,
      timelineRange: {
        startFrame: item.timeRange.timelineStartTime,
        endFrame: item.timeRange.timelineEndTime,
        durationFrames: item.timeRange.timelineEndTime - item.timeRange.timelineStartTime,
      },
      keyframes: keyframes.map((entry) => this.serializeTimelineKeyframe(groupId, entry)),
    }
  }

  async writeClipKeyframe(args: WriteArgs) {
    const item = this.requireClip(args.clipId)
    const groupId = this.requireSupportedGroup(item, args.channelId)
    this.assertFrameMode(args.options?.frameMode)

    const current = this.readTimelineKeyframes(item, groupId)
    const next = this.normalizeInputKeyframes(item, groupId, args.keyframes, 'keyframes')
    const plan = this.buildPlan(item, groupId, current, next, `重写 ${args.channelId} 关键帧`)
    const diff = this.summarizeDiff(current, next)

    if (plan.operations.length > 0) {
      await useUnifiedStore().applyChangePlanWithHistory(plan)
    }

    return {
      clipId: item.id,
      channelId: groupId,
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

  async patchClipKeyframe(args: DiffApplyArgs) {
    const item = this.requireClip(args.clipId)
    const groupId = this.requireSupportedGroup(item, args.channelId)
    this.assertFrameMode(args.options?.frameMode)

    const current = this.readTimelineKeyframes(item, groupId)
    const expected = this.normalizeInputKeyframes(item, groupId, args.match ?? [], 'match')
    if (expected.length === 0) {
      throw toolError('invalid_arguments', 'match 至少需要 1 个关键帧', {
        field: 'match',
      })
    }

    const startFrame = expected[0].frame
    const endFrame = expected[expected.length - 1].frame

    const replacement = this.normalizeInputKeyframes(item, groupId, args.apply ?? [], 'apply')
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

    const plan = this.buildPlan(item, groupId, current, next, `局部更新 ${args.channelId} 关键帧`)

    if (plan.operations.length > 0) {
      await useUnifiedStore().applyChangePlanWithHistory(plan)
    }

    const afterRangeStartFrame = replacement.length > 0 ? replacement[0].frame : startFrame
    const afterRangeEndFrame =
      replacement.length > 0 ? replacement[replacement.length - 1].frame : endFrame

    return {
      clipId: item.id,
      channelId: groupId,
      beforeHasLeadingOmitted: current.some((entry) => entry.frame < startFrame),
      beforeHasTrailingOmitted: current.some((entry) => entry.frame > endFrame),
      before: matched.map((entry) => this.serializeFrameValue(groupId, entry)),
      afterHasLeadingOmitted: next.some((entry) => entry.frame < afterRangeStartFrame),
      afterHasTrailingOmitted: next.some((entry) => entry.frame > afterRangeEndFrame),
      after: replacement.map((entry) => this.serializeFrameValue(groupId, entry)),
    }
  }

  private requireClip(clipId: string) {
    if (!clipId || typeof clipId !== 'string') {
      throw toolError('invalid_arguments', 'clipId 必须是非空字符串', { field: 'clipId', clipId })
    }
    const item = useUnifiedStore().getTimelineItem(clipId)
    if (!item) {
      throw toolError('clip_not_found', '未找到该时间轴片段。', { clipId })
    }
    return item
  }

  private requireSupportedGroup(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: string,
  ): ToolChannelId {
    if (!groupId || typeof groupId !== 'string') {
      throw toolError('invalid_group', 'groupId 必须是非空字符串')
    }
    if (!isToolChannelId(groupId)) {
      throw toolError('invalid_group', `不支持的关键帧通道 ${groupId}`, {
        groupId,
        supportedGroups: SUPPORTED_TOOL_CHANNEL_IDS,
      })
    }
    const definition = AnimationRegistry.get(groupId)
    if (!definition.supports(item)) {
      throw toolError('group_not_supported', `该 clip 不支持关键帧组 ${groupId}`, {
        clipId: item.id,
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
      value: cloneJson(keyframe.value as Record<string, unknown>),
      easing: normalizeLinearEasing(keyframe.easing),
    }
  }

  private normalizeInputKeyframes(
    item: UnifiedTimelineItemData<MediaType>,
    groupId: ToolChannelId,
    keyframes: KeyframePayload[],
    fieldName: 'keyframes' | 'match' | 'apply',
  ): TimelineKeyframeRecord[] {
    if (!Array.isArray(keyframes)) {
      throw toolError('invalid_arguments', `${fieldName} 必须是数组`, { field: fieldName })
    }
    return this.normalizeTimelineKeyframes(
      keyframes.map((entry, index) => {
        const frame = normalizeFrame(entry?.frame, `${fieldName}[${index}].frame`)
        this.assertFrameInRange(item, frame)
        const value = this.normalizeGroupValue(groupId, entry?.value, `${fieldName}[${index}].value`)
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
    groupId: ToolChannelId,
    value: unknown,
    field: string,
  ): Record<string, unknown> {
    const shape = CHANNEL_VALUE_SHAPES[groupId]

    if (shape.kind === 'scalar') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw toolError(
          'invalid_value',
          `${field} 的值类型不正确：${groupId} 需要 number，当前收到 ${this.describeValueType(value)}。`,
          { field, groupId, expectedShape: 'number', value },
        )
      }
      const normalizedValue =
        groupId === 'visual.blendIntensity' || groupId === 'audio.volume' ? clamp01(value) : value
      return { [shape.keys[0]]: normalizedValue }
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw toolError(
        'invalid_value',
        `${field} 的值类型不正确：${groupId} 需要对象，当前收到 ${this.describeValueType(value)}。`,
        { field, groupId, expectedShape: 'object', expectedKeys: shape.keys, value },
      )
    }
    const nextValue = value as Record<string, unknown>
    const nextKeys = Object.keys(nextValue)
    if (shape.keys.length !== nextKeys.length || !shape.keys.every((key) => nextKeys.includes(key))) {
      throw toolError('invalid_value_shape', `关键帧值结构不匹配: ${groupId}`, {
        groupId,
        field,
        expectedKeys: shape.keys,
        actualKeys: nextKeys,
      })
    }
    for (const key of shape.keys) {
      const entry = nextValue[key]
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw toolError('invalid_value', `关键帧值必须是有限数字: ${groupId}.${key}`, {
          field,
          groupId,
          key,
          value: entry,
        })
      }
    }
    return cloneJson(nextValue)
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
            value: cloneJson(nextKeyframe.value),
            properties: cloneJson(nextKeyframe.value),
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
          value: cloneJson(nextKeyframe.value) as PropertyAnimationValueByGroup<PropertyAnimationGroupId>,
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

  private serializeTimelineKeyframe(
    groupId: ToolChannelId,
    entry: TimelineKeyframeRecord,
  ): SerializedKeyframeRecord {
    return {
      frame: entry.frame,
      relativeFrame: entry.relativeFrame,
      position: entry.position,
      value: this.serializeValue(groupId, entry.value),
      easing: entry.easing,
    }
  }

  private serializeFrameValue(groupId: ToolChannelId, entry: TimelineKeyframeRecord) {
    return {
      frame: entry.frame,
      value: this.serializeValue(groupId, entry.value),
    }
  }

  private serializeValue(groupId: ToolChannelId, value: Record<string, unknown>): ExternalKeyframeValue {
    const shape = CHANNEL_VALUE_SHAPES[groupId]
    if (shape.kind === 'scalar') {
      return value[shape.keys[0]] as number
    }
    return cloneJson(value)
  }

  private summarizeDiff(current: TimelineKeyframeRecord[], next: TimelineKeyframeRecord[]) {
    const currentMap = new Map(current.map((entry) => [entry.frame, entry]))
    const nextMap = new Map(next.map((entry) => [entry.frame, entry]))
    const createdFrames = next
      .filter((entry) => !currentMap.has(entry.frame))
      .map((entry) => entry.frame)
    const updatedFrames = next
      .filter((entry) => {
        const previous = currentMap.get(entry.frame)
        return (
          previous &&
          (!valuesEqual(previous.value, entry.value) || !valuesEqual(previous.easing, entry.easing))
        )
      })
      .map((entry) => entry.frame)
    const deletedFrames = current
      .filter((entry) => !nextMap.has(entry.frame))
      .map((entry) => entry.frame)

    return {
      createdFrames,
      updatedFrames,
      deletedFrames,
    }
  }

  private describeValueType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }
}
