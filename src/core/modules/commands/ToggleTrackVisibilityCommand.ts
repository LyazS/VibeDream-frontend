import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'

/**
 * 切换轨道可见性命令
 * 支持切换轨道可见性的撤销/重做操作
 * 同时同步该轨道上所有时间轴项目的sprite可见性
 */
export class ToggleTrackVisibilityCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private previousVisibility: boolean // 保存切换前的可见性状态
  private targetVisibility?: boolean // 外部指定的目标可见性状态
  private _isDisposed = false

  constructor(
    private trackId: string,
    private trackModule: {
      getTrack: (trackId: string) => UnifiedTrackData | undefined
      toggleTrackVisibility: (trackId: string, targetVisibleState?: boolean) => Promise<void>
    },
    targetVisibility?: boolean, // 外部传入的可见性设置（可选）
  ) {
    this.id = generateCommandId()

    // 获取轨道信息
    const track = this.trackModule.getTrack(trackId)
    if (!track) {
      throw new Error(`找不到轨道: ${trackId}`)
    }

    this.previousVisibility = track.isVisible
    this.targetVisibility = targetVisibility

    // 确定最终的目标状态：如果有外部指定则使用，否则切换当前状态
    const finalTargetState = targetVisibility !== undefined ? targetVisibility : !track.isVisible
    this.description = `${finalTargetState ? '显示' : '隐藏'}轨道: ${track.name}`

    console.log(
      `📋 准备切换轨道可见性: ${track.name}, 当前状态: ${track.isVisible ? '可见' : '隐藏'}, 目标状态: ${finalTargetState ? '可见' : '隐藏'}`,
    )
  }

  /**
   * 执行命令：切换轨道可见性
   */
  async execute(): Promise<void> {
    try {
      const track = this.trackModule.getTrack(this.trackId)
      if (!track) {
        throw new Error(`轨道不存在: ${this.trackId}`)
      }

      console.log(`🔄 执行切换轨道可见性操作: ${track.name}...`)

      // 始终使用确定性的目标状态（即使未外部传入，也在构造函数中确定了切换后的状态）
      const targetState =
        this.targetVisibility !== undefined ? this.targetVisibility : !this.previousVisibility

      await this.trackModule.toggleTrackVisibility(this.trackId, targetState)

      const newVisibility = track.isVisible
      console.log(`✅ 已切换轨道可见性: ${track.name}, 新状态: ${newVisibility ? '可见' : '隐藏'}`)
    } catch (error) {
      const track = this.trackModule.getTrack(this.trackId)
      console.error(`❌ 切换轨道可见性失败: ${track?.name || `轨道 ${this.trackId}`}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：恢复轨道的原始可见性状态
   */
  async undo(): Promise<void> {
    try {
      const track = this.trackModule.getTrack(this.trackId)
      if (!track) {
        throw new Error(`轨道不存在: ${this.trackId}`)
      }

      console.log(`🔄 撤销切换轨道可见性操作：恢复轨道 ${track.name} 的原始状态...`)

      // 如果当前状态与原始状态不同，则再次切换
      if (track.isVisible !== this.previousVisibility) {
        // 撤销时始终使用原始状态作为目标状态，确保完全恢复
        await this.trackModule.toggleTrackVisibility(this.trackId, this.previousVisibility)
      }

      console.log(
        `↩️ 已撤销切换轨道可见性: ${track.name}, 恢复状态: ${this.previousVisibility ? '可见' : '隐藏'}`,
      )
    } catch (error) {
      const track = this.trackModule.getTrack(this.trackId)
      console.error(`❌ 撤销切换轨道可见性失败: ${track?.name || `轨道 ${this.trackId}`}`, error)
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
    console.log(`🗑️ [ToggleTrackVisibilityCommand] 命令资源已清理: ${this.id}`)
  }
}
