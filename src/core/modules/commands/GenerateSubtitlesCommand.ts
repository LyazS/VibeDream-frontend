import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import { createUnifiedTrackData } from '@/core/track/TrackTypes'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { generateCommandId, generateTimelineItemId } from '@/core/utils/idGenerator'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import type { AsrRange, MediaAsrInput, MediaAsrResult } from '@/core/asr/types'
import { materializeAsrSubtitles } from '@/core/asr/materializeSubtitles'
import { isTimeRangeOverlapping } from '@/core/utils/timeOverlapUtils'

export interface GenerateSubtitlesCommandOptions {
  mediaId: string
  sourceTimelineItemId: string
  requestedRange: AsrRange
  recognitionRange: AsrRange
  targetTrackId?: string
  ensureAsr(input: MediaAsrInput): Promise<MediaAsrResult>
  getTimelineItem(id: string): UnifiedTimelineItemData | undefined
  getTimelineItems(): UnifiedTimelineItemData[]
  addTimelineItem(item: UnifiedTimelineItemData): Promise<void>
  removeTimelineItem(id: string): Promise<void>
  getTrack(id: string): UnifiedTrackData | undefined
  getTracks(): UnifiedTrackData[]
  addTrack(track: UnifiedTrackData, position?: number): UnifiedTrackData
  removeTrack(id: string): Promise<void>
  hasTimelineItemsOnTrack(trackId: string): boolean
}

export class GenerateSubtitlesCommand implements SimpleCommand {
  readonly id = generateCommandId()
  readonly historyLabel = { key: 'notification.history.command.addTimelineItem' as const }
  private readonly placeholderId = generateTimelineItemId()
  private generatedIds: string[] = []
  private createdTrackId?: string
  private runVersion = 0
  private disposed = false

  constructor(private readonly options: GenerateSubtitlesCommandOptions) {}

  private async createPlaceholder(trackId: string): Promise<void> {
    if (this.options.getTimelineItem(this.placeholderId)) return
    const source = this.options.getTimelineItem(this.options.sourceTimelineItemId)
    if (!source) throw new Error('找不到用于识别字幕的时间轴片段')
    const sourceStartMs = (source.timeRange.clipStartTime / RENDERER_FPS) * 1000
    const startFrame = Math.round(
      source.timeRange.timelineStartTime +
        ((this.options.requestedRange.start_ms - sourceStartMs) / 1000) * RENDERER_FPS,
    )
    const durationFrames = Math.max(
      1,
      Math.round(
        ((this.options.requestedRange.end_ms - this.options.requestedRange.start_ms) / 1000) *
          RENDERER_FPS,
      ),
    )
    const placeholder = await createTextTimelineItem(
      '正在识别字幕…',
      {},
      startFrame,
      trackId,
      durationFrames,
      this.placeholderId,
    )
    placeholder.timelineStatus = 'loading'
    placeholder.timelinePlaceholder = {
      kind: 'asr',
      state: 'active',
      payload: {
        sourceMediaId: this.options.mediaId,
        sourceTimelineItemId: this.options.sourceTimelineItemId,
        requestedRange: this.options.requestedRange,
        recognitionRange: this.options.recognitionRange,
      },
    }
    await this.options.addTimelineItem(placeholder)
  }

  private async resolveTrack(): Promise<string> {
    const source = this.options.getTimelineItem(this.options.sourceTimelineItemId)
    if (!source) throw new Error('找不到用于识别字幕的时间轴片段')

    const sourceStartMs = (source.timeRange.clipStartTime / RENDERER_FPS) * 1000
    const placeholderStart = Math.round(
      source.timeRange.timelineStartTime +
        ((this.options.requestedRange.start_ms - sourceStartMs) / 1000) * RENDERER_FPS,
    )
    const placeholderEnd =
      placeholderStart +
      Math.max(
        1,
        Math.round(
          ((this.options.requestedRange.end_ms - this.options.requestedRange.start_ms) / 1000) *
            RENDERER_FPS,
        ),
      )
    const tracks = this.options.getTracks()
    const sourceTrackIndex = tracks.findIndex((track) => track.id === source.trackId)
    const textTracks = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.type === 'text')
      .sort((a, b) => {
        if (sourceTrackIndex < 0) return a.index - b.index
        const distance = Math.abs(a.index - sourceTrackIndex) - Math.abs(b.index - sourceTrackIndex)
        return distance || a.index - b.index
      })

    const isTrackAvailable = (trackId: string) =>
      !this.options
        .getTimelineItems()
        .some(
          (item) =>
            item.trackId === trackId &&
            isTimeRangeOverlapping(
              { start: item.timeRange.timelineStartTime, end: item.timeRange.timelineEndTime },
              { start: placeholderStart, end: placeholderEnd },
            ),
        )

    if (
      this.options.targetTrackId &&
      this.options.getTrack(this.options.targetTrackId)?.type === 'text' &&
      isTrackAvailable(this.options.targetTrackId)
    ) {
      return this.options.targetTrackId
    }

    const availableTrack = textTracks.find(({ track }) => isTrackAvailable(track.id))
    if (availableTrack) return availableTrack.track.id

    const track = this.options.addTrack(createUnifiedTrackData('text'))
    this.createdTrackId = track.id
    return track.id
  }

  private async resolveInBackground(runVersion: number): Promise<void> {
    try {
      const result = await this.options.ensureAsr({
        mediaId: this.options.mediaId,
        timelineItemId: this.placeholderId,
        requestedRange: this.options.requestedRange,
        recognitionRange: this.options.recognitionRange,
      })
      if (runVersion !== this.runVersion) return
      const source = this.options.getTimelineItem(this.options.sourceTimelineItemId)
      if (!source) throw new Error('找不到用于生成字幕的原始时间轴片段')
      const placeholder = this.options.getTimelineItem(this.placeholderId)
      // 占位符被显式删除后，远程任务仍会继续完成，但结果只写入素材缓存。
      // 不能因为异步命令稍后返回，就重新把字幕投影插回时间轴。
      if (!placeholder) return
      this.generatedIds = await materializeAsrSubtitles({
        placeholderId: this.placeholderId,
        result,
        getTimelineItem: this.options.getTimelineItem,
        getTimelineItems: this.options.getTimelineItems,
        removeTimelineItem: this.options.removeTimelineItem,
        addTimelineItem: this.options.addTimelineItem,
      })
    } catch (error) {
      if (runVersion !== this.runVersion) return
      const placeholder = this.options.getTimelineItem(this.placeholderId)
      if (placeholder?.timelinePlaceholder) {
        placeholder.timelineStatus = 'error'
        placeholder.timelinePlaceholder.state = 'error'
        placeholder.timelinePlaceholder.error = {
          code: 'ASR_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }
      }
      console.error('字幕识别失败', error)
    }
  }

  async execute(): Promise<void> {
    this.createdTrackId = undefined
    const trackId = await this.resolveTrack()
    await this.createPlaceholder(trackId)
    this.generatedIds = []
    const runVersion = ++this.runVersion
    void this.resolveInBackground(runVersion)
  }

  async undo(): Promise<void> {
    this.runVersion++
    for (const id of this.generatedIds) await this.options.removeTimelineItem(id)
    this.generatedIds = []
    const placeholder = this.options.getTimelineItem(this.placeholderId)
    if (placeholder) await this.options.removeTimelineItem(this.placeholderId)
    if (this.createdTrackId && !this.options.hasTimelineItemsOnTrack(this.createdTrackId)) {
      await this.options.removeTrack(this.createdTrackId)
    }
  }

  dispose(): void {
    this.disposed = true
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}
