import { onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { useUnifiedStore } from '@/core/unifiedStore'
import { propertyMutationCommitter } from '@/core/property-system'
import type { DirectPropertyBatchPlanEntry } from '@/core/property-system'
import {
  clearMaskCenterOverlay,
  clearMaskEllipseSizeOverlay,
  clearMaskFeatherOverlay,
  clearMaskIntensityOverlay,
  clearMaskMirrorLengthOverlay,
  clearMaskRectangleCornerRadiusOverlay,
  clearMaskRectangleSizeOverlay,
  clearMaskRotationOverlay,
  setMaskCenterOverlay,
  setMaskEllipseSizeOverlay,
  setMaskFeatherOverlay,
  setMaskIntensityOverlay,
  setMaskMirrorLengthOverlay,
  setMaskRectangleCornerRadiusOverlay,
  setMaskRectangleSizeOverlay,
  setMaskRotationOverlay,
} from '@/core/property-system/render-state'
import type {
  MaskDeferredPatch,
  UnifiedMaskKeyframeControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface MaskDeferredInteractionOptions extends UnifiedMaskKeyframeControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateMaskNumbers: ComputedRef<boolean>
}

export function useMaskDeferredInteraction(options: MaskDeferredInteractionOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateMaskNumbers } = options
  const activeTimelineItemId = ref<string | null>(null)
  const pendingPatch = ref<MaskDeferredPatch>({})

  function getCommitContext(item: NonNullable<typeof selectedTimelineItem.value>) {
    return {
      item,
      frame: currentFrame.value,
      applyChangePlan: unifiedStore.applyChangePlanWithHistory,
    }
  }

  function getActiveItem() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) return null
    return unifiedStore.getTimelineItem(timelineItemId) ?? null
  }

  function resetInteractionState() {
    activeTimelineItemId.value = null
    pendingPatch.value = {}
  }

  function clearAllMaskOverlays(timelineItemId: string) {
    clearMaskCenterOverlay(timelineItemId)
    clearMaskRotationOverlay(timelineItemId)
    clearMaskRectangleSizeOverlay(timelineItemId)
    clearMaskEllipseSizeOverlay(timelineItemId)
    clearMaskRectangleCornerRadiusOverlay(timelineItemId)
    clearMaskMirrorLengthOverlay(timelineItemId)
    clearMaskFeatherOverlay(timelineItemId)
    clearMaskIntensityOverlay(timelineItemId)
  }

  function cancelMaskInteractionSync() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) return
    clearAllMaskOverlays(timelineItemId)
    resetInteractionState()
  }

  function beginMaskInteraction() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return

    if (activeTimelineItemId.value && activeTimelineItemId.value !== item.id) {
      cancelMaskInteractionSync()
    }

    if (activeTimelineItemId.value === item.id) {
      return
    }

    void unifiedStore.pause()
    activeTimelineItemId.value = item.id
    pendingPatch.value = {}
  }

  function applyMaskDeferredPatch(patch: MaskDeferredPatch) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return

    beginMaskInteraction()
    pendingPatch.value = {
      ...pendingPatch.value,
      ...patch,
    }

    if ('mask.centerX' in patch || 'mask.centerY' in patch) {
      const centerPatch: { centerX?: number; centerY?: number } = {}
      if (typeof patch['mask.centerX'] === 'number') {
        centerPatch.centerX = patch['mask.centerX']
      }
      if (typeof patch['mask.centerY'] === 'number') {
        centerPatch.centerY = patch['mask.centerY']
      }
      setMaskCenterOverlay(item.id, centerPatch)
    }

    if (typeof patch['mask.rotation'] === 'number') {
      setMaskRotationOverlay(item.id, patch['mask.rotation'])
    }

    if (typeof patch['mask.outerRange'] === 'number') {
      setMaskFeatherOverlay(item.id, patch['mask.outerRange'])
    }

    if (typeof patch['mask.decayRate'] === 'number') {
      setMaskIntensityOverlay(item.id, patch['mask.decayRate'])
    }

    if ('mask.width' in patch || 'mask.height' in patch) {
      const sizePatch: { width?: number; height?: number } = {}
      if (typeof patch['mask.width'] === 'number') {
        sizePatch.width = patch['mask.width']
      }
      if (typeof patch['mask.height'] === 'number') {
        sizePatch.height = patch['mask.height']
      }
      setMaskRectangleSizeOverlay(item.id, sizePatch)
    }

    if ('mask.ellipseWidth' in patch || 'mask.ellipseHeight' in patch) {
      const sizePatch: { ellipseWidth?: number; ellipseHeight?: number } = {}
      if (typeof patch['mask.ellipseWidth'] === 'number') {
        sizePatch.ellipseWidth = patch['mask.ellipseWidth']
      }
      if (typeof patch['mask.ellipseHeight'] === 'number') {
        sizePatch.ellipseHeight = patch['mask.ellipseHeight']
      }
      setMaskEllipseSizeOverlay(item.id, sizePatch)
    }

    if (typeof patch['mask.cornerRadius'] === 'number') {
      setMaskRectangleCornerRadiusOverlay(item.id, patch['mask.cornerRadius'])
    }

    if (typeof patch['mask.length'] === 'number') {
      setMaskMirrorLengthOverlay(item.id, patch['mask.length'])
    }
  }

  async function commitMaskInteraction() {
    const item = getActiveItem()
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId || !item) return

    const patch = pendingPatch.value
    const entries: DirectPropertyBatchPlanEntry[] = []

    if (typeof patch['mask.centerX'] === 'number' || typeof patch['mask.centerY'] === 'number') {
      const value: { centerX?: number; centerY?: number } = {}
      if (typeof patch['mask.centerX'] === 'number') {
        value.centerX = patch['mask.centerX']
      }
      if (typeof patch['mask.centerY'] === 'number') {
        value.centerY = patch['mask.centerY']
      }
      entries.push({ propertyId: 'mask.center', value })
    }

    if (typeof patch['mask.rotation'] === 'number') {
      entries.push({ propertyId: 'mask.rotation', value: patch['mask.rotation'] })
    }

    if (typeof patch['mask.width'] === 'number' || typeof patch['mask.height'] === 'number') {
      const value: { width?: number; height?: number } = {}
      if (typeof patch['mask.width'] === 'number') {
        value.width = patch['mask.width']
      }
      if (typeof patch['mask.height'] === 'number') {
        value.height = patch['mask.height']
      }
      entries.push({ propertyId: 'mask.rectangle.size', value })
    }

    if (typeof patch['mask.ellipseWidth'] === 'number' || typeof patch['mask.ellipseHeight'] === 'number') {
      const value: { ellipseWidth?: number; ellipseHeight?: number } = {}
      if (typeof patch['mask.ellipseWidth'] === 'number') {
        value.ellipseWidth = patch['mask.ellipseWidth']
      }
      if (typeof patch['mask.ellipseHeight'] === 'number') {
        value.ellipseHeight = patch['mask.ellipseHeight']
      }
      entries.push({ propertyId: 'mask.ellipse.size', value })
    }

    if (typeof patch['mask.cornerRadius'] === 'number') {
      entries.push({
        propertyId: 'mask.rectangle.cornerRadius',
        value: patch['mask.cornerRadius'],
      })
    }

    if (typeof patch['mask.length'] === 'number') {
      entries.push({ propertyId: 'mask.mirror.length', value: patch['mask.length'] })
    }

    if (typeof patch['mask.outerRange'] === 'number') {
      entries.push({ propertyId: 'mask.feather', value: patch['mask.outerRange'] })
    }

    if (typeof patch['mask.decayRate'] === 'number') {
      entries.push({ propertyId: 'mask.intensity', value: patch['mask.decayRate'] })
    }

    clearAllMaskOverlays(timelineItemId)
    resetInteractionState()

    if (entries.length === 0) return

    await propertyMutationCommitter.commitDirectBatch(
      getCommitContext(item),
      entries,
      '修改蒙版属性',
    )
  }

  async function cancelMaskInteraction() {
    cancelMaskInteractionSync()
  }

  watch(
    () => selectedTimelineItem.value?.id ?? null,
    (nextItemId, previousItemId) => {
      if (previousItemId && previousItemId !== nextItemId) {
        cancelMaskInteractionSync()
      }
    },
  )

  onBeforeUnmount(() => {
    cancelMaskInteractionSync()
  })

  return {
    beginMaskInteraction,
    applyMaskDeferredPatch,
    commitMaskInteraction,
    cancelMaskInteraction,
  }
}
