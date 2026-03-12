/**
 * 配置验证器 - 验证操作配置的合法性
 * 确保所有操作参数符合系统要求
 */

import type { BaseOperationConfig, ValidationError } from './types'

export class ConfigValidator {
  /**
   * 验证操作配置数组
   */
  validateOperations(operations: BaseOperationConfig[]): ValidationError[] {
    const errors: ValidationError[] = []

    for (const op of operations) {
      try {
        this.validateSingleOperation(op)
      } catch (error: any) {
        errors.push({ operation: op, error: error.message })
      }
    }

    return errors
  }

  /**
   * 验证单个操作
   */
  private validateSingleOperation(op: BaseOperationConfig) {
    if (!op.type || typeof op.type !== 'string') {
      throw new Error('操作类型不能为空且必须是字符串')
    }

    if (!op.params || typeof op.params !== 'object') {
      throw new Error('操作参数不能为空且必须是对象')
    }

    switch (op.type) {
      case 'addTimelineItem':
        this.validateAddTimelineItem(op.params)
        break
      default:
        throw new Error(`不支持的操作类型: ${op.type}`)
    }
  }

  /**
   * 验证时间码格式 (HH:MM:SS.FF)
   */
  private validateTimecode(timecode: string): void {
    if (typeof timecode !== 'string') {
      throw new Error('时间码必须是字符串')
    }

    const timecodeRegex = /^(\d{2}):(\d{2}):(\d{2})\.(\d{2})$/
    if (!timecodeRegex.test(timecode)) {
      throw new Error(`无效的时间码格式: ${timecode}，应为 HH:MM:SS.FF 格式`)
    }

    const [, hours, minutes, seconds, frames] = timecode.match(timecodeRegex)!
    const h = parseInt(hours, 10)
    const m = parseInt(minutes, 10)
    const s = parseInt(seconds, 10)

    if (h < 0 || m < 0 || m > 59 || s < 0 || s > 59) {
      throw new Error(`无效的时间码值: ${timecode}`)
    }
  }

  /**
   * 验证时间轴项目数据
   */
  private validateAddTimelineItem(params: any): void {
    if (!params.mediaItemId || typeof params.mediaItemId !== 'string') {
      throw new Error('mediaItemId 不能为空且必须是字符串')
    }

    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (!params.position || typeof params.position !== 'string') {
      throw new Error('position 不能为空且必须是字符串')
    }

    this.validateTimecode(params.position)
  }
}
