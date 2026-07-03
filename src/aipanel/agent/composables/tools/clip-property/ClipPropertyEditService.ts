import { useUnifiedStore } from '@/core/unifiedStore'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { isBlendMode, type BlendMode } from '@/core/timelineitem/model/blendMode'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { getCurrentGroupValue, hasAnimation } from '@/core/animation/engine'
import type { DirectPropertyBatchPlanEntry } from '@/core/property-system/mutation'
import { propertyMutationCommitter } from '@/core/property-system/commit/PropertyMutationCommitter'
import type { ChangePlan, ChangeOperation } from '@/core/property-system'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from '../utils/timecode'
import {
  AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP,
} from '../shared/agentToolPropertyIds'

const NUMERIC_MATCH_EPSILON = 0.01
const NUMERIC_DISPLAY_DECIMALS = 2

type GroupId = 'visual' | 'audio' | 'text'
type ReadGroupId = GroupId | 'timeline'
type SupportedMediaType = UnifiedTimelineItemData['mediaType']
type KnownMediaType = Exclude<SupportedMediaType, 'unknown'>

type ReadClipPropertiesArgs = {
  clipId: string
  propertyGroups: ReadGroupId[]
  sampleTime?: string
}

type UpdateClipPropertiesArgs = {
  clipId: string
  match: Record<string, unknown>
  apply: Record<string, unknown>
}

type ReadSampleContext = {
  requestedSampleFrame: number
  requestedSampleTimecode: string
  effectiveSampleFrame: number
}

type PropertyPath =
  | 'visual.position.x'
  | 'visual.position.y'
  | 'visual.size.width'
  | 'visual.size.height'
  | 'visual.rotation'
  | 'visual.blendIntensity'
  | 'visual.blendMode'
  | 'visual.proportionalScale'
  | 'audio.volume'
  | 'audio.isMuted'
  | 'text.text'
  | 'text.style.fontFamily'
  | 'text.style.fontSize'
  | 'text.style.color'
  | 'text.style.fontWeight'
  | 'text.style.fontStyle'
  | 'text.style.backgroundColor'
  | 'text.style.textAlign'
  | 'text.style.textShadow'
  | 'text.style.textStroke'
  | 'text.style.textGlow'

type PathDefinition = {
  groupId: GroupId
  validate: (value: unknown) => { ok: true; value: unknown } | { ok: false; code: string; message: string; details?: Record<string, any> }
}

const GROUP_SUPPORT_MATRIX: Record<KnownMediaType, GroupId[]> = {
  video: ['visual', 'audio'],
  image: ['visual'],
  audio: ['audio'],
  text: ['visual', 'text'],
}

const PATH_DEFINITIONS: Record<PropertyPath, PathDefinition> = {
  'visual.position.x': { groupId: 'visual', validate: validateFiniteNumber('visual.position.x') },
  'visual.position.y': { groupId: 'visual', validate: validateFiniteNumber('visual.position.y') },
  'visual.size.width': { groupId: 'visual', validate: validatePositiveNumber('visual.size.width') },
  'visual.size.height': { groupId: 'visual', validate: validatePositiveNumber('visual.size.height') },
  'visual.rotation': { groupId: 'visual', validate: validateFiniteNumber('visual.rotation') },
  'visual.blendIntensity': { groupId: 'visual', validate: validateRangeNumber('visual.blendIntensity', 0, 1) },
  'visual.blendMode': { groupId: 'visual', validate: validateBlendMode },
  'visual.proportionalScale': { groupId: 'visual', validate: validateBoolean('visual.proportionalScale') },
  'audio.volume': { groupId: 'audio', validate: validateRangeNumber('audio.volume', 0, 1) },
  'audio.isMuted': { groupId: 'audio', validate: validateBoolean('audio.isMuted') },
  'text.text': { groupId: 'text', validate: validateString('text.text') },
  'text.style.fontFamily': { groupId: 'text', validate: validateString('text.style.fontFamily') },
  'text.style.fontSize': { groupId: 'text', validate: validatePositiveNumber('text.style.fontSize') },
  'text.style.color': { groupId: 'text', validate: validateString('text.style.color') },
  'text.style.fontWeight': { groupId: 'text', validate: validateFontWeight },
  'text.style.fontStyle': { groupId: 'text', validate: validateFontStyle },
  'text.style.backgroundColor': { groupId: 'text', validate: validateOptionalString('text.style.backgroundColor') },
  'text.style.textAlign': { groupId: 'text', validate: validateTextAlign },
  'text.style.textShadow': { groupId: 'text', validate: validateOptionalString('text.style.textShadow') },
  'text.style.textStroke': { groupId: 'text', validate: validateTextStroke },
  'text.style.textGlow': { groupId: 'text', validate: validateTextGlow },
}

export class ClipPropertyEditService {
  async readClipProperties(args: ReadClipPropertiesArgs) {
    const item = this.requireClip(args.clipId)
    const groupIds = normalizeReadGroupIds(args.propertyGroups)
    const sampleContext = this.resolveReadSampleContext(item, args.sampleTime)
    const groups: Partial<Record<ReadGroupId, Record<string, unknown>>> = {}

    for (const groupId of groupIds) {
      this.ensureReadGroupSupported(item, groupId)
      groups[groupId] = this.buildReadGroupProperties(
        item,
        groupId,
        sampleContext.effectiveSampleFrame,
      )
    }

    return {
      clipId: item.id,
      mediaType: item.mediaType,
      sampleTime: sampleContext.requestedSampleTimecode,
      groups,
    }
  }

  async updateClipProperties(args: UpdateClipPropertiesArgs) {
    const item = this.requireClip(args.clipId)
    validateApplyPayload(args.match, args.apply)

    const keys = Object.keys(args.apply) as PropertyPath[]
    const currentValues = this.buildCurrentPathValues(item)
    const normalizedPatchValues = normalizePatchValues(args.apply, currentValues)
    const resultKeys = getResultKeys(keys, normalizedPatchValues)

    for (const key of keys) {
      const definition = PATH_DEFINITIONS[key]
      if (!definition) {
        throw toolError('invalid_patch_path', `不支持的属性路径: ${key}`, { path: key })
      }
      this.ensureGroupSupported(item, definition.groupId)
      this.ensureStaticPropertyWritable(item, key)
      const validated = definition.validate(normalizedPatchValues[key])
      if (!validated.ok) {
        throw toolError(validated.code, validated.message, validated.details)
      }
      if (!isEqualValue(currentValues[key], args.match[key])) {
        throw toolError('match_failed', `属性匹配失败: ${key}`, {
          path: key,
          expected: args.match[key],
          actual: currentValues[key],
        })
      }
    }

    const before = pickValues(currentValues, resultKeys)
    const plan = this.buildPlan(item, resultKeys, normalizedPatchValues, currentValues)
    const after = { ...before, ...pickValues(normalizedPatchValues, resultKeys) }

    await useUnifiedStore().applyChangePlanWithHistory(plan)

    return {
      clipId: item.id,
      before,
      after,
    }
  }

  private resolveReadSampleContext(
    item: UnifiedTimelineItemData,
    sampleTime?: string,
  ): ReadSampleContext {
    const requestedSampleFrame =
      sampleTime !== undefined ? normalizeSampleTime(sampleTime) : useUnifiedStore().currentFrame
    const requestedSampleTimecode =
      sampleTime !== undefined ? sampleTime : framesToTimecode(requestedSampleFrame)

    return {
      requestedSampleFrame,
      requestedSampleTimecode,
      effectiveSampleFrame: clampFrame(
        requestedSampleFrame,
        item.timeRange.timelineStartTime,
        item.timeRange.timelineEndTime,
      ),
    }
  }

  private ensureStaticPropertyWritable(item: UnifiedTimelineItemData, key: PropertyPath) {
    const animationGroupId =
      AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP[
        key as keyof typeof AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP
      ]
    if (!animationGroupId || !hasAnimation(item, animationGroupId)) {
      return
    }

    throw toolError(
      'animated_property_requires_keyframe_tool',
      `属性 ${key} 当前由关键帧动画控制，不能通过 update_clip_properties 修改静态值。请改用 write_clip_keyframe 或 patch_clip_keyframe。`,
      {
        clipId: item.id,
        path: key,
        animationGroupId,
      },
    )
  }

  private requireClip(clipId: string) {
    if (!clipId || typeof clipId !== 'string') {
      throw toolError('invalid_arguments', 'clipId 必须是非空字符串')
    }

    const item = useUnifiedStore().getTimelineItem(clipId)
    if (!item) {
      throw toolError('clip_not_found', '未找到该时间轴片段。', { clipId })
    }
    return item
  }

  private ensureGroupSupported(item: UnifiedTimelineItemData, groupId: GroupId) {
    const supportedGroups = getSupportedGroups(item.mediaType)
    if (!['visual', 'audio', 'text'].includes(groupId)) {
      throw toolError('invalid_group', `无效的属性组: ${groupId}`, { groupId })
    }
    if (!supportedGroups.includes(groupId)) {
      throw toolError('group_not_supported', `该 clip 不支持属性组 ${groupId}`, {
        clipId: item.id,
        mediaType: item.mediaType,
        groupId,
        supportedGroups,
      })
    }
  }

  private ensureReadGroupSupported(item: UnifiedTimelineItemData, groupId: ReadGroupId) {
    if (groupId === 'timeline') {
      return
    }
    this.ensureGroupSupported(item, groupId)
  }

  private buildReadGroupProperties(
    item: UnifiedTimelineItemData,
    groupId: ReadGroupId,
    frame?: number,
  ) {
    if (groupId === 'timeline') {
      const timelineStart = item.timeRange.timelineStartTime
      const timelineEnd = item.timeRange.timelineEndTime
      return {
        trackId: item.trackId,
        start: framesToTimecode(timelineStart),
        end: framesToTimecode(timelineEnd),
        duration: framesToTimecode(timelineEnd - timelineStart),
        ...(item.mediaType === 'video' || item.mediaType === 'audio'
          ? {
              mediaId: item.mediaItemId ?? null,
              clipStart: framesToTimecode(item.timeRange.clipStartTime),
              clipEnd: framesToTimecode(item.timeRange.clipEndTime),
            }
          : {}),
      }
    }

    return this.buildGroupProperties(item, groupId, frame)
  }

  private buildGroupProperties(item: UnifiedTimelineItemData, groupId: GroupId, frame?: number) {
    if (groupId === 'visual') {
      const resolved = TimelineItemQueries.getResolvedRenderConfig(item)
      if (!('visual' in resolved)) {
        throw toolError('group_not_supported', `该 clip 不支持属性组 ${groupId}`, {
          clipId: item.id,
          mediaType: item.mediaType,
          groupId,
        })
      }
      const animatedPosition =
        frame !== undefined ? getCurrentGroupValue(item, frame, 'visual.position') : null
      const animatedSize = frame !== undefined ? getCurrentGroupValue(item, frame, 'visual.size') : null
      const animatedRotation =
        frame !== undefined ? getCurrentGroupValue(item, frame, 'visual.rotation') : null
      const animatedBlendIntensity =
        frame !== undefined ? getCurrentGroupValue(item, frame, 'visual.blendIntensity') : null
      return {
        position: {
          x: roundNumeric(animatedPosition?.x ?? resolved.visual.x),
          y: roundNumeric(animatedPosition?.y ?? resolved.visual.y),
        },
        size: {
          width: roundNumeric(animatedSize?.width ?? resolved.visual.width),
          height: roundNumeric(animatedSize?.height ?? resolved.visual.height),
        },
        rotation: roundNumeric(animatedRotation?.rotation ?? resolved.visual.rotation),
        blendIntensity: roundNumeric(
          animatedBlendIntensity?.blendIntensity ?? resolved.visual.blendIntensity,
        ),
        blendMode: resolved.visual.blendMode,
        proportionalScale: resolved.visual.proportionalScale,
      }
    }

    if (groupId === 'audio') {
      const resolved = TimelineItemQueries.getResolvedRenderConfig(item)
      if (!('audio' in resolved)) {
        throw toolError('group_not_supported', `该 clip 不支持属性组 ${groupId}`, {
          clipId: item.id,
          mediaType: item.mediaType,
          groupId,
        })
      }
      const animatedVolume = frame !== undefined ? getCurrentGroupValue(item, frame, 'audio.volume') : null
      return {
        volume: roundNumeric(animatedVolume?.volume ?? resolved.audio.volume),
        isMuted: resolved.audio.isMuted,
      }
    }

    const text = TimelineItemQueries.getBaseTextConfig(item)
    return {
      text: String(text?.text ?? ''),
      style: {
        fontFamily: nullIfUndefined(text?.style?.fontFamily),
        fontSize: nullIfUndefined(roundMaybeNumber(text?.style?.fontSize)),
        fontWeight: nullIfUndefined(text?.style?.fontWeight),
        fontStyle: nullIfUndefined(text?.style?.fontStyle),
        color: nullIfUndefined(text?.style?.color),
        backgroundColor: nullIfUndefined(text?.style?.backgroundColor),
        textAlign: nullIfUndefined(text?.style?.textAlign),
        textShadow: nullIfUndefined(text?.style?.textShadow),
        textStroke: nullIfUndefined(text?.style?.textStroke),
        textGlow: nullIfUndefined(text?.style?.textGlow),
      },
    }
  }

  private buildCurrentPathValues(item: UnifiedTimelineItemData): Record<PropertyPath, unknown> {
    const result: Partial<Record<PropertyPath, unknown>> = {}

    if (getSupportedGroups(item.mediaType).includes('visual')) {
      const visual = this.buildGroupProperties(item, 'visual')
      result['visual.position.x'] = visual.position?.x
      result['visual.position.y'] = visual.position?.y
      result['visual.size.width'] = visual.size?.width
      result['visual.size.height'] = visual.size?.height
      result['visual.rotation'] = visual.rotation
      result['visual.blendIntensity'] = visual.blendIntensity
      result['visual.blendMode'] = visual.blendMode
      result['visual.proportionalScale'] = visual.proportionalScale
    }

    if (getSupportedGroups(item.mediaType).includes('audio')) {
      const audio = this.buildGroupProperties(item, 'audio')
      result['audio.volume'] = audio.volume
      result['audio.isMuted'] = audio.isMuted
    }

    if (getSupportedGroups(item.mediaType).includes('text')) {
      const text = this.buildGroupProperties(item, 'text')
      result['text.text'] = text.text
      result['text.style.fontFamily'] = text.style?.fontFamily
      result['text.style.fontSize'] = text.style?.fontSize
      result['text.style.color'] = text.style?.color
      result['text.style.fontWeight'] = text.style?.fontWeight
      result['text.style.fontStyle'] = text.style?.fontStyle
      result['text.style.backgroundColor'] = text.style?.backgroundColor
      result['text.style.textAlign'] = text.style?.textAlign
      result['text.style.textShadow'] = text.style?.textShadow
      result['text.style.textStroke'] = text.style?.textStroke
      result['text.style.textGlow'] = text.style?.textGlow
    }

    return result as Record<PropertyPath, unknown>
  }

  private buildPlan(
    item: UnifiedTimelineItemData,
    keys: PropertyPath[],
    patch: Record<string, unknown>,
    currentValues: Record<PropertyPath, unknown>,
  ): ChangePlan {
    const frame = getCommitFrame(item)
    const context = {
      item,
      frame,
      applyChangePlan: useUnifiedStore().applyChangePlanWithHistory,
    }

    const directEntries: DirectPropertyBatchPlanEntry[] = []
    const visualConfigPatch: Record<string, unknown> = {}
    const audioConfigPatch: Record<string, unknown> = {}
    const nextPosition = {
      x: (patch['visual.position.x'] ?? currentValues['visual.position.x']) as number,
      y: (patch['visual.position.y'] ?? currentValues['visual.position.y']) as number,
    }
    const nextSize = {
      width: (patch['visual.size.width'] ?? currentValues['visual.size.width']) as number,
      height: (patch['visual.size.height'] ?? currentValues['visual.size.height']) as number,
    }

    for (const key of keys) {
      const value = patch[key]
      switch (key) {
        case 'visual.position.x':
        case 'visual.position.y':
          break
        case 'visual.size.width':
        case 'visual.size.height':
          break
        case 'visual.rotation':
          directEntries.push({ propertyId: 'visual.rotation', value })
          break
        case 'visual.blendIntensity':
          directEntries.push({ propertyId: 'visual.blendIntensity', value })
          break
        case 'audio.volume':
          directEntries.push({ propertyId: 'audio.volume', value })
          break
        case 'text.text':
          directEntries.push({ propertyId: 'text.content', value })
          break
        case 'text.style.fontFamily':
          directEntries.push({ propertyId: 'text.style.fontFamily', value })
          break
        case 'text.style.fontSize':
          directEntries.push({ propertyId: 'text.style.fontSize', value })
          break
        case 'text.style.color':
          directEntries.push({ propertyId: 'text.style.color', value })
          break
        case 'text.style.fontWeight':
          directEntries.push({ propertyId: 'text.style.fontWeight', value })
          break
        case 'text.style.fontStyle':
          directEntries.push({ propertyId: 'text.style.fontStyle', value })
          break
        case 'text.style.backgroundColor':
          directEntries.push({ propertyId: 'text.style.backgroundColor', value })
          break
        case 'text.style.textAlign':
          directEntries.push({ propertyId: 'text.style.textAlign', value })
          break
        case 'text.style.textShadow':
          directEntries.push({ propertyId: 'text.style.textShadow', value })
          break
        case 'text.style.textStroke':
          directEntries.push({ propertyId: 'text.style.textStroke', value })
          break
        case 'text.style.textGlow':
          directEntries.push({ propertyId: 'text.style.textGlow', value })
          break
        case 'visual.blendMode':
          visualConfigPatch.blendMode = value
          break
        case 'visual.proportionalScale':
          visualConfigPatch.proportionalScale = value
          break
        case 'audio.isMuted':
          audioConfigPatch.isMuted = value
          break
      }
    }

    if (keys.includes('visual.position.x') || keys.includes('visual.position.y')) {
      directEntries.push({ propertyId: 'visual.position', value: nextPosition })
    }

    if (keys.includes('visual.size.width') || keys.includes('visual.size.height')) {
      directEntries.push({ propertyId: 'visual.size', value: nextSize })
    }

    const operations: ChangeOperation[] = []

    if (Object.keys(visualConfigPatch).length > 0) {
      operations.push({
        kind: 'visual-config-patch',
        timelineItemId: item.id,
        frame,
        patch: visualConfigPatch,
      } as ChangeOperation)
    }

    if (Object.keys(audioConfigPatch).length > 0) {
      operations.push({
        kind: 'audio-config-patch',
        timelineItemId: item.id,
        frame,
        patch: audioConfigPatch,
      } as ChangeOperation)
    }

    if (directEntries.length > 0) {
      const mergedEntries = mergeDirectEntries(directEntries)
      for (const entry of mergedEntries) {
        operations.push(
          ...propertyMutationCommitter.createDirectPlan(
            context,
            entry.propertyId as never,
            entry.value,
          ).operations,
        )
      }
    }

    return {
      propertyId: getPlanPropertyId(keys),
      description: '修改 clip 属性',
      operations,
    }
  }
}

function normalizeReadGroupIds(groupIds: ReadGroupId[]) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    throw toolError('invalid_arguments', 'groupIds 必须是非空数组')
  }

  for (const groupId of groupIds) {
    if (!['visual', 'audio', 'text', 'timeline'].includes(groupId)) {
      throw toolError('invalid_group', `无效的属性组: ${groupId}`, { groupId })
    }
  }

  return Array.from(new Set(groupIds))
}

function normalizeSampleTime(sampleTime: unknown): number {
  if (typeof sampleTime !== 'string' || !isValidAgentToolTimecode(sampleTime)) {
    throw toolError('invalid_arguments', 'sampleTime 必须是格式为 HH:MM:SS+FF 的时间码')
  }
  return parseAgentToolTimecode(sampleTime)
}

function clampFrame(frame: number, min: number, max: number) {
  return Math.min(Math.max(frame, min), max)
}

function mergeDirectEntries(entries: DirectPropertyBatchPlanEntry[]): DirectPropertyBatchPlanEntry[] {
  const grouped = new Map<string, DirectPropertyBatchPlanEntry>()

  for (const entry of entries) {
    grouped.set(entry.propertyId, entry)
  }

  return Array.from(grouped.values())
}

function getPlanPropertyId(keys: PropertyPath[]): ChangePlan['propertyId'] {
  if (keys.some((key) => key.startsWith('text.'))) return 'text.content'
  if (keys.some((key) => key.startsWith('audio.'))) return 'audio.volume'
  return 'visual.position'
}

function getSupportedGroups(mediaType: SupportedMediaType): GroupId[] {
  return GROUP_SUPPORT_MATRIX[mediaType as KnownMediaType] ?? []
}

function normalizePatchValues(
  patch: Record<string, unknown>,
  currentValues: Record<PropertyPath, unknown>,
): Record<PropertyPath, unknown> {
  const normalized = { ...patch } as Record<PropertyPath, unknown>
  const nextProportionalScale = (patch['visual.proportionalScale'] ??
    currentValues['visual.proportionalScale']) as boolean | undefined
  const hasWidth = Object.prototype.hasOwnProperty.call(patch, 'visual.size.width')
  const hasHeight = Object.prototype.hasOwnProperty.call(patch, 'visual.size.height')

  if (!nextProportionalScale) {
    return normalized
  }

  if (hasWidth && hasHeight) {
    throw toolError(
      'invalid_arguments',
      '当 visual.proportionalScale 为 true 时，visual.size.width 和 visual.size.height 不能同时显式提供。请只修改其中一个，另一个会自动计算。',
    )
  }

  const currentWidth = currentValues['visual.size.width']
  const currentHeight = currentValues['visual.size.height']
  if (
    typeof currentWidth !== 'number' ||
    !Number.isFinite(currentWidth) ||
    currentWidth <= 0 ||
    typeof currentHeight !== 'number' ||
    !Number.isFinite(currentHeight) ||
    currentHeight <= 0
  ) {
    return normalized
  }

  if (hasWidth) {
    const nextWidth = normalized['visual.size.width']
    if (typeof nextWidth === 'number' && Number.isFinite(nextWidth) && nextWidth > 0) {
      normalized['visual.size.height'] = roundNumeric((nextWidth * currentHeight) / currentWidth)
    }
  }

  if (hasHeight) {
    const nextHeight = normalized['visual.size.height']
    if (typeof nextHeight === 'number' && Number.isFinite(nextHeight) && nextHeight > 0) {
      normalized['visual.size.width'] = roundNumeric((nextHeight * currentWidth) / currentHeight)
    }
  }

  return normalized
}

function getResultKeys(
  keys: PropertyPath[],
  normalizedPatchValues: Record<PropertyPath, unknown>,
): PropertyPath[] {
  const resultKeys = new Set(keys)

  if (
    Object.prototype.hasOwnProperty.call(normalizedPatchValues, 'visual.size.width') &&
    !resultKeys.has('visual.size.width')
  ) {
    resultKeys.add('visual.size.width')
  }

  if (
    Object.prototype.hasOwnProperty.call(normalizedPatchValues, 'visual.size.height') &&
    !resultKeys.has('visual.size.height')
  ) {
    resultKeys.add('visual.size.height')
  }

  return Array.from(resultKeys)
}

function getCommitFrame(item: UnifiedTimelineItemData): number {
  const currentFrame = useUnifiedStore().currentFrame
  if (currentFrame >= item.timeRange.timelineStartTime && currentFrame < item.timeRange.timelineEndTime) {
    return currentFrame
  }
  return item.timeRange.timelineStartTime
}

function validateApplyPayload(match: Record<string, unknown>, apply: Record<string, unknown>) {
  if (!isPlainObject(match) || !isPlainObject(apply)) {
    throw toolError('invalid_arguments', 'match 和 apply 必须是对象')
  }

  const matchKeys = Object.keys(match).sort()
  const applyKeys = Object.keys(apply).sort()

  if (matchKeys.length === 0 || applyKeys.length === 0) {
    throw toolError('invalid_arguments', 'match 和 apply 不能为空')
  }

  if (matchKeys.length !== applyKeys.length || matchKeys.some((key, index) => key !== applyKeys[index])) {
    throw toolError('invalid_arguments', 'match 与 apply 的 key 集合必须一致', {
      matchKeys,
      applyKeys,
    })
  }
}

function validateFiniteNumber(path: string) {
  return (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是有限数字` }
    }
    return { ok: true as const, value }
  }
}

function validatePositiveNumber(path: string) {
  return (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是有限数字` }
    }
    if (value <= 0) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须大于 0` }
    }
    return { ok: true as const, value }
  }
}

function validateRangeNumber(path: string, min: number, max: number) {
  return (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是数字` }
    }
    if (value < min || value > max) {
      return {
        ok: false as const,
        code: 'invalid_value_type',
        message: `${path} 必须在 ${min} 到 ${max} 之间`,
      }
    }
    return { ok: true as const, value }
  }
}

function validateBoolean(path: string) {
  return (value: unknown) => {
    if (typeof value !== 'boolean') {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是布尔值` }
    }
    return { ok: true as const, value }
  }
}

function validateString(path: string) {
  return (value: unknown) => {
    if (typeof value !== 'string') {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是字符串` }
    }
    return { ok: true as const, value }
  }
}

function validateOptionalString(path: string) {
  return (value: unknown) => {
    if (value !== undefined && typeof value !== 'string') {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是字符串或 undefined` }
    }
    return { ok: true as const, value }
  }
}

function validateFontWeight(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.fontWeight 必须是字符串或数字',
    }
  }
  return { ok: true as const, value }
}

function validateFontStyle(value: unknown) {
  if (value !== 'normal' && value !== 'italic') {
    return {
      ok: false as const,
      code: 'invalid_enum_value',
      message: 'text.style.fontStyle 必须是 normal 或 italic',
    }
  }
  return { ok: true as const, value }
}

function validateTextAlign(value: unknown) {
  if (value !== 'left' && value !== 'center' && value !== 'right') {
    return {
      ok: false as const,
      code: 'invalid_enum_value',
      message: 'text.style.textAlign 必须是 left、center 或 right',
    }
  }
  return { ok: true as const, value }
}

function validateTextStroke(value: unknown) {
  if (!isPlainObject(value)) {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textStroke 必须是对象',
    }
  }
  if (typeof value.width !== 'number' || !Number.isFinite(value.width)) {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textStroke.width 必须是数字',
    }
  }
  if (typeof value.color !== 'string') {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textStroke.color 必须是字符串',
    }
  }
  return { ok: true as const, value }
}

function validateTextGlow(value: unknown) {
  if (!isPlainObject(value)) {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textGlow 必须是对象',
    }
  }
  if (typeof value.color !== 'string') {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textGlow.color 必须是字符串',
    }
  }
  if (typeof value.blur !== 'number' || !Number.isFinite(value.blur)) {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textGlow.blur 必须是数字',
    }
  }
  if (
    value.spread !== undefined &&
    (typeof value.spread !== 'number' || !Number.isFinite(value.spread))
  ) {
    return {
      ok: false as const,
      code: 'invalid_value_type',
      message: 'text.style.textGlow.spread 必须是数字',
    }
  }
  return { ok: true as const, value }
}

function validateBlendMode(value: unknown) {
  if (!isBlendMode(value)) {
    return {
      ok: false as const,
      code: 'invalid_enum_value',
      message: 'visual.blendMode 不是支持的 blendMode',
    }
  }
  return { ok: true as const, value: value as BlendMode }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickValues(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]))
}

function isEqualValue(a: unknown, b: unknown): boolean {
  if (isNullish(a) && isNullish(b)) {
    return true
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= NUMERIC_MATCH_EPSILON
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function roundNumeric(value: number): number {
  return Number(value.toFixed(NUMERIC_DISPLAY_DECIMALS))
}

function roundMaybeNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return value
  }
  return roundNumeric(value)
}

function nullIfUndefined<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function toolError(code: string, message: string, details?: Record<string, any>) {
  const error = new Error(message) as Error & {
    toolCode?: string
    toolDetails?: Record<string, any>
  }
  error.toolCode = code
  error.toolDetails = details
  return error
}
