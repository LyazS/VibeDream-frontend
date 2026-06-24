import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/model/timelineItem'
import type {
  AudioMediaConfig,
  ImageMediaConfig,
  UnifiedTimelineItemData,
  VideoMediaConfig,
} from '@/core/timelineitem/model/timelineItem'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTrackType } from '@/core/track/TrackTypes'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { isTimeRangeOverlapping } from '@/core/utils/timeOverlapUtils'
import {
  AddTimelineItemCommand,
  MoveTimelineItemCommand,
  RemoveTimelineItemCommand,
  ResizeTimelineItemCommand,
  SplitTimelineItemCommand,
} from '@/core/modules/commands/timelineCommands'
import { generateTimelineItemId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import { buildToolError } from './utils/result'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'

type TimelineCommand =
  | AddTimelineItemCommand
  | MoveTimelineItemCommand
  | RemoveTimelineItemCommand
  | ResizeTimelineItemCommand
  | SplitTimelineItemCommand

export function parseRequiredTimecode(
  tool: string,
  value: unknown,
  field: string,
) {
  if (typeof value !== 'string' || !isValidAgentToolTimecode(value)) {
    return {
      ok: false as const,
      error: buildToolError(
        tool,
        'invalid_timecode',
        `${field} 不是合法时间码，格式应为 HH:MM:SS+FF。`,
        { field, value },
      ),
    }
  }

  return {
    ok: true as const,
    frames: parseAgentToolTimecode(value),
    timecode: value,
  }
}

export function getExpectedTrackTypeForMedia(mediaType: MediaType): UnifiedTrackType {
  if (mediaType === 'audio') {
    return 'audio'
  }

  if (mediaType === 'text') {
    return 'text'
  }

  return 'video'
}

export function validateTrackCompatibility(
  trackType: UnifiedTrackType,
  mediaType: MediaType,
): boolean {
  return trackType === getExpectedTrackTypeForMedia(mediaType)
}

export function buildClipSnapshot(item: UnifiedTimelineItemData) {
  return {
    clipId: item.id,
    mediaId: item.mediaItemId || undefined,
    mediaType: item.mediaType,
    trackId: item.trackId,
    timeline: {
      start: framesToTimecode(item.timeRange.timelineStartTime),
      end: framesToTimecode(item.timeRange.timelineEndTime),
      duration: framesToTimecode(
        item.timeRange.timelineEndTime - item.timeRange.timelineStartTime,
      ),
    },
    source:
      item.mediaType === 'video' || item.mediaType === 'audio'
        ? {
            start: framesToTimecode(item.timeRange.clipStartTime),
            end: framesToTimecode(item.timeRange.clipEndTime),
          }
        : undefined,
  }
}

export function findTrackConflict(params: {
  trackId: string
  start: number
  end: number
  excludeClipIds?: string[]
}) {
  const store = useUnifiedStore()
  const excludeIds = new Set(params.excludeClipIds || [])

  return store.timelineItems.find((item) => {
    if (item.trackId !== params.trackId) {
      return false
    }

    if (excludeIds.has(item.id)) {
      return false
    }

    return isTimeRangeOverlapping(
      { start: params.start, end: params.end },
      {
        start: item.timeRange.timelineStartTime,
        end: item.timeRange.timelineEndTime,
      },
    )
  })
}

export async function executeSingleCommand(command: SimpleCommand): Promise<void> {
  const store = useUnifiedStore()
  const batch = store.startBatch(command.description)
  batch.addCommand(command)
  await store.executeBatchCommand(batch.build())
}

export async function ensureMediaReadyForInsert(mediaId: string): Promise<UnifiedMediaItemData> {
  const store = useUnifiedStore()
  const mediaItem = store.getMediaItem(mediaId)

  if (!mediaItem) {
    throw new Error(`未找到素材 ${mediaId}`)
  }

  if (mediaItem.mediaStatus === 'ready') {
    return mediaItem
  }

  if (mediaItem.mediaStatus === 'pending') {
    await store.ensureMediaReady(mediaId)
  }

  if (
    mediaItem.mediaStatus === 'pending' ||
    mediaItem.mediaStatus === 'asyncprocessing' ||
    mediaItem.mediaStatus === 'decoding'
  ) {
    await store.waitForMediaItemReady(mediaId)
  }

  const resolvedMediaItem = store.getMediaItem(mediaId)
  if (!resolvedMediaItem) {
    throw new Error(`素材 ${mediaId} 加载完成后未能重新读取`)
  }

  return resolvedMediaItem
}

export function createTimelineCommandHelpers() {
  const store = useUnifiedStore()

  return {
    store,
    createAddTimelineItemCommand(item: UnifiedTimelineItemData): TimelineCommand {
      return new AddTimelineItemCommand(
        item,
        {
          addTimelineItem: store.addTimelineItem.bind(store),
          removeTimelineItem: store.removeTimelineItem.bind(store),
          getTimelineItem: (id: string) => store.getTimelineItem(id),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
        store.ensureTimelineItemResolved,
      )
    },
    createMoveTimelineItemCommand(
      item: UnifiedTimelineItemData,
      newStart: number,
      newTrackId: string,
    ): TimelineCommand {
      return new MoveTimelineItemCommand(
        item.id,
        item.timeRange.timelineStartTime,
        newStart,
        item.trackId,
        newTrackId,
        {
          updateTimelineItemPosition: store.updateTimelineItemPosition.bind(store),
          getTimelineItem: (id: string) => store.getTimelineItem(id),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
      )
    },
    createResizeTimelineItemCommand(
      item: UnifiedTimelineItemData,
      newTimeRange: UnifiedTimeRange,
    ): TimelineCommand {
      return new ResizeTimelineItemCommand(
        item.id,
        { ...item.timeRange },
        newTimeRange,
        {
          getTimelineItem: (id: string) => store.getTimelineItem(id),
          setTimelineItemTimeRangeForCmd: store.setTimelineItemTimeRangeForCmd.bind(store),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
      )
    },
    createSplitTimelineItemCommand(
      item: UnifiedTimelineItemData,
      splitTimeFrames: number[],
    ): TimelineCommand {
      return new SplitTimelineItemCommand(
        item.id,
        item,
        splitTimeFrames,
        {
          addTimelineItem: store.addTimelineItem.bind(store),
          removeTimelineItem: store.removeTimelineItem.bind(store),
          getTimelineItem: (id: string) => store.getTimelineItem(id),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
        store.ensureTimelineItemResolved.bind(store),
      )
    },
    createRemoveTimelineItemCommand(itemId: string): TimelineCommand {
      return new RemoveTimelineItemCommand(
        itemId,
        {
          addTimelineItem: store.addTimelineItem.bind(store),
          removeTimelineItem: store.removeTimelineItem.bind(store),
          getTimelineItem: (id: string) => store.getTimelineItem(id),
        },
        {
          getMediaItem: (id: string | null) => (id ? store.getMediaItem(id) : undefined),
        },
        store.ensureTimelineItemResolved,
      )
    },
  }
}

export function buildTimelineItemFromMedia(params: {
  mediaItem: UnifiedMediaItemData
  trackId: string
  timelineStartTime: number
  clipStartTime?: number
  clipEndTime?: number
}) {
  const store = useUnifiedStore()
  const { mediaItem, trackId, timelineStartTime } = params

  if (mediaItem.mediaType === 'unknown') {
    throw new Error('素材类型未确定，请等待检测完成')
  }

  if (mediaItem.mediaType === 'text') {
    throw new Error('insert_clip 暂不支持 text 素材')
  }

  if (mediaItem.mediaStatus !== 'ready') {
    throw new Error(`素材尚未就绪，当前状态为 ${mediaItem.mediaStatus}`)
  }

  const expectedTrackType = getExpectedTrackTypeForMedia(mediaItem.mediaType)
  const track = store.getTrack(trackId)
  if (!track) {
    throw new Error(`目标轨道不存在: ${trackId}`)
  }

  if (!validateTrackCompatibility(track.type, mediaItem.mediaType)) {
    throw new Error(
      `轨道类型不匹配：${mediaItem.mediaType} 素材只能放入 ${expectedTrackType} 轨道，当前为 ${track.type}`,
    )
  }

  const availableDuration = mediaItem.duration
  if (!availableDuration || availableDuration <= 0) {
    throw new Error('素材时长信息不可用，请等待解析完成')
  }

  const clipStartTime = params.clipStartTime ?? 0
  const clipEndTime = params.clipEndTime ?? availableDuration

  if (clipStartTime < 0 || clipEndTime <= clipStartTime) {
    throw new Error('素材裁切区间无效')
  }

  if (clipEndTime > availableDuration) {
    throw new Error('clipEndTime 超出素材时长范围')
  }

  const duration = clipEndTime - clipStartTime
  const timelineEndTime = timelineStartTime + duration

  let originalResolution: { width: number; height: number } | null = null
  if (mediaItem.mediaType === 'video') {
    originalResolution = store.getVideoOriginalResolution(mediaItem.id) || null
  } else if (mediaItem.mediaType === 'image') {
    originalResolution = store.getImageOriginalResolution(mediaItem.id) || null
  }

  return {
    id: generateTimelineItemId(),
    mediaItemId: mediaItem.id,
    trackId,
    mediaType: mediaItem.mediaType,
    timeRange: {
      timelineStartTime,
      timelineEndTime,
      clipStartTime,
      clipEndTime,
    },
    baseRenderConfig: createDefaultTimelineItemConfig(mediaItem.mediaType, originalResolution),
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    animation: undefined,
    timelineStatus: 'loading' as const,
    runtime: {
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: false,
    },
  } satisfies UnifiedTimelineItemData
}

function createDefaultTimelineItemConfig(
  mediaType: Exclude<MediaType, 'text' | 'unknown'>,
  originalResolution: { width: number; height: number } | null,
): VideoMediaConfig | ImageMediaConfig | AudioMediaConfig {
  if (mediaType === 'audio') {
    return {
      audio: {
        volume: 1,
        isMuted: false,
      },
    }
  }

  const width = originalResolution?.width || 1920
  const height = originalResolution?.height || 1080

  const visual = {
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    blendMode: DEFAULT_BLEND_MODE,
    proportionalScale: true,
  }

  if (mediaType === 'video') {
    return {
      visual,
      audio: {
        volume: 1,
        isMuted: false,
      },
    }
  }

  return {
    visual,
  }
}
