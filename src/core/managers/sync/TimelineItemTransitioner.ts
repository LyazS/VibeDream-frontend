/**
 * 时间轴项目状态转换器
 * 负责将时间轴项目从 loading 状态转换为 ready 状态
 *
 * 职责：
 * - 更新时间轴项目尺寸
 * - 创建和配置 Sprite
 * - 应用动画配置
 * - 设置轨道属性
 * - 初始化双向同步
 */

import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { MediaItemQueries } from '@/core/mediaitem'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { TimelineItemMutations } from '@/core/timelineitem/mutations'
import { useUnifiedStore } from '@/core/unifiedStore'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'

export interface TransitionOptions {
  commandId?: string
  description?: string
}
/**
 * 时间轴项目状态转换器（不支持文本类型）
 */
export class TimelineItemTransitioner {
  constructor(
    private timelineItemId: string,
    private mediaItem: UnifiedMediaItemData,
  ) {}

  /**
   * 转换时间轴项目为 ready 状态（支持文本类型）
   */
  async transitionToReady(options: TransitionOptions): Promise<void> {
    const { commandId, description } = options
    const unifiedStore = useUnifiedStore()
    const timelineItem = unifiedStore.getTimelineItem(this.timelineItemId)

    if (!timelineItem) {
      console.log(
        `⚠️ [TimelineItemTransitioner] 找不到时间轴项目: ${this.timelineItemId}，跳过状态转换`,
      )
      return
    }

    console.log(`🎨 [TimelineItemTransitioner] 开始转换时间轴项目状态: ${this.timelineItemId}`, {
      isInitialized: timelineItem.runtime.isInitialized,
      commandId,
      mediaType: this.mediaItem.mediaType,
    })

    if (timelineItem.timelineStatus !== 'loading') {
      console.log(
        `⏭️ [TimelineItemTransitioner] 跳过状态转换，时间轴项目状态不是loading: ${this.timelineItemId}`,
        {
          currentStatus: timelineItem.timelineStatus,
          isInitialized: timelineItem.runtime.isInitialized,
          commandId,
        },
      )
      return
    }

    // 检查是否为文本类型
    if (TimelineItemQueries.isTextTimelineItem(timelineItem)) {
      // 不应该出现文本类型的
      console.warn(
        `⚠️ [TimelineItemTransitioner] 文本类型时间轴项目不需要状态转换: ${this.timelineItemId}`,
      )
    } else {
      // 媒体类型的状态转换
      // 🔧 直接检查 isInitialized，而不是使用 shouldUpdateTimelineItem
      // 只有未初始化的项目才需要从媒体项目同步数据
      if (!timelineItem.runtime.isInitialized) {
        this.updateTimelineItem(timelineItem)
      }

      await setupTimelineItemBunny(timelineItem, this.mediaItem)
    }

    // 通用的后续处理
    timelineItem.timelineStatus = 'ready'

    // ✅ 完成初始化后，标记为已初始化
    timelineItem.runtime.isInitialized = true
    unifiedStore.refreshTransitionItems()

    console.log(`🎉 [TimelineItemTransitioner] 时间轴项目状态转换完成: ${this.timelineItemId}`)
  }

  /**
   * 更新时间轴项目的尺寸信息
   */
  private updateTimelineItem(timelineItem: UnifiedTimelineItemData): void {
    // 更新timeRange - 使用媒体项目的duration
    if (this.mediaItem.duration && timelineItem.timeRange) {
      const duration = this.mediaItem.duration
      const startTime = timelineItem.timeRange.timelineStartTime

      // 更新时间范围，保持开始时间不变，更新结束时间
      TimelineItemFactory.setTimeRange(timelineItem, {
        ...timelineItem.timeRange,
        timelineEndTime: startTime + duration,
        clipStartTime: 0,
        clipEndTime: duration,
      })
    }

    // 获取媒体的原始尺寸
    const originalSize = MediaItemQueries.getOriginalSize(this.mediaItem)

    // 更新config中的宽高 - 仅对视频和图片类型，并且有原始尺寸时才更新
    if (
      originalSize &&
      (TimelineItemQueries.isVideoTimelineItem(timelineItem) ||
        TimelineItemQueries.isImageTimelineItem(timelineItem))
    ) {
      TimelineItemMutations.patchBaseVisualConfig(timelineItem, {
        width: originalSize.width,
        height: originalSize.height,
      })
    } else if (!originalSize) {
      console.warn(`⚠️ [TimelineItemTransitioner] 无法获取媒体原始尺寸: ${this.mediaItem.id}`)
    }
  }
}
