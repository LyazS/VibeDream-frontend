import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'

/**
 * 移动轨道命令
 * 支持移动轨道位置的撤销/重做操作
 */
export class MoveTrackCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private trackId: string,
    private fromPosition: number,
    private toPosition: number,
    private trackModule: {
      moveTrack: (trackId: string, newPosition: number) => void
    },
  ) {
    this.id = generateCommandId()
    this.description = `移动轨道: 从位置 ${fromPosition} 到 ${toPosition}`
  }

  /**
   * 执行命令：移动轨道到新位置
   */
  async execute(): Promise<void> {
    try {
      console.log(`🔄 执行移动轨道操作: ${this.trackId} 从 ${this.fromPosition} 到 ${this.toPosition}...`)

      // 调用 trackModule 的 moveTrack 方法
      this.trackModule.moveTrack(this.trackId, this.toPosition)

      console.log(`✅ 已移动轨道: ${this.trackId} 到位置 ${this.toPosition}`)
    } catch (error) {
      console.error(`❌ 移动轨道失败: ${this.trackId}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：将轨道移回原位置
   */
  async undo(): Promise<void> {
    try {
      console.log(`🔄 撤销移动轨道操作：${this.trackId} 从 ${this.toPosition} 回到 ${this.fromPosition}...`)

      // 将轨道移回原位置
      this.trackModule.moveTrack(this.trackId, this.fromPosition)

      console.log(`↩️ 已撤销移动轨道: ${this.trackId} 回到位置 ${this.fromPosition}`)
    } catch (error) {
      console.error(`❌ 撤销移动轨道失败: ${this.trackId}`, error)
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
    console.log(`🗑️ [MoveTrackCommand] 命令资源已清理: ${this.id}`)
  }
}
