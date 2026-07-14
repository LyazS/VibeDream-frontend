import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { EffectPackageParameterDefinition, TransitionPackagePayload } from '@/core/effect-package/types'
import { buildEffectPackageId, type EffectPackageIdentity } from '@/core/effect-template/commonTypes'
import {
  supportsClipTransitionOut,
  resolveClipTransitionBinding,
  type ClipTransitionBindingState,
} from '@/core/timelineitem/features/transition'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { buildTransitionItemId, parseTransitionItemId } from './transitionItemId'

export { buildTransitionItemId, parseTransitionItemId }

export type TransitionItemSnapshot = {
  itemId: string
  itemType: 'transition'
  leftClipId: string
  rightClipId: string | null
  trackId: string
  seamFrame: number
  startFrame: number | null
  endFrame: number | null
  effectiveDurationFrames: number
  bindingState: ClipTransitionBindingState
  config: ClipTransitionOutConfig
  leftItem: UnifiedTimelineItemData
}

export function getTrackItems(trackId: string): UnifiedTimelineItemData[] {
  return useUnifiedStore().timelineItems
    .filter((item) => item.trackId === trackId)
    .sort((a, b) => a.timeRange.timelineStartTime - b.timeRange.timelineStartTime)
}

export function getTransitionSnapshot(leftItem: UnifiedTimelineItemData): TransitionItemSnapshot | null {
  const config = TimelineItemQueries.getBaseTransition(leftItem)
  if (!config || !supportsClipTransitionOut(leftItem)) return null
  const runtime = resolveClipTransitionBinding(leftItem, getTrackItems(leftItem.trackId))
  const activeRangeStart = runtime.activeRangeStart
  const activeRangeEnd = runtime.activeRangeEnd
  const hasOverlap = activeRangeStart !== null
    && activeRangeEnd !== null
    && getTrackItems(leftItem.trackId).some((candidate) => {
      if (candidate.id === leftItem.id || !TimelineItemQueries.getBaseTransition(candidate)) return false
      const candidateRuntime = resolveClipTransitionBinding(candidate, getTrackItems(leftItem.trackId))
      return candidateRuntime.activeRangeStart !== null
        && candidateRuntime.activeRangeEnd !== null
        && activeRangeStart < candidateRuntime.activeRangeEnd
        && activeRangeEnd > candidateRuntime.activeRangeStart
    })
  return {
    itemId: buildTransitionItemId(leftItem.id, config.templateId),
    itemType: 'transition',
    leftClipId: leftItem.id,
    rightClipId: runtime.rightItemId,
    trackId: leftItem.trackId,
    seamFrame: runtime.seamFrame ?? leftItem.timeRange.timelineEndTime,
    startFrame: runtime.activeRangeStart,
    endFrame: runtime.activeRangeEnd,
    effectiveDurationFrames: runtime.effectiveDurationFrames,
    bindingState: hasOverlap ? 'invalid-overlap' : runtime.bindingState,
    config,
    leftItem,
  }
}

export function listTransitionSnapshots(trackId: string): TransitionItemSnapshot[] {
  return getTrackItems(trackId).flatMap((item) => {
    const snapshot = getTransitionSnapshot(item)
    return snapshot ? [snapshot] : []
  })
}

export function transitionTimelineOutput(snapshot: TransitionItemSnapshot) {
  return {
    leftClipId: snapshot.leftClipId,
    trackId: snapshot.trackId,
    bindingState: snapshot.bindingState,
    ...(snapshot.rightClipId
      ? {
          rightClipId: snapshot.rightClipId,
          seamTime: framesToTimecode(snapshot.seamFrame),
        }
      : {}),
    ...(snapshot.startFrame !== null && snapshot.endFrame !== null
      ? {
          start: framesToTimecode(snapshot.startFrame),
          end: framesToTimecode(snapshot.endFrame),
          effectiveDuration: framesToTimecode(snapshot.effectiveDurationFrames),
        }
      : {}),
  }
}

export function transitionOverlaps(snapshot: TransitionItemSnapshot, ignoreLeftClipId?: string): boolean {
  if (snapshot.startFrame === null || snapshot.endFrame === null) return false
  const startFrame = snapshot.startFrame
  const endFrame = snapshot.endFrame
  return listTransitionSnapshots(snapshot.trackId).some((candidate) =>
    candidate.leftClipId !== ignoreLeftClipId
    && candidate.startFrame !== null
    && candidate.endFrame !== null
    && startFrame < candidate.endFrame
    && endFrame > candidate.startFrame
  )
}

export async function resolveTransitionTemplate(templateId: string): Promise<{
  identity: EffectPackageIdentity
  payload: TransitionPackagePayload
}> {
  const catalog = await effectTemplateRegistry.loadCatalog('transition')
  const entry = catalog.items.find((item) => item.id === templateId)
  if (!entry) throw toolError('transition_template_not_found', `未找到转场模板: ${templateId}`)
  const identity: EffectPackageIdentity = {
    effectType: 'transition',
    templateId,
    packageVersion: entry.package_version,
    catalogVersion: catalog.catalogVersion,
    effectPackageId: buildEffectPackageId('transition', templateId, entry.package_version),
  }
  await effectTemplateRegistry.ensureReady(identity)
  if (effectTemplateRegistry.getPackageState(identity.effectPackageId)?.status !== 'ready') {
    throw toolError('transition_template_not_ready', `转场模板未就绪: ${templateId}`)
  }
  const payload = effectTemplateRegistry.getReadyPackage(identity.effectPackageId)?.payload
  if (!payload || payload.effectType !== 'transition') {
    throw toolError('transition_template_not_ready', `转场模板载荷不可用: ${templateId}`)
  }
  return { identity, payload }
}

export function toolError(code: string, message: string, details?: Record<string, unknown>): Error & { toolCode: string; toolDetails?: Record<string, unknown> } {
  return Object.assign(new Error(message), { toolCode: code, toolDetails: details })
}

export function validateTransitionParam(value: unknown, definition: EffectPackageParameterDefinition, path: string): unknown {
  const numeric = (integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
      throw toolError('invalid_transition_param', `${path} 必须是${integer ? '整数' : '有限数字'}。`)
    }
    if (definition.min !== undefined && value < definition.min || definition.max !== undefined && value > definition.max) {
      throw toolError('invalid_transition_param', `${path} 超出允许范围。`, { min: definition.min, max: definition.max })
    }
    if (definition.options && !definition.options.some((option) => option.value === value)) {
      throw toolError('invalid_transition_param', `${path} 不在允许选项中。`)
    }
    return value
  }
  switch (definition.type) {
    case 'float': return numeric()
    case 'int': return numeric(true)
    case 'boolean':
      if (typeof value !== 'boolean') throw toolError('invalid_transition_param', `${path} 必须是布尔值。`)
      return value
    case 'color':
      if (typeof value !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) throw toolError('invalid_transition_param', `${path} 必须是 #RRGGBB 或 #RRGGBBAA 颜色。`)
      return value
    default: {
      const size = Number(definition.type.slice(-1))
      if (!Array.isArray(value) || value.length !== size || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && (definition.type === 'ivec2' ? Number.isInteger(entry) : true))) {
        throw toolError('invalid_transition_param', `${path} 必须是长度为 ${size} 的数值数组。`)
      }
      return [...value]
    }
  }
}
