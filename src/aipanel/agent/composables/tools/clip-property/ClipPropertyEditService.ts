import { useUnifiedStore } from '@/core/unifiedStore'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { isBlendMode, type BlendMode } from '@/core/timelineitem/model/blendMode'
import {
  applyMaskGroupValue,
  getItemLocalSize,
  getMaskEllipseSizeValue,
  getMaskMirrorValue,
  getMaskRectangleCornerRadiusValue,
  getMaskRectangleSizeValue,
  normalizeMaskConfig,
  replaceMaskType,
  type MaskType,
} from '@/core/timelineitem/features/mask'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { getCurrentGroupValue, hasAnimation } from '@/core/animation/engine'
import type { DirectPropertyBatchPlanEntry } from '@/core/property-system/mutation'
import { propertyMutationCommitter } from '@/core/property-system/commit/PropertyMutationCommitter'
import {
  AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP,
  CLIP_PROPERTY_PATH_DEFINITIONS,
  getSupportedClipPropertyGroups,
  type ChangePlan,
  type ChangeOperation,
  type ClipPropertyGroupId,
  type ClipPropertyPath,
} from '@/core/property-system'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from '../utils/timecode'

const NUMERIC_MATCH_EPSILON = 0.01
const NUMERIC_DISPLAY_DECIMALS = 2

type ReadGroupId = ClipPropertyGroupId | 'timeline'

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

type PathDefinition = {
  groupId: ClipPropertyGroupId
  validate: (value: unknown) => { ok: true; value: unknown } | { ok: false; code: string; message: string; details?: Record<string, any> }
}

const MASK_ANIMATION_GROUP_IDS = [
  'mask.center',
  'mask.rotation',
  'mask.feather',
  'mask.intensity',
  'mask.rectangle.size',
  'mask.rectangle.cornerRadius',
  'mask.ellipse.size',
  'mask.mirror.length',
] as const

type MaskAnimationGroupId = (typeof MASK_ANIMATION_GROUP_IDS)[number]

const PATH_VALIDATORS = {
  'visual.position.x': validateFiniteNumber('visual.position.x'),
  'visual.position.y': validateFiniteNumber('visual.position.y'),
  'visual.size.width': validatePositiveNumber('visual.size.width'),
  'visual.size.height': validatePositiveNumber('visual.size.height'),
  'visual.rotation': validateFiniteNumber('visual.rotation'),
  'visual.blendIntensity': validateRangeNumber('visual.blendIntensity', 0, 1),
  'visual.blendMode': validateBlendMode,
  'visual.proportionalScale': validateBoolean('visual.proportionalScale'),
  'audio.volume': validateRangeNumber('audio.volume', 0, 1),
  'audio.isMuted': validateBoolean('audio.isMuted'),
  'mask.enabled': validateBoolean('mask.enabled'),
  'mask.type': validateMaskType,
  'mask.inverted': validateBoolean('mask.inverted'),
  'mask.center.x': validateFiniteNumber('mask.center.x'),
  'mask.center.y': validateFiniteNumber('mask.center.y'),
  'mask.rotation': validateFiniteNumber('mask.rotation'),
  'mask.feather': validateFiniteNumber('mask.feather'),
  'mask.intensity': validateRangeNumber('mask.intensity', 0, 1),
  'mask.rectangle.size.width': validateFiniteNumber('mask.rectangle.size.width'),
  'mask.rectangle.size.height': validateFiniteNumber('mask.rectangle.size.height'),
  'mask.rectangle.cornerRadius': validateRangeNumber('mask.rectangle.cornerRadius', 0, 1),
  'mask.ellipse.size.width': validateFiniteNumber('mask.ellipse.size.width'),
  'mask.ellipse.size.height': validateFiniteNumber('mask.ellipse.size.height'),
  'mask.mirror.length': validateNonNegativeNumber('mask.mirror.length'),
  'text.content': validateString('text.content'),
  'text.style.fontFamily': validateString('text.style.fontFamily'),
  'text.style.fontSize': validatePositiveNumber('text.style.fontSize'),
  'text.style.color': validateString('text.style.color'),
  'text.style.fontWeight': validateFontWeight,
  'text.style.fontStyle': validateFontStyle,
  'text.style.backgroundColor': validateOptionalString('text.style.backgroundColor'),
  'text.style.textAlign': validateTextAlign,
  'text.style.textShadow': validateOptionalString('text.style.textShadow'),
  'text.style.textStroke': validateTextStroke,
  'text.style.textGlow': validateTextGlow,
} as const satisfies Record<ClipPropertyPath, PathDefinition['validate']>

const PATH_DEFINITIONS = Object.fromEntries(
  CLIP_PROPERTY_PATH_DEFINITIONS.map((definition) => [
    definition.path,
    {
      groupId: definition.groupId,
      validate: PATH_VALIDATORS[definition.path],
    },
  ]),
) as Record<ClipPropertyPath, PathDefinition>

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

    const keys = Object.keys(args.apply) as ClipPropertyPath[]
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
      this.ensureMaskPathCompatible(key, normalizedPatchValues, currentValues)
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

  private ensureStaticPropertyWritable(item: UnifiedTimelineItemData, key: ClipPropertyPath) {
    const animationGroupId =
      AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP[
        key as keyof typeof AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP
      ]
    if (!animationGroupId || !hasAnimation(item, animationGroupId)) {
      return
    }

    throw toolError(
      'animated_property_requires_keyframe_tool',
      `属性 ${key} 当前由关键帧动画控制，不能通过 update_item 修改静态值。请改用 write_clip_keyframe 或 patch_clip_keyframe。`,
      {
        clipId: item.id,
        path: key,
        animationGroupId,
      },
    )
  }

  private ensureMaskPathCompatible(
    key: ClipPropertyPath,
    patch: Record<ClipPropertyPath, unknown>,
    currentValues: Record<ClipPropertyPath, unknown>,
  ) {
    if (!key.startsWith('mask.')) {
      return
    }

    const effectiveType = getEffectiveMaskType(patch, currentValues)
    const requiredType = getRequiredMaskTypeForPath(key)
    if (!requiredType || effectiveType === requiredType) {
      return
    }

    throw toolError('mask_type_mismatch', `属性 ${key} 仅支持 ${requiredType} 类型的蒙版。`, {
      path: key,
      requiredMaskType: requiredType,
      actualMaskType: effectiveType,
    })
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

  private ensureGroupSupported(item: UnifiedTimelineItemData, groupId: ClipPropertyGroupId) {
    const supportedGroups = getSupportedGroups(item.mediaType)
    if (!['visual', 'audio', 'text', 'mask'].includes(groupId)) {
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

  private buildGroupProperties(item: UnifiedTimelineItemData, groupId: ClipPropertyGroupId, frame?: number) {
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

    if (groupId === 'mask') {
      const { mask, textureSize } = this.buildMaskConfig(item, frame)
      const rectangle = getMaskRectangleSizeValue(mask, textureSize)
      const rectangleCornerRadius = getMaskRectangleCornerRadiusValue(mask, textureSize)
      const ellipse = getMaskEllipseSizeValue(mask, textureSize)
      const mirror = getMaskMirrorValue(mask, textureSize)

      return {
        enabled: mask.enabled,
        type: mask.type,
        inverted: mask.inverted,
        center: {
          x: roundNumeric(mask.centerX),
          y: roundNumeric(mask.centerY),
        },
        rotation: roundNumeric(mask.rotation),
        feather: roundNumeric(mask.falloff.outerRange),
        intensity: roundNumeric(mask.falloff.decayRate),
        ...(mask.type === 'rectangle'
          ? {
              rectangle: {
                width: roundNumeric(rectangle.width),
                height: roundNumeric(rectangle.height),
                cornerRadius: roundNumeric(rectangleCornerRadius.cornerRadius),
              },
            }
          : {}),
        ...(mask.type === 'ellipse'
          ? {
              ellipse: {
                width: roundNumeric(ellipse.ellipseWidth),
                height: roundNumeric(ellipse.ellipseHeight),
              },
            }
          : {}),
        ...(mask.type === 'mirror'
          ? {
              mirror: {
                length: roundNumeric(mirror.length),
              },
            }
          : {}),
      }
    }

    const text = TimelineItemQueries.getBaseTextConfig(item)
    return {
      content: String(text?.content ?? ''),
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

  private buildMaskConfig(item: UnifiedTimelineItemData, frame?: number) {
    const textureSize = this.getMaskTextureSize(item, frame)
    let mask = normalizeMaskConfig(TimelineItemQueries.getBaseMask(item), textureSize)

    if (frame === undefined) {
      return { mask, textureSize }
    }

    for (const groupId of MASK_ANIMATION_GROUP_IDS) {
      if (!hasAnimation(item, groupId)) {
        continue
      }

      mask = applyMaskGroupValue(
        mask,
        groupId,
        getCurrentGroupValue(item, frame, groupId),
        textureSize,
      )
    }

    return { mask, textureSize }
  }

  private getMaskTextureSize(item: UnifiedTimelineItemData, frame?: number) {
    const resolved = TimelineItemQueries.getResolvedRenderConfig(item)
    if (!('visual' in resolved)) {
      throw toolError('group_not_supported', '该 clip 不支持属性组 mask', {
        clipId: item.id,
        mediaType: item.mediaType,
        groupId: 'mask',
      })
    }

    const animatedSize =
      frame !== undefined ? getCurrentGroupValue(item, frame, 'visual.size') : null
    const width = animatedSize?.width ?? resolved.visual.width ?? 0
    const height = animatedSize?.height ?? resolved.visual.height ?? 0
    return getItemLocalSize(width, height)
  }

  private buildCurrentPathValues(item: UnifiedTimelineItemData): Record<ClipPropertyPath, unknown> {
    const result: Partial<Record<ClipPropertyPath, unknown>> = {}

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

    if (getSupportedGroups(item.mediaType).includes('mask')) {
      const { mask, textureSize } = this.buildMaskConfig(item)
      const rectangle = getMaskRectangleSizeValue(mask, textureSize)
      const rectangleCornerRadius = getMaskRectangleCornerRadiusValue(mask, textureSize)
      const ellipse = getMaskEllipseSizeValue(mask, textureSize)
      const mirror = getMaskMirrorValue(mask, textureSize)

      result['mask.enabled'] = mask.enabled
      result['mask.type'] = mask.type
      result['mask.inverted'] = mask.inverted
      result['mask.center.x'] = roundNumeric(mask.centerX)
      result['mask.center.y'] = roundNumeric(mask.centerY)
      result['mask.rotation'] = roundNumeric(mask.rotation)
      result['mask.feather'] = roundNumeric(mask.falloff.outerRange)
      result['mask.intensity'] = roundNumeric(mask.falloff.decayRate)
      result['mask.rectangle.size.width'] = roundNumeric(rectangle.width)
      result['mask.rectangle.size.height'] = roundNumeric(rectangle.height)
      result['mask.rectangle.cornerRadius'] = roundNumeric(rectangleCornerRadius.cornerRadius)
      result['mask.ellipse.size.width'] = roundNumeric(ellipse.ellipseWidth)
      result['mask.ellipse.size.height'] = roundNumeric(ellipse.ellipseHeight)
      result['mask.mirror.length'] = roundNumeric(mirror.length)
    }

    if (getSupportedGroups(item.mediaType).includes('text')) {
      const text = this.buildGroupProperties(item, 'text')
      result['text.content'] = text.content
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

    return result as Record<ClipPropertyPath, unknown>
  }

  private buildPlan(
    item: UnifiedTimelineItemData,
    keys: ClipPropertyPath[],
    patch: Record<string, unknown>,
    currentValues: Record<ClipPropertyPath, unknown>,
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
    const supportsMask = getSupportedGroups(item.mediaType).includes('mask')
    const maskContext = supportsMask ? this.buildMaskConfig(item) : null
    const hasMaskConfigPatch =
      supportsMask &&
      (Object.prototype.hasOwnProperty.call(patch, 'mask.enabled') ||
        Object.prototype.hasOwnProperty.call(patch, 'mask.type') ||
        Object.prototype.hasOwnProperty.call(patch, 'mask.inverted'))
    const nextMaskConfig =
      supportsMask && maskContext
        ? (() => {
            let nextMask = maskContext.mask
            if (Object.prototype.hasOwnProperty.call(patch, 'mask.type')) {
              nextMask = replaceMaskType(
                nextMask,
                patch['mask.type'] as MaskType,
                maskContext.textureSize,
              )
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'mask.enabled')) {
              nextMask = {
                ...nextMask,
                enabled: patch['mask.enabled'] as boolean,
              }
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'mask.inverted')) {
              nextMask = {
                ...nextMask,
                inverted: patch['mask.inverted'] as boolean,
              }
            }
            return nextMask
          })()
        : null
    const nextPosition = {
      x: (patch['visual.position.x'] ?? currentValues['visual.position.x']) as number,
      y: (patch['visual.position.y'] ?? currentValues['visual.position.y']) as number,
    }
    const nextSize = {
      width: (patch['visual.size.width'] ?? currentValues['visual.size.width']) as number,
      height: (patch['visual.size.height'] ?? currentValues['visual.size.height']) as number,
    }
    const nextMaskCenter = {
      centerX: (patch['mask.center.x'] ?? currentValues['mask.center.x']) as number,
      centerY: (patch['mask.center.y'] ?? currentValues['mask.center.y']) as number,
    }
    const nextMaskRectangleSize = {
      width: (patch['mask.rectangle.size.width'] ??
        currentValues['mask.rectangle.size.width']) as number,
      height: (patch['mask.rectangle.size.height'] ??
        currentValues['mask.rectangle.size.height']) as number,
    }
    const nextMaskEllipseSize = {
      ellipseWidth: (patch['mask.ellipse.size.width'] ??
        currentValues['mask.ellipse.size.width']) as number,
      ellipseHeight: (patch['mask.ellipse.size.height'] ??
        currentValues['mask.ellipse.size.height']) as number,
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
        case 'mask.enabled':
        case 'mask.type':
        case 'mask.inverted':
        case 'mask.center.x':
        case 'mask.center.y':
        case 'mask.rectangle.size.width':
        case 'mask.rectangle.size.height':
        case 'mask.ellipse.size.width':
        case 'mask.ellipse.size.height':
          break
        case 'mask.rotation':
          directEntries.push({ propertyId: 'mask.rotation', value })
          break
        case 'mask.feather':
          directEntries.push({ propertyId: 'mask.feather', value })
          break
        case 'mask.intensity':
          directEntries.push({ propertyId: 'mask.intensity', value })
          break
        case 'mask.rectangle.cornerRadius':
          directEntries.push({ propertyId: 'mask.rectangle.cornerRadius', value })
          break
        case 'mask.mirror.length':
          directEntries.push({ propertyId: 'mask.mirror.length', value })
          break
        case 'text.content':
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

    if (keys.includes('mask.center.x') || keys.includes('mask.center.y')) {
      directEntries.push({ propertyId: 'mask.center', value: nextMaskCenter })
    }

    if (
      keys.includes('mask.rectangle.size.width') ||
      keys.includes('mask.rectangle.size.height')
    ) {
      directEntries.push({ propertyId: 'mask.rectangle.size', value: nextMaskRectangleSize })
    }

    if (
      keys.includes('mask.ellipse.size.width') ||
      keys.includes('mask.ellipse.size.height')
    ) {
      directEntries.push({ propertyId: 'mask.ellipse.size', value: nextMaskEllipseSize })
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

    if (hasMaskConfigPatch && nextMaskConfig) {
      operations.push({
        kind: 'extra-render-config-patch',
        timelineItemId: item.id,
        frame,
        patch: {
          mask: nextMaskConfig,
        },
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
    if (!['visual', 'audio', 'text', 'mask', 'timeline'].includes(groupId)) {
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

function getPlanPropertyId(keys: ClipPropertyPath[]): ChangePlan['propertyId'] {
  if (keys.some((key) => key.startsWith('text.'))) return 'text.content'
  if (keys.some((key) => key.startsWith('audio.'))) return 'audio.volume'
  if (keys.some((key) => key.startsWith('mask.'))) {
    const firstMaskKey = keys.find((key) => key.startsWith('mask.'))
    if (firstMaskKey) {
      return getMaskPropertyIdForPath(firstMaskKey)
    }
  }
  return 'visual.position'
}

function getSupportedGroups(mediaType: UnifiedTimelineItemData['mediaType']): ClipPropertyGroupId[] {
  return [...getSupportedClipPropertyGroups(mediaType)]
}

function normalizePatchValues(
  patch: Record<string, unknown>,
  currentValues: Record<ClipPropertyPath, unknown>,
): Record<ClipPropertyPath, unknown> {
  const normalized = { ...patch } as Record<ClipPropertyPath, unknown>
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
  keys: ClipPropertyPath[],
  normalizedPatchValues: Record<ClipPropertyPath, unknown>,
): ClipPropertyPath[] {
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

function validateNonNegativeNumber(path: string) {
  return (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 必须是数字` }
    }
    if (value < 0) {
      return { ok: false as const, code: 'invalid_value_type', message: `${path} 不能小于 0` }
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

function validateMaskType(value: unknown) {
  if (!isMaskType(value)) {
    return {
      ok: false as const,
      code: 'invalid_enum_value',
      message: 'mask.type 必须是 rectangle、ellipse、linear 或 mirror',
    }
  }
  return { ok: true as const, value }
}

function getEffectiveMaskType(
  patch: Record<ClipPropertyPath, unknown>,
  currentValues: Record<ClipPropertyPath, unknown>,
): MaskType {
  const nextType = patch['mask.type']
  if (isMaskType(nextType)) {
    return nextType
  }

  const currentType = currentValues['mask.type']
  if (isMaskType(currentType)) {
    return currentType
  }

  return 'rectangle'
}

function getRequiredMaskTypeForPath(key: ClipPropertyPath): MaskType | null {
  if (key.startsWith('mask.rectangle.')) return 'rectangle'
  if (key.startsWith('mask.ellipse.')) return 'ellipse'
  if (key === 'mask.mirror.length') return 'mirror'
  return null
}

function getMaskPropertyIdForPath(key: ClipPropertyPath): ChangePlan['propertyId'] {
  if (key === 'mask.enabled' || key === 'mask.type' || key === 'mask.inverted') {
    return key
  }
  if (key.startsWith('mask.center.')) return 'mask.center'
  if (key === 'mask.rotation') return 'mask.rotation'
  if (key === 'mask.feather') return 'mask.feather'
  if (key === 'mask.intensity') return 'mask.intensity'
  if (key.startsWith('mask.rectangle.size.')) return 'mask.rectangle.size'
  if (key === 'mask.rectangle.cornerRadius') return 'mask.rectangle.cornerRadius'
  if (key.startsWith('mask.ellipse.size.')) return 'mask.ellipse.size'
  if (key === 'mask.mirror.length') return 'mask.mirror.length'
  return 'mask.center'
}

function isMaskType(value: unknown): value is MaskType {
  return value === 'rectangle' || value === 'ellipse' || value === 'linear' || value === 'mirror'
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
