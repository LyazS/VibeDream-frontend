import { useUnifiedStore } from '@/core/unifiedStore'
import { useFilterDeferredInteraction } from '@/core/composables/filterControls/useFilterDeferredInteraction'
import { useFilterKeyframeActions } from '@/core/composables/filterControls/useFilterKeyframeActions'
import { useFilterPropertiesState } from '@/core/composables/filterControls/useFilterPropertiesState'
import type { UnifiedFilterControlsOptions } from '@/core/composables/filterControls/types'

export type { UnifiedFilterControlsOptions, FilterDeferredPatch } from '@/core/composables/filterControls/types'
export { cancelFilterDeferredInteractionByTimelineItemId } from '@/core/composables/filterControls/useFilterDeferredInteraction'

export function useUnifiedFilterControls(options: UnifiedFilterControlsOptions) {
  const unifiedStore = useUnifiedStore()

  const filterState = useFilterPropertiesState(options)
  const keyframeActions = useFilterKeyframeActions({
    ...options,
    unifiedStore,
    canOperateFilterNumbers: filterState.canOperateFilterNumbers,
  })
  const deferredInteraction = useFilterDeferredInteraction({
    ...options,
    unifiedStore,
    canOperateFilterNumbers: filterState.canOperateFilterNumbers,
  })

  return {
    ...filterState,
    ...keyframeActions,
    ...deferredInteraction,
  }
}
