import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => ({}) }))

import { sortTimelineItemsByTrackIndex } from '@/core/utils/timelineVisibilityUtils'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

function item(id: string, trackId: string): UnifiedTimelineItemData<'text'> {
  return { id, trackId } as UnifiedTimelineItemData<'text'>
}

describe('timeline layer order', () => {
  it('places higher track indexes first for topmost hit testing', () => {
    const sorted = sortTimelineItemsByTrackIndex(
      [item('bottom', 'track-0'), item('top', 'track-2'), item('middle', 'track-1')],
      new Map([
        ['track-0', 0],
        ['track-1', 1],
        ['track-2', 2],
      ]),
    )

    expect(sorted.map((timelineItem) => timelineItem.id)).toEqual(['top', 'middle', 'bottom'])
  })
})
