import { BaseBatchCommand } from '@/core/modules/UnifiedHistoryModule'
import type { SimpleCommand } from '@/core/modules/commands/types'

export class BatchSetAnimationGroupValuesCommand extends BaseBatchCommand {
  constructor(targetItemIds: string[], updateCommands: SimpleCommand[]) {
    super(`批量修改 ${targetItemIds.length} 个项目的动画组`)
    updateCommands.forEach((command) => this.addCommand(command))
  }
}
