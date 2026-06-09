import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { propertyMutationCommitter } from '@/core/property-system'
import {
  clearFilterIntensityOverlay,
  getFilterIntensityOverlay,
  setFilterIntensityOverlay,
} from '@/core/property-system/render-state'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { useUnifiedStore } from '@/core/unifiedStore'
import type {
  FilterTimelineItem,
  UnifiedFilterControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface FilterDeferredInteractionOptions extends UnifiedFilterControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateFilterNumbers: ComputedRef<boolean>
}

const activeInteractionCancels = new Map<string, () => void>()

export function cancelFilterDeferredInteractionByTimelineItemId(timelineItemId: string) {
  activeInteractionCancels.get(timelineItemId)?.()
}

export function useFilterDeferredInteraction(options: FilterDeferredInteractionOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateFilterNumbers } = options

  const activeTimelineItemId = ref<string | null>(null)

  const isActive = computed(() => activeTimelineItemId.value !== null)

  function registerCancelCallback(itemId: string) {
    activeInteractionCancels.set(itemId, cancelDeferredUpdatesSync)
  }

  function unregisterCancelCallback(itemId?: string | null) {
    if (!itemId) return
    if (activeInteractionCancels.get(itemId) === cancelDeferredUpdatesSync) {
      activeInteractionCancels.delete(itemId)
    }
  }

  function getActiveItem() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) {
      return null
    }
    return (unifiedStore.getTimelineItem(timelineItemId) as FilterTimelineItem | undefined) ?? null
  }

  function resetInteractionState() {
    activeTimelineItemId.value = null
  }

  function beginFilterInteraction(item: FilterTimelineItem) {
    if (activeTimelineItemId.value === item.id) {
      return
    }

    if (activeTimelineItemId.value && activeTimelineItemId.value !== item.id) {
      cancelDeferredUpdatesSync()
    }

    void unifiedStore.pause()
    activeTimelineItemId.value = item.id
    registerCancelCallback(item.id)
  }

  function getCommitContext(item: FilterTimelineItem) {
    return {
      item,
      frame: currentFrame.value,
      applyChangePlan: unifiedStore.applyChangePlanWithHistory,
    }
  }

  function setFilterIntensityDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !item.filterEffect || !canOperateFilterNumbers.value) return

    beginFilterInteraction(item)
    setFilterIntensityOverlay(item.id, value)
  }

  async function commitDeferredUpdates() {
    const item = getActiveItem()
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId || !item) return

    const overlay = getFilterIntensityOverlay(timelineItemId)
    const nextIntensity = overlay?.intensity ?? TimelineItemQueries.getRenderFilterEffect(item)?.intensity

    unregisterCancelCallback(timelineItemId)
    resetInteractionState()

    if (typeof nextIntensity !== 'number' || !Number.isFinite(nextIntensity)) {
      clearFilterIntensityOverlay(timelineItemId)
      return
    }

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'filter.intensity', nextIntensity)
    clearFilterIntensityOverlay(timelineItemId)
  }

  function cancelDeferredUpdatesSync() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) return

    clearFilterIntensityOverlay(timelineItemId)
    unregisterCancelCallback(timelineItemId)
    resetInteractionState()
  }

  async function cancelDeferredUpdates() {
    cancelDeferredUpdatesSync()
  }

  async function setFilterIntensityDirect(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !item.filterEffect || !canOperateFilterNumbers.value) return

    await cancelDeferredUpdates()
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'filter.intensity', value)
  }

  watch(
    () => selectedTimelineItem.value?.id ?? null,
    (nextItemId, previousItemId) => {
      if (previousItemId && previousItemId !== nextItemId) {
        cancelDeferredUpdatesSync()
      }
    },
  )

  onBeforeUnmount(() => {
    cancelDeferredUpdatesSync()
  })

  return {
    isFilterInteractionActive: isActive,
    beginFilterInteraction,
    setFilterIntensityDeferred,
    setFilterIntensityDirect,
    commitDeferredUpdates,
    cancelDeferredUpdates,
  }
}
