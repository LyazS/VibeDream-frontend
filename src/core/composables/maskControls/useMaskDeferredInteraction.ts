import type { ComputedRef } from 'vue'
import type { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { AnimationGroupId } from '@/core/timelineitem/bunnytype'
import { AnimationSession } from '@/core/animation/session'
import type {
  MaskDeferredPatch,
  UnifiedMaskKeyframeControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface MaskDeferredInteractionOptions extends UnifiedMaskKeyframeControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateMaskNumbers: ComputedRef<boolean>
}

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 deferred 交互层内部实现属性提交分流，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

function getGroupPatchFromMaskPath(path: keyof MaskDeferredPatch, value: number) {
  switch (path) {
    case 'mask.centerX':
      return { groupId: 'mask.center' as AnimationGroupId, patch: { centerX: value } }
    case 'mask.centerY':
      return { groupId: 'mask.center' as AnimationGroupId, patch: { centerY: value } }
    case 'mask.rotation':
      return { groupId: 'mask.rotation' as AnimationGroupId, patch: { rotation: value } }
    case 'mask.outerRange':
      return { groupId: 'mask.feather' as AnimationGroupId, patch: { outerRange: value } }
    case 'mask.decayRate':
      return { groupId: 'mask.intensity' as AnimationGroupId, patch: { decayRate: value } }
    case 'mask.width':
      return { groupId: 'mask.rectangle.size' as AnimationGroupId, patch: { width: value } }
    case 'mask.height':
      return { groupId: 'mask.rectangle.size' as AnimationGroupId, patch: { height: value } }
    case 'mask.cornerRadius':
      return { groupId: 'mask.rectangle.cornerRadius' as AnimationGroupId, patch: { cornerRadius: value } }
    case 'mask.ellipseWidth':
      return { groupId: 'mask.ellipse.size' as AnimationGroupId, patch: { ellipseWidth: value } }
    case 'mask.ellipseHeight':
      return { groupId: 'mask.ellipse.size' as AnimationGroupId, patch: { ellipseHeight: value } }
    case 'mask.length':
      return { groupId: 'mask.mirror.length' as AnimationGroupId, patch: { length: value } }
  }
}

export function useMaskDeferredInteraction(options: MaskDeferredInteractionOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateMaskNumbers } = options
  const session = new AnimationSession()

  function beginMaskInteraction() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    session.begin(item)
  }

  function applyMaskDeferredPatch(patch: MaskDeferredPatch) {
    throwClipPropertyPhase0Todo('mask.deferred.applyPatch')
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    beginMaskInteraction()
    for (const [path, value] of Object.entries(patch) as Array<[keyof MaskDeferredPatch, number]>) {
      if (!Number.isFinite(value)) continue
      const next = getGroupPatchFromMaskPath(path, value)
      if (!next) continue
      session.apply(item, currentFrame.value, next.groupId, next.patch as never)
    }
  }

  async function commitMaskInteraction() {
    throwClipPropertyPhase0Todo('mask.deferred.commit')
    const item = selectedTimelineItem.value
    if (!item || !session.isActive) return
    const patches = session.commit(item)
    const updates = Object.entries(patches).map(([groupId, patch]) => ({
      groupId: groupId as AnimationGroupId,
      patch: patch as never,
    }))
    if (updates.length > 0) {
      await unifiedStore.updateAnimationGroupsBatchWithHistory(item.id, currentFrame.value, updates)
    }
  }

  async function cancelMaskInteraction() {
    const item = selectedTimelineItem.value
    if (!item || !session.isActive) return
    session.cancel(item)
  }

  function setMaskCenterDeferred(centerX: number, centerY: number) {
    applyMaskDeferredPatch({ 'mask.centerX': centerX, 'mask.centerY': centerY })
  }

  function setRectangleMaskSizeDeferred(width: number, height: number) {
    applyMaskDeferredPatch({ 'mask.width': width, 'mask.height': height })
  }

  function setMaskRotationDeferred(value: number) {
    applyMaskDeferredPatch({ 'mask.rotation': value })
  }

  function setMaskOuterRangeDeferred(value: number) {
    applyMaskDeferredPatch({ 'mask.outerRange': value })
  }

  function setMaskDecayRateDeferred(value: number) {
    applyMaskDeferredPatch({ 'mask.decayRate': value })
  }

  function setMaskCornerRadiusDeferred(value: number) {
    applyMaskDeferredPatch({ 'mask.cornerRadius': value })
  }

  function setMaskLengthDeferred(value: number) {
    applyMaskDeferredPatch({ 'mask.length': value })
  }

  async function commitDeferredUpdates() {
    await commitMaskInteraction()
  }

  return {
    beginMaskInteraction,
    applyMaskDeferredPatch,
    commitMaskInteraction,
    cancelMaskInteraction,
    setMaskCenterDeferred,
    setRectangleMaskSizeDeferred,
    setMaskRotationDeferred,
    setMaskOuterRangeDeferred,
    setMaskDecayRateDeferred,
    setMaskCornerRadiusDeferred,
    setMaskLengthDeferred,
    commitDeferredUpdates,
  }
}
