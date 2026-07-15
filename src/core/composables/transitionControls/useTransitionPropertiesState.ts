import { computed } from 'vue'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { normalizeClipTransitionOutConfig } from '@/core/timelineitem/features/transition'
import type { UnifiedTransitionControlsOptions } from './types'

export function useTransitionPropertiesState(options: UnifiedTransitionControlsOptions) {
  const { selectedTimelineItem } = options

  const baseTransitionConfig = computed(() =>
    selectedTimelineItem.value
      ? TimelineItemQueries.getBaseTransition(selectedTimelineItem.value)
      : undefined,
  )

  const transitionConfig = computed(() =>
    normalizeClipTransitionOutConfig(
      selectedTimelineItem.value
        ? TimelineItemQueries.getResolvedTransition(selectedTimelineItem.value)
        : undefined,
    ),
  )

  const hasTransitionConfig = computed(() => Boolean(baseTransitionConfig.value))

  const transitionParameterSchema = computed(() =>
    transitionConfig.value.packagePayload?.parameterSchema ?? {},
  )

  return {
    transitionConfig,
    hasTransitionConfig,
    transitionParameterSchema,
  }
}
