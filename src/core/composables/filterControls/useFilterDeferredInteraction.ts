import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { propertyMutationCommitter } from '@/core/property-system'
import type { DirectPropertyBatchPlanEntry } from '@/core/property-system'
import {
  clearFilterIntensityOverlay,
  clearFilterParamOverlay,
  getFilterIntensityOverlay,
  getFilterParamOverlay,
  setFilterIntensityOverlay,
  setFilterParamOverlay,
} from '@/core/property-system/render-state'
import {
  createFilterParamPropertyId,
  isValidFilterParamKey,
} from '@/core/property-system/schema'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { useUnifiedStore } from '@/core/unifiedStore'
import type {
  FilterParamVec2Value,
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

function isFilterParamVec2Value(value: unknown): value is FilterParamVec2Value {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).x === 'number' &&
    Number.isFinite((value as Record<string, unknown>).x) &&
    typeof (value as Record<string, unknown>).y === 'number' &&
    Number.isFinite((value as Record<string, unknown>).y)
  )
}

function isSupportedFilterParamValue(value: unknown): value is number | FilterParamVec2Value {
  return (typeof value === 'number' && Number.isFinite(value)) || isFilterParamVec2Value(value)
}

function hasFilterEffect(item: FilterTimelineItem | null | undefined): item is FilterTimelineItem {
  return Boolean(item && TimelineItemQueries.getBaseExtraRenderConfig(item)?.filter)
}

export function useFilterDeferredInteraction(options: FilterDeferredInteractionOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateFilterNumbers } = options

  const activeTimelineItemId = ref<string | null>(null)
  const activeFilterParamKeys = ref(new Set<string>())

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
    activeFilterParamKeys.value = new Set()
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
    if (!hasFilterEffect(item) || !canOperateFilterNumbers.value) return

    beginFilterInteraction(item)
    setFilterIntensityOverlay(item.id, value)
  }

  function setFilterParamDeferred(parameterKey: string, value: number) {
    const item = selectedTimelineItem.value
    if (!hasFilterEffect(item) || !canOperateFilterNumbers.value || !isValidFilterParamKey(parameterKey)) return

    beginFilterInteraction(item)
    activeFilterParamKeys.value = new Set(activeFilterParamKeys.value).add(parameterKey)
    setFilterParamOverlay(item.id, parameterKey, value)
  }

  function setFilterParamVec2Deferred(parameterKey: string, value: FilterParamVec2Value) {
    const item = selectedTimelineItem.value
    if (
      !hasFilterEffect(item) ||
      !canOperateFilterNumbers.value ||
      !isValidFilterParamKey(parameterKey) ||
      !isFilterParamVec2Value(value)
    ) return

    beginFilterInteraction(item)
    activeFilterParamKeys.value = new Set(activeFilterParamKeys.value).add(parameterKey)
    setFilterParamOverlay(item.id, parameterKey, value)
  }

  async function commitDeferredUpdates() {
    const item = getActiveItem()
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId || !item) return

    const overlay = getFilterIntensityOverlay(timelineItemId)
    const nextIntensity = overlay?.intensity ?? TimelineItemQueries.getResolvedFilter(item)?.intensity
    const filterParamOverlay = getFilterParamOverlay(timelineItemId)
    const paramEntries = [...activeFilterParamKeys.value]
      .map((parameterKey) => [parameterKey, filterParamOverlay?.params[parameterKey]] as const)
      .filter((entry): entry is readonly [string, number | FilterParamVec2Value] =>
        isSupportedFilterParamValue(entry[1]),
      )

    unregisterCancelCallback(timelineItemId)
    resetInteractionState()

    const entries: DirectPropertyBatchPlanEntry[] = []
    if (typeof nextIntensity === 'number' && Number.isFinite(nextIntensity) && overlay) {
      entries.push({
        propertyId: 'filter.intensity',
        value: nextIntensity,
      })
    }

    for (const [parameterKey, value] of paramEntries) {
      entries.push({
        propertyId: createFilterParamPropertyId(parameterKey),
        value,
      })
    }

    if (entries.length > 0) {
      await propertyMutationCommitter.commitDirectBatch(getCommitContext(item), entries, '修改滤镜参数')
    }

    clearFilterIntensityOverlay(timelineItemId)
    clearFilterParamOverlay(timelineItemId)
  }

  function cancelDeferredUpdatesSync() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) return

    clearFilterIntensityOverlay(timelineItemId)
    clearFilterParamOverlay(timelineItemId)
    unregisterCancelCallback(timelineItemId)
    resetInteractionState()
  }

  async function cancelDeferredUpdates() {
    cancelDeferredUpdatesSync()
  }

  async function setFilterIntensityDirect(value: number) {
    const item = selectedTimelineItem.value
    if (!hasFilterEffect(item) || !canOperateFilterNumbers.value) return

    await cancelDeferredUpdates()
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'filter.intensity', value)
  }

  async function setFilterParamDirect(parameterKey: string, value: number) {
    const item = selectedTimelineItem.value
    if (!hasFilterEffect(item) || !canOperateFilterNumbers.value || !isValidFilterParamKey(parameterKey)) return

    await cancelDeferredUpdates()
    await propertyMutationCommitter.commitDirect(getCommitContext(item), createFilterParamPropertyId(parameterKey), value)
  }

  async function setFilterParamVec2Direct(parameterKey: string, value: FilterParamVec2Value) {
    const item = selectedTimelineItem.value
    if (
      !hasFilterEffect(item) ||
      !canOperateFilterNumbers.value ||
      !isValidFilterParamKey(parameterKey) ||
      !isFilterParamVec2Value(value)
    ) return

    await cancelDeferredUpdates()
    await propertyMutationCommitter.commitDirect(getCommitContext(item), createFilterParamPropertyId(parameterKey), value)
  }

  async function setFilterParamBooleanDirect(parameterKey: string, value: boolean) {
    const item = selectedTimelineItem.value
    if (!hasFilterEffect(item) || !canOperateFilterNumbers.value || !isValidFilterParamKey(parameterKey)) return

    await cancelDeferredUpdates()
    await propertyMutationCommitter.commitDirect(getCommitContext(item), createFilterParamPropertyId(parameterKey), value)
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
    setFilterParamDeferred,
    setFilterParamDirect,
    setFilterParamVec2Deferred,
    setFilterParamVec2Direct,
    setFilterParamBooleanDirect,
    commitDeferredUpdates,
    cancelDeferredUpdates,
  }
}
