import { useUnifiedStore } from '@/core/unifiedStore'
import { useMaskDeferredInteraction } from '@/core/composables/maskControls/useMaskDeferredInteraction'
import { useMaskKeyframeActions } from '@/core/composables/maskControls/useMaskKeyframeActions'
import { useMaskPropertiesState } from '@/core/composables/maskControls/useMaskPropertiesState'
import type {
  UnifiedMaskKeyframeControlsOptions,
  MaskChannelKey,
  MaskDeferredPatch,
} from '@/core/composables/maskControls/types'

export type { UnifiedMaskKeyframeControlsOptions, MaskChannelKey, MaskDeferredPatch }

export function useUnifiedMaskKeyframeControls(
  options: UnifiedMaskKeyframeControlsOptions,
) {
  const unifiedStore = useUnifiedStore()

  const maskState = useMaskPropertiesState(options)
  const maskKeyframeActions = useMaskKeyframeActions({
    ...options,
    unifiedStore,
    canOperateMaskNumbers: maskState.canOperateMaskNumbers,
  })
  const deferredInteraction = useMaskDeferredInteraction({
    ...options,
    unifiedStore,
    canOperateMaskNumbers: maskState.canOperateMaskNumbers,
  })

  return {
    ...maskState,
    ...maskKeyframeActions,
    ...deferredInteraction,
  }
}
