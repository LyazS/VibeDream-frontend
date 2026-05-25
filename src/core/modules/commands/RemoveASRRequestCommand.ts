import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import { TimelineItemFactory } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

type TimelineModule = {
  addTimelineItem: (item: UnifiedTimelineItemData<MediaType>) => Promise<void>
  removeTimelineItem: (id: string) => Promise<void>
  getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
}

type MediaModule = {
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
}

export class RemoveASRRequestCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private originalProjectionItems: UnifiedTimelineItemData<MediaType>[] = []
  private _isDisposed = false

  constructor(
    private readonly requestId: string,
    private readonly timelineModule: TimelineModule,
    private readonly mediaModule: MediaModule,
    private readonly ensureTimelineItemResolved: (timelineItemId: string) => Promise<unknown>,
    private readonly getTimelineItems: () => UnifiedTimelineItemData<MediaType>[],
  ) {
    this.id = generateCommandId()
    this.description = `移除 ASR 请求投影: ${requestId}`
  }

  async execute(): Promise<void> {
    try {
      const currentProjectionItems = this.getCurrentProjectionItems()
      if (currentProjectionItems.length === 0) {
        console.warn(`⚠️ 找不到 ASR request 当前投影，跳过删除: ${this.requestId}`)
        return
      }

      if (this.originalProjectionItems.length === 0) {
        this.originalProjectionItems = currentProjectionItems.map((item) => TimelineItemFactory.clone(item))
      }

      for (const item of currentProjectionItems) {
        await this.timelineModule.removeTimelineItem(item.id)
      }

      console.log(`↩️ 已删除 ASR request 当前投影: ${this.requestId}`)
    } catch (error) {
      console.error(`❌ 删除 ASR request 当前投影失败: ${this.requestId}`, error)
      throw error
    }
  }

  async undo(): Promise<void> {
    if (this.originalProjectionItems.length === 0) {
      throw new Error('没有有效的 ASR request 投影数据')
    }

    try {
      console.log(`🔄 恢复 ASR request 投影: ${this.requestId}`)

      const currentProjectionItems = this.getCurrentProjectionItems()
      for (const item of currentProjectionItems) {
        await this.timelineModule.removeTimelineItem(item.id)
      }

      const restoredItems: UnifiedTimelineItemData<MediaType>[] = []
      for (const originalItem of this.originalProjectionItems) {
        const rebuildResult = await TimelineItemFactory.buildForDag({
          originalTimelineItemData: originalItem,
          getMediaItem: this.mediaModule.getMediaItem,
          logIdentifier: 'RemoveASRRequestCommand undo',
        })

        if (!rebuildResult.success) {
          throw new Error(`重建 ASR request 投影失败: ${rebuildResult.error}`)
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

      console.log(`✅ 已恢复 ASR request 投影: ${this.requestId}`)
    } catch (error) {
      console.error(`❌ 恢复 ASR request 投影失败: ${this.requestId}`, error)
      throw error
    }
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    console.log(`🗑️ [RemoveASRRequestCommand] 命令资源已清理: ${this.id}`)
  }

  private getCurrentProjectionItems(): UnifiedTimelineItemData<MediaType>[] {
    return this.getTimelineItems()
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
