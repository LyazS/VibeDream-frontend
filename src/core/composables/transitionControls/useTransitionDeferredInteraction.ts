import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { normalizeFilterParamColor } from '@/core/filter/color'
import {
  clearTransitionParamOverlay,
  getTransitionParamOverlay,
  setTransitionParamOverlay,
} from '@/core/property-system/render-state'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { useUnifiedStore } from '@/core/unifiedStore'
import type {
  FilterParamColorValue,
  TransitionParamVec2Value,
  TransitionTimelineItem,
  UnifiedTransitionControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface TransitionDeferredInteractionOptions extends UnifiedTransitionControlsOptions {
  unifiedStore: UnifiedStoreInstance
  hasTransitionConfig: ComputedRef<boolean>
}

const activeInteractionCancels = new Map<string, () => void>()

export function cancelTransitionDeferredInteractionByTimelineItemId(timelineItemId: string) {
  activeInteractionCancels.get(timelineItemId)?.()
}

function isTransitionParamVec2Value(value: unknown): value is TransitionParamVec2Value {
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

function isTransitionParamColorValue(value: unknown): value is FilterParamColorValue {
  try {
    normalizeFilterParamColor(value)
    return true
  } catch {
    return false
  }
}

function isSupportedTransitionParamValue(
  value: unknown,
): value is number | boolean | TransitionParamVec2Value | FilterParamColorValue {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    isTransitionParamVec2Value(value) ||
    isTransitionParamColorValue(value)
  )
}

function hasTransitionEffect(
  item: TransitionTimelineItem | null | undefined,
): item is TransitionTimelineItem {
  return Boolean(item && TimelineItemQueries.getBaseTransition(item))
}

export function useTransitionDeferredInteraction(options: TransitionDeferredInteractionOptions) {
  const { selectedTimelineItem, unifiedStore, hasTransitionConfig } = options

  const activeTimelineItemId = ref<string | null>(null)
  const activeTransitionParamKeys = ref(new Set<string>())
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
    if (!timelineItemId) return null
    return (unifiedStore.getTimelineItem(timelineItemId) as TransitionTimelineItem | undefined) ?? null
  }

  function resetInteractionState() {
    activeTimelineItemId.value = null
    activeTransitionParamKeys.value = new Set()
  }

  function beginTransitionInteraction(item: TransitionTimelineItem) {
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

  function setTransitionParamDeferred(parameterKey: string, value: number) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value) return

    beginTransitionInteraction(item)
    activeTransitionParamKeys.value = new Set(activeTransitionParamKeys.value).add(parameterKey)
    setTransitionParamOverlay(item.id, parameterKey, value)
  }

  function setTransitionParamVec2Deferred(parameterKey: string, value: TransitionParamVec2Value) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value || !isTransitionParamVec2Value(value)) return

    beginTransitionInteraction(item)
    activeTransitionParamKeys.value = new Set(activeTransitionParamKeys.value).add(parameterKey)
    setTransitionParamOverlay(item.id, parameterKey, value)
  }

  function setTransitionParamColorDeferred(parameterKey: string, value: FilterParamColorValue) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value || !isTransitionParamColorValue(value)) return

    beginTransitionInteraction(item)
    activeTransitionParamKeys.value = new Set(activeTransitionParamKeys.value).add(parameterKey)
    setTransitionParamOverlay(item.id, parameterKey, normalizeFilterParamColor(value))
  }

  async function commitDeferredUpdates() {
    const item = getActiveItem()
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId || !item) return

    const transitionConfig = TimelineItemQueries.getBaseTransition(item)
    if (!transitionConfig) {
      cancelDeferredUpdatesSync()
      return
    }

    const transitionParamOverlay = getTransitionParamOverlay(timelineItemId)
    const nextParams = [...activeTransitionParamKeys.value]
      .map((parameterKey) => [parameterKey, transitionParamOverlay?.params[parameterKey]] as const)
      .filter((entry): entry is readonly [string, number | boolean | TransitionParamVec2Value | FilterParamColorValue] =>
        isSupportedTransitionParamValue(entry[1]),
      )

    unregisterCancelCallback(timelineItemId)
    resetInteractionState()

    if (nextParams.length > 0) {
      await unifiedStore.updateTransitionConfigWithHistory(item.id, {
        ...transitionConfig,
        params: {
          ...transitionConfig.params,
          ...Object.fromEntries(nextParams),
        },
      })
    }

    clearTransitionParamOverlay(timelineItemId)
  }

  function cancelDeferredUpdatesSync() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) return

    clearTransitionParamOverlay(timelineItemId)
    unregisterCancelCallback(timelineItemId)
    resetInteractionState()
  }

  async function cancelDeferredUpdates() {
    cancelDeferredUpdatesSync()
  }

  async function setTransitionParamDirect(parameterKey: string, value: number) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value) return

    await cancelDeferredUpdates()
    const transitionConfig = TimelineItemQueries.getBaseTransition(item)
    if (!transitionConfig) return

    await unifiedStore.updateTransitionConfigWithHistory(item.id, {
      ...transitionConfig,
      params: {
        ...transitionConfig.params,
        [parameterKey]: value,
      },
    })
  }

  async function setTransitionParamVec2Direct(parameterKey: string, value: TransitionParamVec2Value) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value || !isTransitionParamVec2Value(value)) return

    await cancelDeferredUpdates()
    const transitionConfig = TimelineItemQueries.getBaseTransition(item)
    if (!transitionConfig) return

    await unifiedStore.updateTransitionConfigWithHistory(item.id, {
      ...transitionConfig,
      params: {
        ...transitionConfig.params,
        [parameterKey]: value,
      },
    })
  }

  async function setTransitionParamBooleanDirect(parameterKey: string, value: boolean) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value) return

    await cancelDeferredUpdates()
    const transitionConfig = TimelineItemQueries.getBaseTransition(item)
    if (!transitionConfig) return

    await unifiedStore.updateTransitionConfigWithHistory(item.id, {
      ...transitionConfig,
      params: {
        ...transitionConfig.params,
        [parameterKey]: value,
      },
    })
  }

  async function setTransitionParamColorDirect(parameterKey: string, value: FilterParamColorValue) {
    const item = selectedTimelineItem.value
    if (!hasTransitionEffect(item) || !hasTransitionConfig.value || !isTransitionParamColorValue(value)) return

    await cancelDeferredUpdates()
    const transitionConfig = TimelineItemQueries.getBaseTransition(item)
    if (!transitionConfig) return

    await unifiedStore.updateTransitionConfigWithHistory(item.id, {
      ...transitionConfig,
      params: {
        ...transitionConfig.params,
        [parameterKey]: normalizeFilterParamColor(value),
      },
    })
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
    isTransitionInteractionActive: isActive,
    beginTransitionInteraction,
    setTransitionParamDeferred,
    setTransitionParamDirect,
    setTransitionParamVec2Deferred,
    setTransitionParamVec2Direct,
    setTransitionParamBooleanDirect,
    setTransitionParamColorDeferred,
    setTransitionParamColorDirect,
    commitDeferredUpdates,
    cancelDeferredUpdates,
  }
}
