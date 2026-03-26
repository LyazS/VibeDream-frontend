import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type {
  KeyframeSnapshot,
  TimelineModule,
} from '@/core/modules/commands/keyframes/shared'
import {
  createSnapshot,
  applyKeyframeSnapshot,
} from '@/core/modules/commands/keyframes/shared'
import { handlePropertyChange } from '@/core/utils/unifiedKeyframeUtils'

interface ToggleProportionalScaleOptions extends TimelineModule {
  getMediaItem: (id: string | null) => any
}

/**
 * 切换等比缩放命令
 * 支持切换时间轴项目等比缩放状态的撤销/重做操作
 * 当开启等比缩放时，会同步 Y 缩放到 X 缩放值
 */
export class ToggleProportionalScaleCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshot: KeyframeSnapshot
  private afterSnapshot: KeyframeSnapshot | null = null
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private frame: number,
    private module: ToggleProportionalScaleOptions,
  ) {
    this.id = generateCommandId()

    // 获取时间轴项目
    const item = this.module.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    if (!TimelineItemQueries.hasVisualProperties(item)) {
      throw new Error(`时间轴项目不支持视觉属性: ${this.timelineItemId}`)
    }

    // 保存切换前的状态快照
    this.beforeSnapshot = createSnapshot(item)

    const currentState = item.config.proportionalScale
    const newState = !currentState
    this.description = `${newState ? '开启' : '关闭'}等比缩放`

    console.log(
      `📋 准备切换等比缩放: ${this.timelineItemId}, 当前状态: ${currentState ? '开启' : '关闭'}, 目标状态: ${newState ? '开启' : '关闭'}`,
    )
  }

  /**
   * 获取原始尺寸
   */
  private getOriginalDimensions(item: UnifiedTimelineItemData<MediaType>): { width: number; height: number } {
    if (!TimelineItemQueries.hasVisualProperties(item)) {
      return { width: 0, height: 0 }
    }

    const config = TimelineItemQueries.getRenderConfig(item)

    // 文本类型：从 textBitmap 获取原始尺寸
    if (TimelineItemQueries.isTextTimelineItem(item)) {
      const textBitmap = item.runtime.textBitmap
      return {
        width: textBitmap?.width ?? config.width,
        height: textBitmap?.height ?? config.height,
      }
    }

    // 其他类型：从 mediaItem 的 bunny 对象获取原始尺寸
    const mediaItem = this.module.getMediaItem(item.mediaItemId)
    return {
      width: mediaItem?.runtime.bunny?.originalWidth ?? config.width,
      height: mediaItem?.runtime.bunny?.originalHeight ?? config.height,
    }
  }

  /**
   * 执行命令：切换等比缩放状态
   */
  async execute(): Promise<void> {
    const item = this.module.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    if (!TimelineItemQueries.hasVisualProperties(item)) {
      throw new Error(`时间轴项目不支持视觉属性: ${this.timelineItemId}`)
    }

    try {
      console.log(`🔄 执行切换等比缩放操作: ${this.timelineItemId}...`)

      const currentState = item.config.proportionalScale
      const newState = !currentState

      // 更新 proportionalScale 属性
      await handlePropertyChange(item, this.frame, 'proportionalScale', newState)

      // 如果刚刚开启等比缩放，使用当前 X 缩放值作为统一缩放值，同时更新 Y 缩放
      if (newState && currentState === false) {
        const config = item.config

        // 使用统一的获取原始尺寸方法
        const { width: originalWidth, height: originalHeight } = this.getOriginalDimensions(item)

        // 计算当前 X 缩放比例
        const currentScaleX = config.width / originalWidth

        // 使用 X 缩放比例设置新的高度（保持等比）
        const newHeight = originalHeight * currentScaleX

        console.log(
          `🔄 开启等比缩放，同步 Y 缩放: 原始尺寸=${originalWidth}x${originalHeight}, 当前宽度=${config.width}, 新高度=${newHeight}`,
        )

        // 更新高度属性
        await handlePropertyChange(item, this.frame, 'height', newHeight)
      }

      // 保存执行后的状态快照
      this.afterSnapshot = createSnapshot(item)

      const finalState = item.config.proportionalScale
      console.log(`✅ 已切换等比缩放: ${this.timelineItemId}, 新状态: ${finalState ? '开启' : '关闭'}`)
    } catch (error) {
      console.error(`❌ 切换等比缩放失败: ${this.timelineItemId}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：恢复到切换前的状态
   */
  async undo(): Promise<void> {
    const item = this.module.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    try {
      console.log(`🔄 撤销切换等比缩放操作：恢复 ${this.timelineItemId} 的原始状态...`)

      await applyKeyframeSnapshot(item, this.beforeSnapshot)
      const restoredState =
        'proportionalScale' in this.beforeSnapshot.itemProperties &&
        this.beforeSnapshot.itemProperties.proportionalScale

      console.log(
        `↩️ 已撤销切换等比缩放: ${this.timelineItemId}, 恢复状态: ${restoredState ? '开启' : '关闭'}`,
      )
    } catch (error) {
      console.error(`❌ 撤销切换等比缩放失败: ${this.timelineItemId}`, error)
      throw error
    }
  }

  /**
   * 检查命令是否已被清理
   */
  get isDisposed(): boolean {
    return this._isDisposed
  }

  /**
   * 清理命令持有的资源
   */
  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    console.log(`🗑️ [ToggleProportionalScaleCommand] 命令资源已清理: ${this.id}`)
  }
}
