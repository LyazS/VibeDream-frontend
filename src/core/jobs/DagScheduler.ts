import type { ResourceNode, ResourceQueue } from './ResourceTypes'

/**
 * Scheduler 内部保存的待运行任务。
 *
 * Runtime 负责判断依赖是否满足；Scheduler 只处理“这个节点什么时候获得并发名额运行”。
 */
interface ScheduledTask<TResult = unknown> {
  id: string
  node: ResourceNode
  priority: number
  run: () => Promise<TResult>
  resolve: (value: TResult) => void
  reject: (error: unknown) => void
}

export interface DagSchedulerOptions {
  /** 覆盖各队列并发数。未传的队列使用 DEFAULT_CONCURRENCY。 */
  concurrency?: Partial<Record<ResourceQueue, number>>
}

/**
 * MVP 默认并发。
 *
 * local-heavy/export 先保守设置为 1，避免解码、导出这类重任务互相抢资源。
 */
const DEFAULT_CONCURRENCY: Record<ResourceQueue, number> = {
  'ai-remote': 2,
  asr: 2,
  'local-heavy': 1,
  export: 1,
  background: 2,
}

/**
 * 简单 DAG 调度器。
 *
 * 它不理解 DAG 依赖，只理解队列、优先级和并发。依赖是否成功由 JobRuntime
 * 在 enqueue 前保证。这样 Scheduler 可以保持纯粹，后续替换成更复杂实现也容易。
 */
export class DagScheduler {
  private concurrency: Record<ResourceQueue, number>
  private running = new Map<ResourceQueue, number>()
  private queues = new Map<ResourceQueue, ScheduledTask[]>()

  constructor(options: DagSchedulerOptions = {}) {
    this.concurrency = {
      ...DEFAULT_CONCURRENCY,
      ...options.concurrency,
    }

    for (const queue of Object.keys(DEFAULT_CONCURRENCY) as ResourceQueue[]) {
      this.running.set(queue, 0)
      this.queues.set(queue, [])
    }
  }

  /**
   * 将一个已满足依赖的节点放入对应队列。
   *
   * 返回的 Promise 会在 run() 完成/失败时完成/失败。Runtime 借此更新节点终态。
   */
  enqueue<TResult>(node: ResourceNode, run: () => Promise<TResult>): Promise<TResult> {
    const queue = this.getQueue(node)
    const priority = node.policy.priority ?? 0

    return new Promise<TResult>((resolve, reject) => {
      const task: ScheduledTask<TResult> = {
        id: node.id,
        node,
        priority,
        run,
        resolve,
        reject,
      }

      const tasks = this.queues.get(queue)
      if (!tasks) {
        reject(new Error(`Unknown resource queue: ${queue}`))
        return
      }

      tasks.push(task as ScheduledTask)
      // 队列内按 priority 降序排列。MVP 不做运行中抢占，只影响尚未开始的任务。
      tasks.sort((a, b) => b.priority - a.priority)
      this.drain(queue)
    })
  }

  /**
   * 取消尚未开始执行的任务。
   *
   * 已经 running 的任务无法由 Scheduler 中断；Runtime 会通过 AbortController
   * 通知 resolver 自行停止。
   */
  cancelQueued(resourceId: string): boolean {
    let cancelled = false

    for (const [queue, tasks] of this.queues) {
      const kept = tasks.filter((task) => {
        if (task.id !== resourceId) return true
        task.reject(new DOMException('Resource cancelled before execution', 'AbortError'))
        cancelled = true
        return false
      })

      if (kept.length !== tasks.length) {
        this.queues.set(queue, kept)
      }
    }

    return cancelled
  }

  /** 调试/任务中心可用：查看某队列等待中的任务数量。 */
  getQueueSize(queue: ResourceQueue): number {
    return this.queues.get(queue)?.length ?? 0
  }

  /** 调试/任务中心可用：查看某队列正在运行的任务数量。 */
  getRunningCount(queue: ResourceQueue): number {
    return this.running.get(queue) ?? 0
  }

  /**
   * 尽可能从队列中取任务执行，直到达到并发上限。
   *
   * 每个任务结束后会递归 drain，保证后续排队任务能继续被调度。
   */
  private drain(queue: ResourceQueue): void {
    const tasks = this.queues.get(queue)
    if (!tasks) return

    while ((this.running.get(queue) ?? 0) < this.concurrency[queue] && tasks.length > 0) {
      const task = tasks.shift()
      if (!task) return

      this.running.set(queue, (this.running.get(queue) ?? 0) + 1)

      void task
        .run()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.running.set(queue, Math.max(0, (this.running.get(queue) ?? 1) - 1))
          this.drain(queue)
        })
    }
  }

  /** 未指定 queue 的资源默认走 background，避免 resolver 必须填 policy。 */
  private getQueue(node: ResourceNode): ResourceQueue {
    return node.policy.queue ?? 'background'
  }
}
