import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as typeof globalThis & { window: Record<string, unknown> }).window = {
    showDirectoryPicker: () => undefined,
    FileSystemDirectoryHandle: class FileSystemDirectoryHandle {},
  }
})

vi.mock('@/core/utils/textTimelineUtils', () => ({
  createTextTimelineItem: async (
    text: string,
    _style: unknown,
    startTimeFrames: number,
    trackId: string,
    duration: number,
    customId?: string,
  ) => ({
    id: customId ?? 'text-item',
    mediaItemId: null,
    trackId,
    mediaType: 'text',
    timeRange: {
      timelineStartTime: startTimeFrames,
      timelineEndTime: startTimeFrames + duration,
      clipStartTime: -1,
      clipEndTime: -1,
    },
    baseRenderConfig: { text: { content: text, style: {} } },
    exRenderConfig: {},
    timelineStatus: 'ready',
    runtime: { exRenderConfig: {}, isInitialized: true },
  }),
}))

vi.mock('@/core/timelineitem/mutations', () => ({
  TimelineItemMutations: {
    patchBaseVisualConfig: () => undefined,
  },
}))

vi.mock('@/core/bunnyUtils/timelineItemSetup', () => ({
  setupTimelineItemBunny: async () => undefined,
}))
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { createUnifiedTrackData, type UnifiedTrackData } from '@/core/track/TrackTypes'
import { GenerateSubtitlesCommand } from '@/core/modules/commands/GenerateSubtitlesCommand'
import type { MediaAsrInput, MediaAsrResult } from '@/core/asr/types'

function createSource(): UnifiedTimelineItemData {
  return {
    id: 'source-item',
    mediaItemId: 'media-1',
    trackId: 'video-track',
    mediaType: 'audio',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: 300,
      clipStartTime: 0,
      clipEndTime: 300,
    },
    baseRenderConfig: {} as UnifiedTimelineItemData['baseRenderConfig'],
    exRenderConfig: {},
    runtime: { exRenderConfig: {}, isInitialized: true },
  } as UnifiedTimelineItemData
}

function createHarness(ensureAsr: (input: MediaAsrInput) => Promise<MediaAsrResult>) {
  const source = createSource()
  const timelineItems = [source]
  const tracks: UnifiedTrackData[] = [createUnifiedTrackData('video')]
  const options = {
    mediaId: 'media-1',
    sourceTimelineItemId: source.id,
    requestedRange: { start_ms: 0, end_ms: 10_000 },
    recognitionRange: { start_ms: 0, end_ms: 10_000 },
    ensureAsr,
    getTimelineItem: (id: string) => timelineItems.find((item) => item.id === id),
    getTimelineItems: () => timelineItems,
    addTimelineItem: async (item: UnifiedTimelineItemData) => timelineItems.push(item),
    removeTimelineItem: async (id: string) => {
      const index = timelineItems.findIndex((item) => item.id === id)
      if (index >= 0) timelineItems.splice(index, 1)
    },
    getTrack: (id: string) => tracks.find((track) => track.id === id),
    getTracks: () => tracks,
    addTrack: (track: UnifiedTrackData) => {
      tracks.push(track)
      return track
    },
    removeTrack: async (id: string) => {
      const index = tracks.findIndex((track) => track.id === id)
      if (index >= 0) tracks.splice(index, 1)
    },
    hasTimelineItemsOnTrack: (trackId: string) =>
      timelineItems.some((item) => item.trackId === trackId),
  }
  return { source, timelineItems, tracks, options }
}

function addTextTrackItem(
  harness: ReturnType<typeof createHarness>,
  track: UnifiedTrackData,
  start: number,
  end: number,
  id: string,
) {
  harness.timelineItems.push({
    id,
    mediaItemId: null,
    trackId: track.id,
    mediaType: 'text',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: start,
      timelineEndTime: end,
      clipStartTime: -1,
      clipEndTime: -1,
    },
    baseRenderConfig: {} as UnifiedTimelineItemData['baseRenderConfig'],
    exRenderConfig: {},
    runtime: { exRenderConfig: {}, isInitialized: true },
  } as UnifiedTimelineItemData)
}

describe('GenerateSubtitlesCommand history lifecycle', () => {
  it('enters history after creating the placeholder and can undo while ASR is pending', async () => {
    let resolveAsr!: (result: MediaAsrResult) => void
    const asrPromise = new Promise<MediaAsrResult>((resolve) => {
      resolveAsr = resolve
    })
    let requestedTimelineItemId = ''
    const harness = createHarness(async (input) => {
      requestedTimelineItemId = input.timelineItemId
      return asrPromise
    })
    const command = new GenerateSubtitlesCommand(harness.options)

    await command.execute()
    expect(harness.timelineItems).toHaveLength(2)
    expect(requestedTimelineItemId).not.toBe(harness.source.id)
    expect(harness.timelineItems.some((item) => item.timelinePlaceholder?.kind === 'asr')).toBe(
      true,
    )

    await command.undo()
    expect(harness.timelineItems).toEqual([harness.source])
    expect(harness.tracks.some((track) => track.type === 'text')).toBe(false)

    resolveAsr({
      mediaId: 'media-1',
      recognitionRange: { start_ms: 0, end_ms: 10_000 },
      segments: [],
      fromCache: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.timelineItems).toEqual([harness.source])
  })

  it('keeps the placeholder and records an error when the background task fails', async () => {
    const harness = createHarness(async () => {
      throw new Error('provider failed')
    })
    const command = new GenerateSubtitlesCommand(harness.options)

    await command.execute()
    await Promise.resolve()
    await Promise.resolve()

    const placeholder = harness.timelineItems.find(
      (item) => item.timelinePlaceholder?.kind === 'asr',
    )
    expect(placeholder?.timelineStatus).toBe('error')
    expect(placeholder?.timelinePlaceholder?.state).toBe('error')
  })

  it('uses the nearest text track whose time range is free', async () => {
    const harness = createHarness(async () => new Promise<MediaAsrResult>(() => undefined))
    const farTextTrack = createUnifiedTrackData('text')
    const nearTextTrack = createUnifiedTrackData('text')
    harness.tracks.push(farTextTrack, nearTextTrack)
    addTextTrackItem(harness, nearTextTrack, 0, 250, 'near-existing')

    const command = new GenerateSubtitlesCommand(harness.options)
    await command.execute()

    const placeholder = harness.timelineItems.find(
      (item) => item.timelinePlaceholder?.kind === 'asr',
    )
    expect(placeholder?.trackId).toBe(farTextTrack.id)
  })

  it('creates a new text track when every existing text track overlaps', async () => {
    const harness = createHarness(async () => new Promise<MediaAsrResult>(() => undefined))
    const firstTextTrack = createUnifiedTrackData('text')
    const secondTextTrack = createUnifiedTrackData('text')
    harness.tracks.push(firstTextTrack, secondTextTrack)
    addTextTrackItem(harness, firstTextTrack, 0, 400, 'first-existing')
    addTextTrackItem(harness, secondTextTrack, 0, 400, 'second-existing')

    const command = new GenerateSubtitlesCommand(harness.options)
    await command.execute()

    const placeholder = harness.timelineItems.find(
      (item) => item.timelinePlaceholder?.kind === 'asr',
    )
    expect(placeholder?.trackId).toBe(harness.tracks.at(-1)?.id)
    expect(harness.tracks.at(-1)?.type).toBe('text')
  })
})
