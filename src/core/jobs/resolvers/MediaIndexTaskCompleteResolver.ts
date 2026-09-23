import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import { cancelMediaTask } from './mediaTaskApi'
import {
  canResumeMediaIndexingFromRemote,
  createMediaIndexTaskCompleteRequest,
  createMediaIndexTaskSubmitRequest,
  getIndexableMediaItem,
  persistMediaItem,
  setIndexingMetadata,
  waitForMediaIndexTaskCompletion,
  type MediaIndexTaskCompleteInput,
  type MediaIndexTaskCompleteResult,
  type MediaIndexTaskSubmitResult,
  type MediaIndexingModule,
  MEDIA_INDEX_TASK_COMPLETE_RESOURCE_TYPE,
} from './mediaIndexingShared'

export class MediaIndexTaskCompleteResolver
  implements ResourceResolver<MediaIndexTaskCompleteInput, MediaIndexTaskCompleteResult>
{
  readonly type = MEDIA_INDEX_TASK_COMPLETE_RESOURCE_TYPE
  private abortControllers = new Map<string, AbortController>()

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: MediaIndexTaskCompleteInput): string {
    return input.taskId ? `${input.mediaId}:${input.taskId}` : input.mediaId
  }

  async getDependencies(
    ctx: ResolveContext<MediaIndexTaskCompleteInput>,
  ): Promise<ResourceRequest[]> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const indexing = mediaItem?.metadata?.indexing
    const existingTaskId = canResumeMediaIndexingFromRemote(indexing)
      ? ctx.input.taskId || indexing?.lastIndexTaskId
      : undefined
    // 已有待处理任务时跳过提交 Resolver，后续只重新订阅其进度。
    if (existingTaskId) {
      return []
    }

    return [createMediaIndexTaskSubmitRequest(ctx.input.mediaId)]
  }

  async resolve(
    ctx: ResolveContext<MediaIndexTaskCompleteInput>,
  ): Promise<MediaIndexTaskCompleteResult> {
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    const indexing = mediaItem.metadata?.indexing
    const existingTaskId = canResumeMediaIndexingFromRemote(indexing)
      ? ctx.input.taskId || indexing?.lastIndexTaskId
      : undefined
    const submitted = existingTaskId
      ? null
      : await ctx.ensure<MediaIndexTaskSubmitResult>(
          createMediaIndexTaskSubmitRequest(ctx.input.mediaId),
        )
    const taskId = existingTaskId || submitted?.taskId
    if (!taskId) {
      throw new Error(`索引任务缺少 taskId: ${mediaItem.id}`)
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    this.abortControllers.set(taskId, controller)

    try {
      const result = await waitForMediaIndexTaskCompletion(
        mediaItem,
        taskId,
        (patch) => ctx.update(patch),
        controller.signal,
      )

      await persistMediaItem(mediaItem)
      ctx.update({
        progress: 1,
        stage: 'index-task-completed',
        message: `索引任务完成: ${taskId}`,
      })

      return {
        mediaId: mediaItem.id,
        taskId,
        result,
      }
    } finally {
      this.abortControllers.delete(taskId)
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }

  async cancel(ctx: ResolveContext<MediaIndexTaskCompleteInput>): Promise<void> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const taskId = ctx.input.taskId || mediaItem?.metadata?.indexing?.lastIndexTaskId
    if (!taskId) {
      return
    }

    // 先终止本地等待，再请求后端状态机取消；后端 Workflow 会在安全检查点退款并发布最终状态。
    this.abortControllers.get(taskId)?.abort()
    await cancelMediaTask(taskId, 'indexing')

    if (mediaItem) {
      setIndexingMetadata(mediaItem, {
        indexStatus: 'failed',
        lastIndexTaskId: taskId,
      })
      await persistMediaItem(mediaItem)
    }
  }
}

export function createMediaIndexTaskCompleteResolver(
  module: MediaIndexingModule,
): MediaIndexTaskCompleteResolver {
  return new MediaIndexTaskCompleteResolver(module)
}

export { createMediaIndexTaskCompleteRequest }
