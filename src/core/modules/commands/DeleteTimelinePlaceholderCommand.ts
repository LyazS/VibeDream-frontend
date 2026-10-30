import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { generateCommandId } from '@/core/utils/idGenerator'

export class DeleteTimelinePlaceholderCommand implements SimpleCommand {
  readonly id = generateCommandId()
  readonly historyLabel = { key: 'notification.history.command.deleteTimelineItems' as const }
  private snapshot: UnifiedTimelineItemData | null
  private disposed = false

  constructor(
    item: UnifiedTimelineItemData,
    private readonly module: {
      getTimelineItem(id: string): UnifiedTimelineItemData | undefined
      addTimelineItem(item: UnifiedTimelineItemData): Promise<void>
      removeTimelineItem(id: string): Promise<void>
      onRestore?(item: UnifiedTimelineItemData): Promise<void>
    },
  ) {
    this.snapshot = TimelineItemFactory.clone(item)
  }

  async execute(): Promise<void> {
    if (!this.snapshot) return
    const item = this.module.getTimelineItem(this.snapshot.id)
    if (!item) return
    await this.module.removeTimelineItem(item.id)
  }

  async undo(): Promise<void> {
    if (this.snapshot && !this.module.getTimelineItem(this.snapshot.id)) {
      const restored = TimelineItemFactory.clone(this.snapshot)
      await this.module.addTimelineItem(restored)
      if (this.module.onRestore) {
        void this.module.onRestore(restored).catch((error) => {
          console.error('恢复字幕占位符失败', error)
        })
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.snapshot = null
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}
