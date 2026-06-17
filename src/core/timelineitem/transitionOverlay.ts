import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import {
  type ClipTransitionBindingState,
  normalizeClipTransitionOutConfig,
  supportsClipTransitionOut,
} from '@/core/timelineitem/transition'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { buildTransitionSelectionId, type TimelineSelectionId } from '@/core/types/timelineSelection'

export interface TimelineTransitionOverlayViewModel {
  selectionId: TimelineSelectionId
  sourceItemId: string
  trackId: string
  bindingState: ClipTransitionBindingState
  seamFrame: number
  displayStartFrame: number
  displayEndFrame: number
}

export function createTimelineTransitionOverlay(
  item: UnifiedTimelineItemData<MediaType>,
): TimelineTransitionOverlayViewModel | null {
  const transitionConfig = TimelineItemQueries.getTransition(item)
  if (!supportsClipTransitionOut(item) || !transitionConfig) {
    return null
  }

  const transitionOut = normalizeClipTransitionOutConfig(transitionConfig)
  const leftHalfFrames = Math.floor(transitionOut.durationFrames / 2)
  const rightHalfFrames = transitionOut.durationFrames - leftHalfFrames
  const seamFrame = item.timeRange.timelineEndTime

  return {
    selectionId: buildTransitionSelectionId(item.id),
    sourceItemId: item.id,
    trackId: item.trackId,
    bindingState: item.runtime.transition?.bindingState ?? 'unbound',
    seamFrame,
    displayStartFrame: Math.max(0, seamFrame - leftHalfFrames),
    displayEndFrame: seamFrame + rightHalfFrames,
  }
}
