import type {
  TaskProgressSubscription,
  TaskProgressUpdate,
} from '@/core/utils/cloudflareTaskProgressClient'
import { subscribeToAiTask } from '@/core/ai-tasks/taskApi'

export type MediaIndexingTaskStatus =
  | 'pending'
  | 'processing'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'input_expired'

export interface MediaIndexingTask {
  task_id: string
  type: 'media.indexing'
  status: MediaIndexingTaskStatus
  revision: number
  progress?: number
  progress_message?: string
  result_summary?: unknown
  error?: string
  message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

function isTaskStatus(value: unknown): value is MediaIndexingTaskStatus {
  return (
    typeof value === 'string' &&
    [
      'pending',
      'processing',
      'cancelling',
      'completed',
      'failed',
      'cancelled',
      'input_expired',
    ].includes(value)
  )
}

function isMediaIndexingTask(task: TaskProgressUpdate): task is MediaIndexingTask {
  // WebSocket 是多能力共用通道；索引 Resolver 只接受 indexing 的状态机消息。
  return task.type === 'media.indexing' && isTaskStatus(task.status)
}

export function subscribeToMediaIndexingTask(
  taskId: string,
): TaskProgressSubscription<MediaIndexingTask> {
  return subscribeToAiTask(taskId, isMediaIndexingTask)
}
