import {
  cloudflareTaskProgressClient,
  type TaskProgressSubscription,
  type TaskProgressUpdate,
} from '@/core/utils/cloudflareTaskProgressClient'
import { fetchClient } from '@/utils/fetchClient'
import { ApiCapabilityDisabledError, enabledApiCapabilities } from '@/config/apiCapabilities'
import type { AiTaskType } from './types'

export type { AiTaskType } from './types'

const AI_TASK_STATUSES = [
  'pending',
  'processing',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'input_expired',
] as const

export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number]

interface AiTaskResultResponse<TResult> {
  task_id: string
  result: TResult
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`
}

export function createAiTaskIdempotencyKey(purpose: string): string {
  // 取消、提交等可重试写操作都带独立 key，Worker 用它防止网络重试重复扣费或重复建任务。
  return randomId(`ai-${purpose}-`)
}

export async function submitAiTask<TTask, TInput extends object>(
  type: AiTaskType,
  input: TInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<TTask> {
  if (!enabledApiCapabilities.has(type)) {
    throw new ApiCapabilityDisabledError('/api/ai/tasks', type)
  }
  const response = await fetchClient.post<TTask>(
    '/api/ai/tasks',
    { ...input, type },
    {
      signal,
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )
  return response.data
}

export async function getAiTaskResult<TResult>(
  taskId: string,
  signal?: AbortSignal,
): Promise<TResult> {
  const response = await fetchClient.get<AiTaskResultResponse<TResult>>(
    `/api/ai/tasks/${encodeURIComponent(taskId)}/result`,
    { signal },
  )
  // 对 task_id 再校验一次，避免代理或错误响应被错误写回当前编辑器项目。
  if (response.data.task_id !== taskId) throw new Error('任务结果与请求任务不一致')
  return response.data.result
}

export async function cancelAiTask(taskId: string, purpose = 'task'): Promise<void> {
  await fetchClient.post(
    `/api/ai/tasks/${encodeURIComponent(taskId)}/cancel`,
    {},
    {
      headers: { 'Idempotency-Key': createAiTaskIdempotencyKey(purpose) },
    },
  )
}

export function subscribeToAiTask<TTask extends TaskProgressUpdate>(
  taskId: string,
  isExpectedTask: (task: TaskProgressUpdate) => task is TTask,
): TaskProgressSubscription<TTask> {
  // 任务自己的 guard 确认类型、状态枚举和扩展字段。
  const subscription = cloudflareTaskProgressClient.subscribe(taskId)
  return {
    close: () => subscription.close(),
    async next(signal) {
      const task = await subscription.next(signal)
      if (!isExpectedTask(task)) throw new Error('任务进度消息格式无效')
      return task
    },
  }
}

export interface AiTask extends TaskProgressUpdate {
  type: AiTaskType
  status: AiTaskStatus
  error?: string
  message?: string
}

export async function runAiTask<TResult>(
  type: AiTaskType,
  input: unknown,
  options: {
    projectId?: string
    signal?: AbortSignal
    idempotencyKey?: string
    onProgress?: (task: AiTask) => void
  } = {},
): Promise<{ taskId: string; result: TResult }> {
  const task = await submitAiTask<AiTask, { project_id?: string; input: unknown }>(
    type,
    { project_id: options.projectId, input },
    options.idempotencyKey || createAiTaskIdempotencyKey(type),
    options.signal,
  )
  if (!task.task_id || task.type !== type) throw new Error('AI 任务提交响应格式无效')
  const subscription = subscribeToAiTask(
    task.task_id,
    (update): update is AiTask =>
      update.type === type && AI_TASK_STATUSES.includes(update.status as AiTaskStatus),
  )
  const signal = options.signal || new AbortController().signal
  const cancel = () => {
    void cancelAiTask(task.task_id, type).catch((error) =>
      console.warn('取消 AI 任务失败', task.task_id, error),
    )
  }
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    while (true) {
      const update = await subscription.next(signal)
      options.onProgress?.(update)
      if (update.status === 'completed')
        return {
          taskId: task.task_id,
          result: await getAiTaskResult<TResult>(task.task_id, signal),
        }
      if (['failed', 'cancelled', 'input_expired'].includes(update.status))
        throw new Error(update.message || update.error || 'AI 任务失败')
    }
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    subscription.close()
  }
}
