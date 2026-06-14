import { cloneDeep } from 'lodash'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import { TimelineItemFactory } from '@/core/timelineitem/factory'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { TimelineJsonBundle } from './types'

function cloneTrack(track: UnifiedTrackData): UnifiedTrackData {
  return cloneDeep(track) as UnifiedTrackData
}

function cloneTimelineItem(item: UnifiedTimelineItemData): UnifiedTimelineItemData {
  const clonedItem = TimelineItemFactory.clone(item)
  if (clonedItem.runtime) {
    clonedItem.runtime = {
      isInitialized: clonedItem.runtime.isInitialized,
    }
  }
  return cloneDeep(clonedItem) as UnifiedTimelineItemData
}

export function exportTimelineJsonBundle(params: {
  projectId: string
  tracks: UnifiedTrackData[]
  timelineItems: UnifiedTimelineItemData[]
}): TimelineJsonBundle {
  const { projectId, tracks, timelineItems } = params

  return {
    projectId,
    tracks: tracks.map(cloneTrack),
    timelineItems: timelineItems.map(cloneTimelineItem),
  }
}
