import {
  getAiTaskResult,
  subscribeToAiTask,
  submitAiTask,
  createAiTaskIdempotencyKey,
} from '@/core/ai-tasks/taskApi'
import type { TaskProgressUpdate } from '@/core/utils/cloudflareTaskProgressClient'
import type { MediaAsrTask, MediaAsrTaskInput, MediaAsrRawResult } from './types'

function isStatus(value: unknown): value is MediaAsrTask['status'] {
  return (
    typeof value === 'string' &&
    ['pending', 'processing', 'cancelling', 'completed', 'failed', 'cancelled', 'input_expired'].includes(value)
  )
}

export function isMediaAsrTask(task: TaskProgressUpdate): task is MediaAsrTask {
  return task.type === 'media.asr' && isStatus(task.status)
}

export async function createMediaVersion(input: {
  mediaId: string
  createdAt: string
  mediaKind: string
  duration?: number
}): Promise<string> {
  const source = JSON.stringify({ schema: 1, ...input })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `v1-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function submitMediaAsrTask(
  projectId: string,
  input: MediaAsrTaskInput,
  signal?: AbortSignal,
): Promise<MediaAsrTask> {
  const response = await submitAiTask<MediaAsrTask, { project_id: string; input: MediaAsrTaskInput }>(
    'media.asr',
    { project_id: projectId, input },
    createAiTaskIdempotencyKey('asr'),
    signal,
  )
  if (response.type !== 'media.asr' || !response.task_id) throw new Error('字幕识别任务返回数据无效')
  return response
}

export async function waitForMediaAsrTask(
  taskId: string,
  onProgress: (task: MediaAsrTask) => void,
  signal: AbortSignal,
): Promise<MediaAsrRawResult> {
  const subscription = subscribeToAiTask(taskId, isMediaAsrTask)
  try {
    while (true) {
      signal.throwIfAborted()
      const task = await subscription.next(signal)
      onProgress(task)
      if (task.status === 'completed') return await getAiTaskResult<MediaAsrRawResult>(taskId, signal)
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'input_expired') {
        throw new Error(task.message || task.error || '字幕识别任务失败')
      }
    }
  } finally {
    subscription.close()
  }
}
