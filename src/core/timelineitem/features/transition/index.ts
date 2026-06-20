/**
 * 转场能力域实现。
 * 从原 transition.ts 迁入，保留原有逻辑与注释语义。
 */

import type { MediaType } from '@/core/mediaitem'
import { normalizeFilterParamColor } from '@/core/filter/color'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import {
  DEFAULT_CLIP_TRANSITION_DURATION_FRAMES,
  type ClipTransitionOutConfig,
} from '@/core/transition/types'

export type ClipTransitionBindingState =
  | 'unbound'
  | 'bound'
  | 'invalid-target'
  | 'invalid-overlap'
  | 'waiting-edge'

export type ClipTransitionEdgeSource = ImageBitmap | VideoFrame

export interface ClipTransitionEdgeFrames {
  leftTail?: ClipTransitionEdgeSource
  rightHead?: ClipTransitionEdgeSource
}

export interface ClipTransitionRuntime {
  bindingState: ClipTransitionBindingState
  seamFrame: number | null
  rightItemId: string | null
  effectiveDurationFrames: number
  leftHalfFrames: number
  rightHalfFrames: number
  activeRangeStart: number | null
  activeRangeEnd: number | null
  edgeFrames?: ClipTransitionEdgeFrames
  edgeSignature?: string
}

export interface TransitionBoundaryFrames {
  timelineHeadFrame: number
  timelineTailFrame: number
  clipHeadFrame: number
  clipTailFrame: number
}

export interface ClipTransitionPlaybackState {
  phase: 'entering-right' | 'exiting-left'
  progress: number
  liveItemId: string
  frozenItemId: string
  frozenEdgeKey: keyof ClipTransitionEdgeFrames
  transitionItemId: string
  activeRangeStart: number
  activeRangeEnd: number
}

export interface TransitionTemplateDropCandidate {
  canDrop: boolean
  seamFrame: number | null
  sourceItemId: string | null
  matchCount: number
  sourceItemStartFrame: number | null
  sourceItemEndFrame: number | null
}

export type ClipTransitionVisualTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

function clampDurationFrames(durationFrames: number): number {
  const rounded = Math.round(durationFrames)
  if (!Number.isFinite(rounded)) {
    return DEFAULT_CLIP_TRANSITION_DURATION_FRAMES
  }
  return Math.max(2, rounded)
}

function normalizeTransitionParams(
  params: Record<string, unknown>,
  config?: Partial<ClipTransitionOutConfig> | null,
): Record<string, unknown> {
  const nextParams = JSON.parse(JSON.stringify(params)) as Record<string, unknown>
  const defaultParams = config?.packagePayload?.defaultParams ?? {}
  const parameterSchema = config?.packagePayload?.parameterSchema ?? {}

  for (const [parameterKey, defaultValue] of Object.entries(defaultParams)) {
    if (!(parameterKey in nextParams)) {
      nextParams[parameterKey] = JSON.parse(JSON.stringify(defaultValue))
    }
  }

  for (const [parameterKey, definition] of Object.entries(parameterSchema)) {
    if (definition.type !== 'color' || !(parameterKey in nextParams)) {
      continue
    }

    nextParams[parameterKey] = normalizeFilterParamColor(nextParams[parameterKey])
  }

  return nextParams
}

export function createDefaultClipTransitionOutConfig(): ClipTransitionOutConfig {
  return {
    effectPackageId: '',
    templateId: '',
    packageVersion: '',
    catalogVersion: '',
    durationFrames: DEFAULT_CLIP_TRANSITION_DURATION_FRAMES,
    params: {},
  }
}

export function normalizeClipTransitionOutConfig(
  config?: Partial<ClipTransitionOutConfig> | null,
): ClipTransitionOutConfig {
  const defaults = createDefaultClipTransitionOutConfig()
  return {
    effectPackageId: config?.effectPackageId ?? defaults.effectPackageId,
    templateId: config?.templateId ?? defaults.templateId,
    packageVersion: config?.packageVersion ?? defaults.packageVersion,
    catalogVersion: config?.catalogVersion ?? defaults.catalogVersion,
    durationFrames: clampDurationFrames(config?.durationFrames ?? defaults.durationFrames),
    params: normalizeTransitionParams(config?.params ?? {}, config),
    ...(config?.packagePayload
      ? {
          packagePayload: JSON.parse(JSON.stringify(config.packagePayload)),
        }
      : {}),
  }
}

export function areClipTransitionOutConfigsEqual(
  a?: ClipTransitionOutConfig,
  b?: ClipTransitionOutConfig,
): boolean {
  if (!a && !b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return (
    a.effectPackageId === b.effectPackageId &&
    a.templateId === b.templateId &&
    a.packageVersion === b.packageVersion &&
    a.catalogVersion === b.catalogVersion &&
    a.durationFrames === b.durationFrames &&
    JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {})
  )
}

export function createEmptyClipTransitionRuntime(): ClipTransitionRuntime {
  return {
    bindingState: 'unbound',
    seamFrame: null,
    rightItemId: null,
    effectiveDurationFrames: 0,
    leftHalfFrames: 0,
    rightHalfFrames: 0,
    activeRangeStart: null,
    activeRangeEnd: null,
  }
}

export function supportsClipTransitionOutMediaType(
  mediaType: MediaType,
): mediaType is 'video' | 'image' {
  return mediaType === 'video' || mediaType === 'image'
}

export function supportsClipTransitionOut(
  item: UnifiedTimelineItemData<MediaType>,
): item is ClipTransitionVisualTimelineItem {
  return supportsClipTransitionOutMediaType(item.mediaType)
}

export function hasEnabledClipTransitionOut(
  item: UnifiedTimelineItemData<MediaType>,
): item is ClipTransitionVisualTimelineItem & { exRenderConfig: { transition: ClipTransitionOutConfig } } {
  return supportsClipTransitionOut(item) && Boolean(item.exRenderConfig.transition)
}

export function ensureClipTransitionRuntime(
  item: UnifiedTimelineItemData<MediaType>,
): ClipTransitionRuntime {
  if (!item.runtime.transition) {
    item.runtime.transition = createEmptyClipTransitionRuntime()
  }
  return item.runtime.transition
}

export function closeClipTransitionEdgeFrames(edgeFrames?: ClipTransitionEdgeFrames): void {
  edgeFrames?.leftTail?.close()
  edgeFrames?.rightHead?.close()
}

export function resetClipTransitionRuntime(item: UnifiedTimelineItemData<MediaType>): void {
  if (item.runtime.transition?.edgeFrames) {
    closeClipTransitionEdgeFrames(item.runtime.transition.edgeFrames)
  }
  item.runtime.transition = createEmptyClipTransitionRuntime()
}

export function resolveTransitionBoundaryFrames(
  item: UnifiedTimelineItemData<MediaType>,
): TransitionBoundaryFrames {
  const timelineHeadFrame = item.timeRange.timelineStartTime
  const timelineTailFrame = Math.max(
    item.timeRange.timelineStartTime,
    item.timeRange.timelineEndTime - 1,
  )
  const clipHeadFrame = item.timeRange.clipStartTime
  const clipTailFrame = Math.max(item.timeRange.clipStartTime, item.timeRange.clipEndTime - 1)

  return {
    timelineHeadFrame,
    timelineTailFrame,
    clipHeadFrame,
    clipTailFrame,
  }
}

export function resolveClipTransitionBinding(
  itemA: UnifiedTimelineItemData<MediaType>,
  trackItems: UnifiedTimelineItemData<MediaType>[],
): ClipTransitionRuntime {
  const nextRuntime = createEmptyClipTransitionRuntime()

  if (!supportsClipTransitionOut(itemA)) {
    return nextRuntime
  }

  const seamFrame = itemA.timeRange.timelineEndTime
  nextRuntime.seamFrame = seamFrame

  const rightItem =
    trackItems.find(
      (candidate) =>
        candidate.id !== itemA.id &&
        candidate.trackId === itemA.trackId &&
        candidate.timeRange.timelineStartTime === seamFrame,
    ) ?? null

  if (!rightItem) {
    return nextRuntime
  }

  nextRuntime.rightItemId = rightItem.id

  if (!supportsClipTransitionOut(rightItem)) {
    nextRuntime.bindingState = 'invalid-target'
    return nextRuntime
  }

  const transitionConfig = itemA.exRenderConfig.transition
  if (!transitionConfig) {
    return nextRuntime
  }

  const transitionOut = normalizeClipTransitionOutConfig(transitionConfig)
  const desiredDurationFrames = transitionOut.durationFrames
  const desiredLeftHalfFrames = Math.floor(desiredDurationFrames / 2)
  const desiredRightHalfFrames = desiredDurationFrames - desiredLeftHalfFrames
  const leftAvailableFrames = Math.max(0, seamFrame - itemA.timeRange.timelineStartTime)
  const rightAvailableFrames = Math.max(0, rightItem.timeRange.timelineEndTime - seamFrame)

  const effectiveLeftHalfFrames = Math.min(desiredLeftHalfFrames, leftAvailableFrames)
  const effectiveRightHalfFrames = Math.min(desiredRightHalfFrames, rightAvailableFrames)

  if (effectiveLeftHalfFrames <= 0 || effectiveRightHalfFrames <= 0) {
    nextRuntime.bindingState = 'invalid-target'
    return nextRuntime
  }

  nextRuntime.bindingState = 'bound'
  nextRuntime.leftHalfFrames = effectiveLeftHalfFrames
  nextRuntime.rightHalfFrames = effectiveRightHalfFrames
  nextRuntime.effectiveDurationFrames = effectiveLeftHalfFrames + effectiveRightHalfFrames
  nextRuntime.activeRangeStart = seamFrame - effectiveLeftHalfFrames
  nextRuntime.activeRangeEnd = seamFrame + effectiveRightHalfFrames

  return nextRuntime
}

export function resolveTransitionTemplateDropCandidate(
  trackItems: UnifiedTimelineItemData<MediaType>[],
  hoveredFrame: number,
  thresholdFrames: number,
): TransitionTemplateDropCandidate {
  const visualItems = trackItems.filter(supportsClipTransitionOut)
  const validSeamFrames = new Set<number>()

  for (const item of visualItems) {
    const seamFrame = item.timeRange.timelineEndTime
    const hasRightNeighbor = visualItems.some(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.trackId === item.trackId &&
        candidate.timeRange.timelineStartTime === seamFrame,
    )

    if (hasRightNeighbor) {
      validSeamFrames.add(seamFrame)
    }
  }

  let bestSeamFrame: number | null = null
  let bestDistance = Infinity

  for (const item of visualItems) {
    const seamFrame = item.timeRange.timelineEndTime
    if (!validSeamFrames.has(seamFrame)) {
      continue
    }
    const distance = Math.abs(seamFrame - hoveredFrame)
    if (distance <= thresholdFrames && distance < bestDistance) {
      bestSeamFrame = seamFrame
      bestDistance = distance
    }
  }

  if (bestSeamFrame === null) {
    return {
      canDrop: false,
      seamFrame: null,
      sourceItemId: null,
      matchCount: 0,
      sourceItemStartFrame: null,
      sourceItemEndFrame: null,
    }
  }

  const matchedItems = visualItems.filter((item) => item.timeRange.timelineEndTime === bestSeamFrame)

  if (matchedItems.length !== 1) {
    return {
      canDrop: false,
      seamFrame: bestSeamFrame,
      sourceItemId: null,
      matchCount: matchedItems.length,
      sourceItemStartFrame: null,
      sourceItemEndFrame: null,
    }
  }

  return {
    canDrop: true,
    seamFrame: bestSeamFrame,
    sourceItemId: matchedItems[0].id,
    matchCount: 1,
    sourceItemStartFrame: matchedItems[0].timeRange.timelineStartTime,
    sourceItemEndFrame: matchedItems[0].timeRange.timelineEndTime,
  }
}

export function resolveClipTransitionPlaybackState(
  transitionItem: UnifiedTimelineItemData<MediaType>,
  binding: ClipTransitionRuntime,
  currentFrame: number,
): ClipTransitionPlaybackState | null {
  if (binding.bindingState !== 'bound') {
    return null
  }

  if (
    binding.seamFrame === null ||
    binding.rightItemId === null ||
    binding.activeRangeStart === null ||
    binding.activeRangeEnd === null
  ) {
    return null
  }

  if (currentFrame < binding.activeRangeStart || currentFrame >= binding.activeRangeEnd) {
    return null
  }

  const totalFrames = Math.max(1, binding.activeRangeEnd - binding.activeRangeStart)
  const progress = Math.min(
    1,
    Math.max(0, (currentFrame - binding.activeRangeStart) / totalFrames),
  )

  if (currentFrame < binding.seamFrame) {
    return {
      phase: 'entering-right',
      progress,
      liveItemId: transitionItem.id,
      frozenItemId: binding.rightItemId,
      frozenEdgeKey: 'rightHead',
      transitionItemId: transitionItem.id,
      activeRangeStart: binding.activeRangeStart,
      activeRangeEnd: binding.activeRangeEnd,
    }
  }

  return {
    phase: 'exiting-left',
    progress,
    liveItemId: binding.rightItemId,
    frozenItemId: transitionItem.id,
    frozenEdgeKey: 'leftTail',
    transitionItemId: transitionItem.id,
    activeRangeStart: binding.activeRangeStart,
    activeRangeEnd: binding.activeRangeEnd,
  }
}

export function doClipTransitionWindowsOverlap(
  left: ClipTransitionRuntime,
  right: ClipTransitionRuntime,
): boolean {
  if (
    left.activeRangeStart === null ||
    left.activeRangeEnd === null ||
    right.activeRangeStart === null ||
    right.activeRangeEnd === null
  ) {
    return false
  }

  return left.activeRangeStart < right.activeRangeEnd && left.activeRangeEnd > right.activeRangeStart
}

export function refreshClipTransitionsForItems(
  timelineItems: UnifiedTimelineItemData<MediaType>[],
): void {
  const trackItemsMap = new Map<string, UnifiedTimelineItemData<MediaType>[]>()

  for (const item of timelineItems) {
    const itemsOnTrack = trackItemsMap.get(item.trackId) || []
    itemsOnTrack.push(item)
    trackItemsMap.set(item.trackId, itemsOnTrack)
  }

  for (const itemsOnTrack of trackItemsMap.values()) {
    itemsOnTrack.sort((left, right) => {
      const startDiff = left.timeRange.timelineStartTime - right.timeRange.timelineStartTime
      if (startDiff !== 0) return startDiff
      return left.id.localeCompare(right.id)
    })
  }

  for (const item of timelineItems) {
    const existingRuntime = item.runtime.transition

    if (!supportsClipTransitionOut(item)) {
      if (existingRuntime?.edgeFrames) {
        closeClipTransitionEdgeFrames(existingRuntime.edgeFrames)
      }
      item.runtime.transition = undefined
      continue
    }

    if (!hasEnabledClipTransitionOut(item)) {
      if (existingRuntime?.edgeFrames) {
        closeClipTransitionEdgeFrames(existingRuntime.edgeFrames)
      }
      item.runtime.transition = createEmptyClipTransitionRuntime()
      continue
    }

    const nextRuntime = resolveClipTransitionBinding(item, trackItemsMap.get(item.trackId) || [])
    const shouldPreserveEdges =
      existingRuntime &&
      existingRuntime.rightItemId === nextRuntime.rightItemId &&
      existingRuntime.seamFrame === nextRuntime.seamFrame &&
      existingRuntime.activeRangeStart === nextRuntime.activeRangeStart &&
      existingRuntime.activeRangeEnd === nextRuntime.activeRangeEnd &&
      existingRuntime.leftHalfFrames === nextRuntime.leftHalfFrames &&
      existingRuntime.rightHalfFrames === nextRuntime.rightHalfFrames

    if (shouldPreserveEdges && existingRuntime) {
      nextRuntime.edgeFrames = existingRuntime.edgeFrames
      nextRuntime.edgeSignature = existingRuntime.edgeSignature
      if (existingRuntime.bindingState === 'waiting-edge' && nextRuntime.bindingState === 'bound') {
        nextRuntime.bindingState = 'waiting-edge'
      }
    } else if (existingRuntime?.edgeFrames) {
      closeClipTransitionEdgeFrames(existingRuntime.edgeFrames)
    }

    item.runtime.transition = nextRuntime
  }

  const activeTransitionItems = timelineItems.filter(
    (item) =>
      hasEnabledClipTransitionOut(item) &&
      (item.runtime.transition?.bindingState === 'bound' ||
        item.runtime.transition?.bindingState === 'waiting-edge') &&
      item.runtime.transition.activeRangeStart !== null &&
      item.runtime.transition.activeRangeEnd !== null,
  )

  for (let index = 0; index < activeTransitionItems.length; index++) {
    const currentItem = activeTransitionItems[index]
    const currentRuntime = currentItem.runtime.transition
    if (!currentRuntime) continue

    for (let compareIndex = index + 1; compareIndex < activeTransitionItems.length; compareIndex++) {
      const compareItem = activeTransitionItems[compareIndex]
      const compareRuntime = compareItem.runtime.transition
      if (!compareRuntime) continue

      const currentParticipants = new Set([currentItem.id, currentRuntime.rightItemId])
      const compareParticipants = new Set([compareItem.id, compareRuntime.rightItemId])
      const sharesParticipant = [...currentParticipants].some((id) => compareParticipants.has(id))

      if (!sharesParticipant) {
        continue
      }

      if (doClipTransitionWindowsOverlap(currentRuntime, compareRuntime)) {
        currentRuntime.bindingState = 'invalid-overlap'
        compareRuntime.bindingState = 'invalid-overlap'
      }
    }
  }
}
