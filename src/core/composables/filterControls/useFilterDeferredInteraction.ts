import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { ClipFilterConfig } from '@/core/filter/types'
import { areClipFilterConfigsEqual, normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { useUnifiedStore } from '@/core/unifiedStore'
import { AnimationSession } from '@/core/animation/session'
import { getKeyframeButtonState } from '@/core/utils/unifiedKeyframeUtils'
import type {
  FilterDeferredPatch,
  FilterTimelineItem,
  UnifiedFilterControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface FilterDeferredInteractionOptions extends UnifiedFilterControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateFilterNumbers: ComputedRef<boolean>
}

const activeInteractionCancels = new Map<string, () => void>()
const FILTER_CHANNEL = 'filter.intensity' as const

type FilterInteractionMode = 'static' | 'animated' | null

function cloneFilterConfig(config?: ClipFilterConfig): ClipFilterConfig | undefined {
  return config ? normalizeClipFilterConfig(config) : undefined
}

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 deferred 交互层内部实现属性提交分流，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

export function cancelFilterDeferredInteractionByTimelineItemId(timelineItemId: string) {
  activeInteractionCancels.get(timelineItemId)?.()
}

export function useFilterDeferredInteraction(options: FilterDeferredInteractionOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateFilterNumbers } = options

  const activeTimelineItemId = ref<string | null>(null)
  const interactionMode = ref<FilterInteractionMode>(null)
  const originalFilterEffect = ref<ClipFilterConfig | undefined>(undefined)
  const originalRenderFilterEffect = ref<ClipFilterConfig | undefined>(undefined)
  const draftFilterEffect = ref<ClipFilterConfig | undefined>(undefined)
  const animationSession = new AnimationSession()

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

  function syncRuntimeFilterEffect(item: FilterTimelineItem, filterEffect?: ClipFilterConfig) {
    item.runtime.renderFilterEffect = cloneFilterConfig(filterEffect)
  }

  function getActiveItem() {
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId) {
      return null
    }
    return (unifiedStore.getTimelineItem(timelineItemId) as FilterTimelineItem | undefined) ?? null
  }

  function resetInteractionState() {
    interactionMode.value = null
    activeTimelineItemId.value = null
    originalFilterEffect.value = undefined
    originalRenderFilterEffect.value = undefined
    draftFilterEffect.value = undefined
  }

  function getCurrentInteractionMode(item: FilterTimelineItem): Exclude<FilterInteractionMode, null> {
    return getKeyframeButtonState(item, currentFrame.value, FILTER_CHANNEL) === 'none'
      ? 'static'
      : 'animated'
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
    interactionMode.value = getCurrentInteractionMode(item)
    originalFilterEffect.value = cloneFilterConfig(item.filterEffect)
    originalRenderFilterEffect.value = cloneFilterConfig(TimelineItemQueries.getRenderFilterEffect(item))
    draftFilterEffect.value = cloneFilterConfig(item.filterEffect)

    if (interactionMode.value === 'animated') {
      animationSession.begin(item)
    }

    registerCancelCallback(item.id)
  }

  function applyFilterDeferredPatch(patch: FilterDeferredPatch) {
    throwClipPropertyPhase0Todo('filter.deferred.applyPatch')
    const item = selectedTimelineItem.value
    if (!item || !item.filterEffect || !canOperateFilterNumbers.value) return

    beginFilterInteraction(item)

    if (interactionMode.value === 'animated') {
      if (typeof patch.intensity === 'number') {
        animationSession.apply(item, currentFrame.value, FILTER_CHANNEL, {
          intensity: patch.intensity,
        })
        draftFilterEffect.value = cloneFilterConfig(item.filterEffect)
        syncRuntimeFilterEffect(item, item.filterEffect)
      }
      return
    }

    const base = draftFilterEffect.value ?? normalizeClipFilterConfig(item.filterEffect)
    const nextFilterEffect = normalizeClipFilterConfig({ ...base, ...patch })
    draftFilterEffect.value = nextFilterEffect
    unifiedStore.setTimelineItemFilterEffectForCmd(item.id, nextFilterEffect)
  }

  async function commitDeferredUpdates() {
    throwClipPropertyPhase0Todo('filter.deferred.commit')
    const item = getActiveItem()
    const timelineItemId = activeTimelineItemId.value
    if (!timelineItemId || !item) return

    if (interactionMode.value === 'animated') {
      const patches = animationSession.commit(item)
      syncRuntimeFilterEffect(item, originalRenderFilterEffect.value)
      unregisterCancelCallback(timelineItemId)
      resetInteractionState()

      const patch = patches[FILTER_CHANNEL]
      if (patch && Object.keys(patch).length > 0) {
        await unifiedStore.updateAnimationGroupValueWithHistory(
          timelineItemId,
          currentFrame.value,
          FILTER_CHANNEL,
          patch as { intensity: number },
        )
      }
      return
    }

    const previousFilterEffect = cloneFilterConfig(originalFilterEffect.value)
    const nextFilterEffect = cloneFilterConfig(draftFilterEffect.value)

    unregisterCancelCallback(timelineItemId)
    resetInteractionState()

    if (areClipFilterConfigsEqual(previousFilterEffect, nextFilterEffect)) {
      unifiedStore.setTimelineItemFilterEffectForCmd(timelineItemId, previousFilterEffect)
      return
    }

    await unifiedStore.commitFilterEffectWithHistory(
      timelineItemId,
      previousFilterEffect,
      nextFilterEffect,
    )
  }

  function cancelDeferredUpdatesSync() {
    const timelineItemId = activeTimelineItemId.value
    const item = getActiveItem()
    if (!timelineItemId) return

    if (interactionMode.value === 'animated') {
      if (item) {
        animationSession.cancel(item)
        syncRuntimeFilterEffect(item, originalRenderFilterEffect.value)
      }
    } else {
      unifiedStore.setTimelineItemFilterEffectForCmd(timelineItemId, originalFilterEffect.value)
    }

    unregisterCancelCallback(timelineItemId)
    resetInteractionState()
  }

  async function cancelDeferredUpdates() {
    cancelDeferredUpdatesSync()
  }

  function setFilterIntensityDeferred(value: number) {
    applyFilterDeferredPatch({ intensity: value })
  }

  async function setFilterIntensityDirect(value: number) {
    throwClipPropertyPhase0Todo('filter.intensity.direct')
    const item = selectedTimelineItem.value
    if (!item || !item.filterEffect || !canOperateFilterNumbers.value) return

    if (getKeyframeButtonState(item, currentFrame.value, FILTER_CHANNEL) === 'none') {
      await cancelDeferredUpdates()
      await unifiedStore.updateFilterEffectWithHistory(item.id, {
        ...normalizeClipFilterConfig(item.filterEffect),
        intensity: value,
      })
      return
    }

    await cancelDeferredUpdates()
    await unifiedStore.updateAnimationGroupValueWithHistory(
      item.id,
      currentFrame.value,
      FILTER_CHANNEL,
      { intensity: value },
    )
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
    applyFilterDeferredPatch,
    setFilterIntensityDeferred,
    setFilterIntensityDirect,
    commitDeferredUpdates,
    cancelDeferredUpdates,
  }
}
