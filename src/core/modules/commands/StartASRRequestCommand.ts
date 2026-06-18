import type { Ref } from 'vue'
import { generateCommandId, generateTimelineItemId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import { createUnifiedTrackData } from '@/core/track/TrackTypes'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import { findOverlappingTimelineItemsOnTrack } from '@/core/utils/timelineSearchUtils'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

type TimelineModule = {
  addTimelineItem: (item: UnifiedTimelineItemData<MediaType>) => Promise<void>
  removeTimelineItem: (id: string) => Promise<void>
  getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
  timelineItems: Ref<UnifiedTimelineItemData<MediaType>[]>
}

type TrackModule = {
  addTrack: (trackData: UnifiedTrackData, position?: number) => UnifiedTrackData
  removeTrack: (trackId: string) => Promise<void>
  getTrack: (trackId: string) => UnifiedTrackData | undefined
  tracks: Ref<UnifiedTrackData[]>
}

type MediaModule = {
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
}

export class StartASRRequestCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private readonly placeholderTimelineItemId: string
  private originalProjectionItems: UnifiedTimelineItemData<MediaType>[] = []
  private createdTrackSnapshot: UnifiedTrackData | null = null
  private createdTrackPosition: number | null = null
  private targetTrackId: string | null = null
  private _isDisposed = false

  constructor(
    private readonly sourceTimelineItem: UnifiedTimelineItemData<MediaType>,
    private readonly durationFrames: number,
    private readonly requestId: string,
    private readonly remoteTaskId: string,
    private readonly timelineModule: TimelineModule,
    private readonly trackModule: TrackModule,
    private readonly mediaModule: MediaModule,
    private readonly ensureTimelineItemResolved: (timelineItemId: string) => Promise<unknown>,
  ) {
    this.id = generateCommandId()
    this.description = `发起 ASR 请求: ${requestId}`
    this.placeholderTimelineItemId = generateTimelineItemId()
  }

  async execute(): Promise<void> {
    const currentProjectionItems = this.getCurrentProjectionItems()
    if (currentProjectionItems.length > 0) {
      return
    }

    if (this.originalProjectionItems.length > 0) {
      await this.restoreProjectionItems()
      return
    }

    await this.ensureTargetTrack()
    await this.createPlaceholderProjection()
  }

  async undo(): Promise<void> {
    const currentProjectionItems = this.getCurrentProjectionItems()
    if (currentProjectionItems.length === 0) {
      await this.cleanupManagedTrackIfEmpty()
      return
    }

    this.originalProjectionItems = currentProjectionItems.map((item) => TimelineItemFactory.clone(item))

    for (const item of currentProjectionItems) {
      await this.timelineModule.removeTimelineItem(item.id)
    }

    await this.cleanupManagedTrackIfEmpty()
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
  }

  private async ensureTargetTrack(): Promise<void> {
    if (this.targetTrackId && this.trackModule.getTrack(this.targetTrackId)) {
      return
    }

    if (this.createdTrackSnapshot) {
      this.trackModule.addTrack(
        createUnifiedTrackData(
          this.createdTrackSnapshot.type,
          { ...this.createdTrackSnapshot },
          this.createdTrackSnapshot.id,
        ),
        this.createdTrackPosition ?? undefined,
      )
      this.targetTrackId = this.createdTrackSnapshot.id
      return
    }

    const sourceTrackIndex = this.trackModule.tracks.value.findIndex(
      (track) => track.id === this.sourceTimelineItem.trackId,
    )
    if (sourceTrackIndex === -1) {
      throw new Error(`找不到源轨道: ${this.sourceTimelineItem.trackId}`)
    }

    const upperTextTracks = this.trackModule.tracks.value
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => track.type === 'text' && index < sourceTrackIndex)
      .sort((a, b) => b.index - a.index)
      .map(({ track }) => track)

    for (const track of upperTextTracks) {
      const overlappingItems = findOverlappingTimelineItemsOnTrack(
        track.id,
        this.sourceTimelineItem.timeRange.timelineStartTime,
        this.sourceTimelineItem.timeRange.timelineStartTime + this.durationFrames,
        this.timelineModule.timelineItems.value,
      )

      if (overlappingItems.length === 0) {
        this.targetTrackId = track.id
        return
      }
    }

    const createdTrack = createUnifiedTrackData('text')
    this.createdTrackSnapshot = { ...createdTrack }
    this.createdTrackPosition = sourceTrackIndex
    this.trackModule.addTrack(createdTrack, sourceTrackIndex)
    this.targetTrackId = createdTrack.id
  }

  private async createPlaceholderProjection(): Promise<void> {
    if (!this.targetTrackId) {
      throw new Error('ASR 目标轨道不存在')
    }

    const placeholderItem = await createTextTimelineItem(
      '',
      {
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      },
      this.sourceTimelineItem.timeRange.timelineStartTime,
      this.targetTrackId,
      this.durationFrames,
      this.placeholderTimelineItemId,
    )

    placeholderItem.isPlaceholder = true
    placeholderItem.timelineStatus = 'loading'
    placeholderItem.task = {
      kind: 'asr-subtitles',
      requestId: this.requestId,
      remoteTaskId: this.remoteTaskId,
      status: 'processing',
      sourceTimelineItemId: this.sourceTimelineItem.id,
    }

    await this.timelineModule.addTimelineItem(placeholderItem)

    void this.ensureTimelineItemResolved(placeholderItem.id).catch((error) => {
      console.error(`❌ ASR placeholder resolve 启动失败: ${placeholderItem.id}`, error)
    })
  }

  private async restoreProjectionItems(): Promise<void> {
    await this.ensureTargetTrack()

    const restoredItems: UnifiedTimelineItemData<MediaType>[] = []
    for (const originalItem of this.originalProjectionItems) {
      const rebuildResult = await TimelineItemFactory.buildForDag({
        originalTimelineItemData: originalItem,
        getMediaItem: this.mediaModule.getMediaItem,
        logIdentifier: 'StartASRRequestCommand execute',
      })

      if (!rebuildResult.success) {
        throw new Error(`恢复 ASR request 投影失败: ${rebuildResult.error}`)
      }

      restoredItems.push(rebuildResult.timelineItem)
    }

    for (const restoredItem of restoredItems) {
      await this.timelineModule.addTimelineItem(restoredItem)
    }

    for (const restoredItem of restoredItems) {
      if (TimelineItemQueries.isLoading(restoredItem) || restoredItem.isPlaceholder) {
        void this.ensureTimelineItemResolved(restoredItem.id).catch((error) => {
          console.error(`❌ timeline item resolve 启动失败: ${restoredItem.id}`, error)
        })
      }
    }
  }

  private async cleanupManagedTrackIfEmpty(): Promise<void> {
    if (!this.createdTrackSnapshot) {
      return
    }

    const trackId = this.createdTrackSnapshot.id
    const track = this.trackModule.getTrack(trackId)
    if (!track) {
      return
    }

    const hasRemainingItems = this.timelineModule.timelineItems.value.some((item) => item.trackId === trackId)
    if (hasRemainingItems) {
      return
    }

    await this.trackModule.removeTrack(trackId)
  }

  private getCurrentProjectionItems(): UnifiedTimelineItemData<MediaType>[] {
    return this.timelineModule.timelineItems.value
      .filter((item) => {
        const placeholderRequestId =
          item.isPlaceholder && item.task?.kind === 'asr-subtitles' ? item.task.requestId : undefined
        return placeholderRequestId === this.requestId || item.provenance?.asrRequestId === this.requestId
      })
      .sort((a, b) => {
        if (a.timeRange.timelineStartTime !== b.timeRange.timelineStartTime) {
          return a.timeRange.timelineStartTime - b.timeRange.timelineStartTime
        }
        return a.id.localeCompare(b.id)
      })
  }
}
