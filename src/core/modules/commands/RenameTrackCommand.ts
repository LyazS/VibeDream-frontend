import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'

/**
 * 重命名轨道命令
 * 支持重命名轨道的撤销/重做操作
 * 采用简单的名称修改逻辑
 */
export class RenameTrackCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private oldName: string = '' // 保存原始名称用于撤销
  private _isDisposed = false

  constructor(
    private trackId: string,
    private newName: string,
    private trackModule: {
      renameTrack: (trackId: string, newName: string) => void
      getTrack: (trackId: string) => UnifiedTrackData | undefined
    },
  ) {
    this.id = generateCommandId()
    this.description = `重命名轨道: ${newName}`

    // 获取当前轨道名称用于撤销
    const track = this.trackModule.getTrack(trackId)
    this.oldName = track?.name || ''
  }

  /**
   * 执行命令：重命名轨道
   */
  async execute(): Promise<void> {
    try {
      console.log(`🔄 执行重命名轨道操作: ${this.oldName} -> ${this.newName}...`)

      // 检查轨道是否存在
      const track = this.trackModule.getTrack(this.trackId)
      if (!track) {
        throw new Error(`轨道不存在: ${this.trackId}`)
      }

      // 检查新名称是否有效
      if (!this.newName.trim()) {
        throw new Error('轨道名称不能为空')
      }

      // 调用trackModule的renameTrack方法
      this.trackModule.renameTrack(this.trackId, this.newName)

      console.log(`✅ 已重命名轨道: ${this.oldName} -> ${this.newName}`)
    } catch (error) {
      console.error(`❌ 重命名轨道失败: ${this.oldName} -> ${this.newName}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：恢复原始轨道名称
   */
  async undo(): Promise<void> {
    try {
      console.log(`🔄 撤销重命名轨道操作：恢复名称 ${this.newName} -> ${this.oldName}...`)

      // 检查轨道是否存在
      const track = this.trackModule.getTrack(this.trackId)
      if (!track) {
        throw new Error(`轨道不存在: ${this.trackId}`)
      }

      // 恢复原始名称
      this.trackModule.renameTrack(this.trackId, this.oldName)

      console.log(`↩️ 已撤销重命名轨道: ${this.newName} -> ${this.oldName}`)
    } catch (error) {
      console.error(`❌ 撤销重命名轨道失败: ${this.newName} -> ${this.oldName}`, error)
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
    console.log(`🗑️ [RenameTrackCommand] 命令资源已清理: ${this.id}`)
  }
}
