import { computed } from 'vue'
import type { UnifiedTrackData, UnifiedTrackType } from '@/core/track/TrackTypes'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  AddTrackCommand,
  MoveTrackCommand,
  RemoveTrackCommand,
  RenameTrackCommand,
  ToggleTrackMuteCommand,
  ToggleTrackVisibilityCommand,
} from '@/core/modules/commands/timelineCommands'
import type { SimpleCommand } from '@/core/modules/commands/types'

export function buildTrackSnapshot(track: UnifiedTrackData, index: number, clipCount: number) {
  return {
    trackId: track.id,
    name: track.name,
    type: track.type,
    index,
    visible: track.isVisible,
    muted: track.isMuted,
    clipCount,
  }
}

export async function executeSingleTrackCommand(command: SimpleCommand): Promise<void> {
  const store = useUnifiedStore()
  const batch = store.startBatch(command.description)
  batch.addCommand(command)
  await store.executeBatchCommand(batch.build())
}

export function getTrackClipCount(trackId: string): number {
  const store = useUnifiedStore()
  return store.timelineItems.filter((item) => item.trackId === trackId).length
}

export function findTrackIndex(trackId: string): number {
  const store = useUnifiedStore()
  return store.tracks.findIndex((track) => track.id === trackId)
}

export function createTrackCommandHelpers() {
  const store = useUnifiedStore()

  return {
    store,
    createAddTrackCommand(trackType: UnifiedTrackType, position?: number) {
      return new AddTrackCommand(
        trackType,
        position,
        {
          addTrack: store.addTrack.bind(store),
          removeTrack: store.removeTrack.bind(store),
          getTrack: (trackId: string) => store.getTrack(trackId),
        },
      )
    },
    createMoveTrackCommand(trackId: string, fromPosition: number, toPosition: number) {
      return new MoveTrackCommand(
        trackId,
        fromPosition,
        toPosition,
        {
          moveTrack: store.moveTrack.bind(store),
        },
      )
    },
    createRemoveTrackCommand(trackId: string) {
      return new RemoveTrackCommand(
        trackId,
        {
          addTrack: store.addTrack.bind(store),
          removeTrack: store.removeTrack.bind(store),
          getTrack: (id: string) => store.getTrack(id),
          tracks: { value: store.tracks },
        },
        {
          addTimelineItem: store.addTimelineItem.bind(store),
          removeTimelineItem: store.removeTimelineItem.bind(store),
          getTimelineItem: (id: string) => store.getTimelineItem(id),
          timelineItems: computed(() => store.timelineItems),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
        store.ensureTimelineItemResolved,
      )
    },
    createRenameTrackCommand(trackId: string, newName: string) {
      return new RenameTrackCommand(
        trackId,
        newName,
        {
          renameTrack: store.renameTrack.bind(store),
          getTrack: (id: string) => store.getTrack(id),
        },
      )
    },
    createSetTrackVisibilityCommand(trackId: string, visible: boolean) {
      return new ToggleTrackVisibilityCommand(
        trackId,
        {
          getTrack: (id: string) => store.getTrack(id),
          toggleTrackVisibility: store.toggleTrackVisibility.bind(store),
        },
        visible,
      )
    },
    createSetTrackMuteCommand(trackId: string, muted: boolean) {
      return new ToggleTrackMuteCommand(
        trackId,
        {
          getTrack: (id: string) => store.getTrack(id),
          toggleTrackMute: store.toggleTrackMute.bind(store),
        },
        muted,
      )
    },
  }
}
