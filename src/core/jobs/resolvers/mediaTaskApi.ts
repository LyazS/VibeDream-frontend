import {
  cloudflareTaskProgressClient,
  type TaskProgressSubscription,
  type TaskProgressUpdate,
} from '@/core/utils/cloudflareTaskProgressClient'
import { fetchClient } from '@/utils/fetchClient'

const TASK_PROGRESS_ORIGIN_TAB_ID_KEY = 'lightcut.task-progress.origin-tab-id'

interface MediaTaskResultResponse<TResult> {
  task_id: string
  result: TResult
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

export function getTaskProgressOriginTabId(): string {
  // sessionStorage 使每个编辑器标签页有独立 ID；刷新同一标签页时仍能认领自己的任务结果。
  const sessionStorage = storage()
  const existing = sessionStorage?.getItem(TASK_PROGRESS_ORIGIN_TAB_ID_KEY)
  if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing
  const value = randomId('tab-')
  sessionStorage?.setItem(TASK_PROGRESS_ORIGIN_TAB_ID_KEY, value)
  return value
}

export function createMediaTaskIdempotencyKey(capability: string): string {
  // 取消、提交等可重试写操作都带独立 key，Worker 用它防止网络重试重复扣费或重复建任务。
  return randomId(`media-${capability}-`)
}

export async function submitMediaTask<TTask, TInput>(
  capability: string,
  input: TInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<TTask> {
  // capability 是 API 路径的一部分；具体任务模型由调用方泛型提供，避免为每种能力复制 HTTP 客户端。
  const response = await fetchClient.post<TTask>(
    `/api/media/tasks/${encodeURIComponent(capability)}`,
    input,
    {
      signal,
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )
  return response.data
}

export async function getMediaTaskResult<TResult>(
  taskId: string,
  signal?: AbortSignal,
): Promise<TResult> {
  const response = await fetchClient.get<MediaTaskResultResponse<TResult>>(
    `/api/media/tasks/${encodeURIComponent(taskId)}/result`,
    { signal },
  )
  // 对 task_id 再校验一次，避免代理或错误响应被错误写回当前编辑器项目。
  if (response.data.task_id !== taskId) throw new Error('任务结果与请求任务不一致')
  return response.data.result
}

export async function cancelMediaTask(taskId: string, capability = 'task'): Promise<void> {
  await fetchClient.post(
    `/api/media/tasks/${encodeURIComponent(taskId)}/cancel`,
    {},
    {
      headers: { 'Idempotency-Key': createMediaTaskIdempotencyKey(capability) },
    },
  )
}

export function subscribeToMediaTask<TTask extends TaskProgressUpdate>(
  taskId: string,
  originTabId: string,
  isExpectedTask: (task: TaskProgressUpdate) => task is TTask,
): TaskProgressSubscription<TTask> {
  // 共享客户端只保证通用任务字段；能力自己的 guard 负责确认 capability、状态枚举和扩展字段。
  const subscription = cloudflareTaskProgressClient.subscribe(taskId, originTabId)
  return {
    close: () => subscription.close(),
    async next(signal) {
      const task = await subscription.next(signal)
      if (!isExpectedTask(task)) throw new Error('任务进度消息格式无效')
      return task
    },
  }
}
