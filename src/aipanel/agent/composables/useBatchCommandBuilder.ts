/**
 * 批量命令构建器 - 组合式API版本
 * 将操作配置转换为具体命令，专注于命令构建，不负责执行
 */

import { useUnifiedStore } from '@/core/unifiedStore'

// 导入共享类型定义
import type {
  OperationConfig,
  BuildOperationResult,
  BuildResult,
} from './core/types'

// 导入命令工厂
import { CommandFactory } from './core/CommandFactory'

/**
 * 批量命令构建器组合式函数
 * 提供批量操作配置到命令的转换功能
 */
export function useBatchCommandBuilder() {
  // 使用统一存储
  const unifiedStore = useUnifiedStore()

  // 创建命令工厂实例
  const commandFactory = new CommandFactory()

  /**
   * 构建批量操作命令
   * 注意：此方法现在是异步的，以支持 addTimelineItem 中的 pending 状态等待
   */
  async function buildOperations(operations: OperationConfig[]): Promise<BuildResult> {
    const batchBuilder = unifiedStore.startBatch('用户脚本批量操作')
    const buildResults: BuildOperationResult[] = []

    for (const op of operations) {
      try {
        const command = await commandFactory.createCommand(op)
        batchBuilder.addCommand(command)
        buildResults.push({ success: true, operation: op })
      } catch (error: any) {
        buildResults.push({
          success: false,
          operation: op,
          error: error.message,
        })
      }
    }

    return {
      batchCommand: batchBuilder.build(),
      buildResults,
    }
  }

  return {
    buildOperations,
  }
}
