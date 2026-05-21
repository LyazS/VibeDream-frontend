import { JobLogger } from './JobLogger'
import type { ResourceNode } from './ResourceTypes'

export type ScheduledJob = () => Promise<void>

interface QueueItem {
  node: ResourceNode
  job: ScheduledJob
  priority: number
  sequence: number
}

export class DagScheduler {
  private queue: QueueItem[] = []
  private running = 0
  private sequence = 0

  constructor(private readonly maxConcurrent = 4) {}

  enqueue(node: ResourceNode, job: ScheduledJob): void {
    this.queue.push({
      node,
      job,
      priority: node.policy.priority ?? 0,
      sequence: this.sequence++,
    })

    JobLogger.info('DagScheduler', 'scheduler:queued', {
      ...JobLogger.forNode(node),
      queue: node.policy.queue,
    })

    this.drain()
  }

  getQueuedCount(): number {
    return this.queue.length
  }

  getRunningCount(): number {
    return this.running
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)
      const item = this.queue.shift()
      if (!item) return

      this.running++
      void this.runItem(item)
    }
  }

  private async runItem(item: QueueItem): Promise<void> {
    JobLogger.info('DagScheduler', 'scheduler:run', {
      ...JobLogger.forNode(item.node),
      queue: item.node.policy.queue,
    })

    try {
      await item.job()
    } finally {
      this.running--
      this.drain()
    }
  }
}
