import { JobLogger } from './JobLogger'
import type { ResourceNode, ResourceStatus } from './ResourceTypes'

export interface TaskViewItem {
  id: string
  resourceId: string
  title: string
  type: string
  status: ResourceStatus
  progress: number
  stage?: string
  message?: string
  errorMessage?: string
  bindings: string[]
  deps: string[]
  dependents: string[]
  queue?: string
  isRoot: boolean
  createdAt: string
  updatedAt: string
}

function getTaskTitle(node: ResourceNode): string {
  return node.message || `${node.type}:${node.key}`
}

export class TaskViewAdapter {
  toTaskViewItem(node: ResourceNode): TaskViewItem {
    JobLogger.debug('TaskCenter', 'task:view', JobLogger.forNode(node))

    return {
      id: node.id,
      resourceId: node.id,
      title: getTaskTitle(node),
      type: node.type,
      status: node.status,
      progress: node.progress ?? (node.status === 'succeeded' ? 100 : 0),
      stage: node.stage,
      message: node.message,
      errorMessage: node.error?.message,
      bindings: node.bindings.map((binding) => `${binding.type}:${binding.id}`),
      deps: [...node.deps],
      dependents: [...node.dependents],
      queue: node.policy.queue,
      isRoot: node.dependents.length === 0,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }
  }

  toTaskView(nodes: Iterable<ResourceNode>): TaskViewItem[] {
    return Array.from(nodes)
      .map((node) => this.toTaskViewItem(node))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
