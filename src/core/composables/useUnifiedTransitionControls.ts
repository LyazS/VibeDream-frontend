import { useUnifiedStore } from '@/core/unifiedStore'
import { useTransitionDeferredInteraction } from '@/core/composables/transitionControls/useTransitionDeferredInteraction'
import { useTransitionPropertiesState } from '@/core/composables/transitionControls/useTransitionPropertiesState'
import type { UnifiedTransitionControlsOptions } from '@/core/composables/transitionControls/types'

export type { UnifiedTransitionControlsOptions } from '@/core/composables/transitionControls/types'
export { cancelTransitionDeferredInteractionByTimelineItemId } from '@/core/composables/transitionControls/useTransitionDeferredInteraction'

export function useUnifiedTransitionControls(options: UnifiedTransitionControlsOptions) {
  const unifiedStore = useUnifiedStore()

  const transitionState = useTransitionPropertiesState(options)
  const deferredInteraction = useTransitionDeferredInteraction({
    ...options,
    unifiedStore,
    hasTransitionConfig: transitionState.hasTransitionConfig,
  })

  return {
    ...transitionState,
    ...deferredInteraction,
  }
}
