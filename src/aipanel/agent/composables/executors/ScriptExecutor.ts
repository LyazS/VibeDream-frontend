/**
 * 脚本执行器 - 在沙箱环境中执行用户JS代码
 * 负责将用户函数调用转换为操作配置
 *
 * 设计为一次性使用，执行完成后自动清理资源
 */
import type { LogMessage, ScriptExecutionResult } from '../core/types'

export class ScriptExecutor {
  private worker: Worker | null = null

  constructor() {
    // 立即初始化worker，避免延迟
    this.initializeWorker()
  }

  /**
   * 初始化Web Worker
   */
  private initializeWorker(): void {
    if (this.worker) {
      this.worker.terminate()
    }

    // 创建Worker实例
    const workerUrl = new URL('./ScriptExecutor.worker.ts', import.meta.url)
    this.worker = new Worker(workerUrl, { type: 'module' })
  }

  /**
   * 执行用户代码并生成操作配置 - 执行并验证配置
   * @param script 用户JavaScript代码
   * @param timeout 超时时间（毫秒）
   * @returns 验证通过的操作配置数组
   */
  async executeScript(script: string, timeout: number = 5000): Promise<ScriptExecutionResult> {
    if (!this.worker) {
      throw new Error('Worker未初始化')
    }

    return new Promise((resolve) => {
      let timeoutId: number
      let isResolved = false

      // 设置超时处理
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true
          this.cleanup()
          resolve({
            success: false,
            error: `执行超时(${timeout}ms)`,
          })
        }
      }, timeout)

      // 设置一次性消息处理
      const messageHandler = (event: MessageEvent) => {
        if (isResolved) return

        isResolved = true
        clearTimeout(timeoutId)

        const { success, operations, error, stack, logs } = event.data

        // 无论成功与否都返回resolve，提供完整信息给外层处理
        const resultOperations = operations || []
        const executionLogs: LogMessage[] = logs || []

        resolve({
          success: success,
          operations: resultOperations,
          error: error,
          stack: stack,
          logs: executionLogs,
        })

        // 自动清理资源
        this.cleanup()
      }

      // 再次检查 worker 状态
      if (!this.worker) {
        resolve({
          success: false,
          error: 'Worker在执行过程中被释放',
        })
        return
      }

      this.worker.addEventListener('message', messageHandler, { once: true })
      this.worker.addEventListener(
        'error',
        (error) => {
          if (!isResolved) {
            isResolved = true
            clearTimeout(timeoutId)
            resolve({
              success: false,
              error: `Worker错误: ${error.message}`,
            })
            this.cleanup()
          }
        },
        { once: true },
      )

      // 发送执行请求
      this.worker.postMessage({
        script: script,
      })
    })
  }

  /**
   * 清理资源 - 终止worker并释放内存
   */
  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * 析构函数 - 确保资源被清理
   */
  destroy(): void {
    this.cleanup()
  }
}
