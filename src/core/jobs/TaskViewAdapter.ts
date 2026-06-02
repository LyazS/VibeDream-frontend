import type { ResourceNode, ResourceStatus } from './ResourceTypes'

/**
 * 任务中心展示层的数据结构。
 *
 * TaskView 是 Resource DAG 的 UI 投影，不是执行真相。真正状态仍以 ResourceNode
 * 为准，UI 操作 cancel/retry 时也应该回到 JobRuntime。
 */
export interface TaskView {
  id: string
  title: string
  status: ResourceStatus
  progress?: number
  message?: string
  rootResourceId: string
  childResourceIds: string[]
  actions: {
    canCancel: boolean
    canRevealSource: boolean
  }
}

/**
 * 将单个 ResourceNode 包装成 TaskView。
 *
 * childResourceIds 由调用方传入，因为单节点本身只知道直接 deps，不知道 UI 想展示
 * 几层子图。MVP 默认把整条依赖子图收集出来。
 */
export function createTaskView(node: ResourceNode, childResourceIds: string[] = []): TaskView {
  return {
    id: node.id,
    title: node.message || node.stage || `${node.type}:${node.key}`,
    status: node.status,
    progress: node.progress,
    message: node.message,
    rootResourceId: node.id,
    childResourceIds,
    actions: {
      canCancel: node.status === 'queued' || node.status === 'running',
      // 来源定位依赖后续 bindings 设计，MVP 固定为 false。
      canRevealSource: false,
    },
  }
}

/**
 * 从一组 ResourceNode 生成任务中心列表。
 *
 * 当前 root 选择规则：
 * - 没有 dependents 的节点视为业务入口 root。
 */
export function createTaskViews(nodes: ResourceNode[]): TaskView[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  return nodes
    .filter((node) => node.dependents.length === 0)
    .map((node) => {
      const childResourceIds = collectDependencies(node, nodeById)
      return createTaskView(node, childResourceIds)
    })
}

/** 深度收集依赖子图，供 UI 展开 root 任务查看子步骤。 */
function collectDependencies(root: ResourceNode, nodeById: Map<string, ResourceNode>): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const stack = [...root.deps]

  while (stack.length > 0) {
    const id = stack.pop()
    if (!id || visited.has(id)) continue

    visited.add(id)
    result.push(id)

    const node = nodeById.get(id)
    if (node) {
      // 用 visited 防止错误 resolver 产生环时导致无限遍历。
      stack.push(...node.deps)
    }
  }

  return result
}
