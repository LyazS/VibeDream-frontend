/**
 * 命令模式接口定义
 * 用于实现撤销/重做功能的统一命令接口
 */
export interface SimpleCommand {
  /** 命令的唯一标识符 */
  readonly id: string

  /** 命令的描述信息，用于显示在历史记录中 */
  readonly description: string

  /** 执行命令 */
  execute(): Promise<void>

  /** 撤销命令 */
  undo(): Promise<void>

  /** 检查命令是否已被清理 */
  readonly isDisposed: boolean

  /** 清理命令持有的资源 */
  dispose(): void
}
