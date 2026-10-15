import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import {
  AIGenerationSourceFactory,
  extractAIGenerationSourceData,
} from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import {
  AITaskType,
  ContentType,
  TaskStatus,
  TaskStreamEventType,
  type TaskStreamEvent,
} from '@/core/datasource/providers/ai-generation/types'
import { JobRuntime } from '@/core/jobs/JobRuntime'
import {
  createAIGeneratedMediaRequest,
  createAIGeneratedMediaResolver,
  createAIInputPreparedResolver,
  createAITaskSubmittedResolver,
  createRemoteTaskCompletedResolver,
  isAIGeneratedMediaRecoverable,
  resetAIGeneratedMediaForRetry,
} from '@/core/jobs/resolvers/AIGeneratedMediaResolver'
import type { ResolveContext } from '@/core/jobs/ResourceResolver'
import { createResourceNode, type ResourceRequest } from '@/core/jobs/ResourceTypes'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

const api = vi.hoisted(() => ({ post: vi.fn(), stream: vi.fn(), delete: vi.fn() }))
const files = vi.hoisted(() => ({
  saveMetaFile: vi.fn(),
  verifyMediaFileExists: vi.fn(),
}))

vi.mock('@/utils/fetchClient', () => ({ fetchClient: api, sleepWithAbortSignal: vi.fn() }))
vi.mock('@/core/managers/media/globalMetaFileManager', () => ({ globalMetaFileManager: files }))

function setupGeneration(taskId = '') {
  const source = AIGenerationSourceFactory.createAIGenerationSource(
    {
      type: 'ai-generation',
      aiTaskId: taskId,
      taskStatus: TaskStatus.PENDING,
      requestParams: {
        ai_task_type: AITaskType.RUNNINGHUB_GENERATE_MEDIA,
        content_type: ContentType.IMAGE,
        task_config: { id: 'test-model', prompt: 'A mountain' },
      },
    },
    SourceOrigin.USER_CREATE,
  )
  const mediaItem: UnifiedMediaItemData = {
    id: 'generated.png',
    name: 'Generated image',
    createdAt: new Date().toISOString(),
    assetKind: 'media',
    parentDirectoryId: 'root',
    mediaStatus: 'pending',
    mediaType: 'image',
    source,
    runtime: {},
  }
  const ensureMediaReady = vi.fn(async () => {
    mediaItem.mediaStatus = 'ready'
  })
  const module = { getMediaItem: () => mediaItem, ensureMediaReady }
  const runtime = new JobRuntime()
  const resolver = createAIGeneratedMediaResolver(module)
  runtime.registerResolver(resolver)
  runtime.registerResolver(createAIInputPreparedResolver(module))
  runtime.registerResolver(createAITaskSubmittedResolver(module))
  runtime.registerResolver(createRemoteTaskCompletedResolver(module))
  return { source, mediaItem, runtime, resolver, ensureMediaReady }
}

function context<TInput>(request: ResourceRequest<TInput>): ResolveContext<TInput> {
  return {
    node: createResourceNode(request),
    input: request.input,
    signal: new AbortController().signal,
    ensure: async () => {
      throw new Error('Unexpected dependency')
    },
    update: vi.fn(),
    emit: vi.fn(),
  }
}

function completeStream(status = TaskStatus.COMPLETED) {
  api.stream.mockImplementation(
    async (
      _method: string,
      _url: string,
      onMessage: (event: TaskStreamEvent) => boolean | void,
    ) => {
      onMessage({
        type: TaskStreamEventType.PROGRESS_UPDATE,
        task_id: 'remote-task',
        timestamp: new Date().toISOString(),
        status: TaskStatus.PROCESSING,
        progress: 50,
        message: 'Generating',
      })
      onMessage({
        type: TaskStreamEventType.FINAL,
        task_id: 'remote-task',
        timestamp: new Date().toISOString(),
        status,
        progress: 100,
        message: status === TaskStatus.FAILED ? 'Generation failed' : 'Complete',
        ...(status === TaskStatus.COMPLETED && {
          result_data: { url: 'https://example.com/generated.png' },
        }),
      })
    },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  files.saveMetaFile.mockResolvedValue(true)
  files.verifyMediaFileExists.mockResolvedValue(false)
  api.post.mockResolvedValue({ status: 200, data: { success: true, task_id: 'remote-task' } })
  api.delete.mockResolvedValue({ status: 200, data: { success: true } })
  completeStream()
})

describe('backend AI generation', () => {
  it('submits prepared input, receives a result and prepares the local media', async () => {
    const { source, mediaItem, runtime, ensureMediaReady } = setupGeneration()

    await expect(runtime.ensure(createAIGeneratedMediaRequest(mediaItem.id))).resolves.toEqual({
      mediaId: mediaItem.id,
      status: 'ready',
    })

    expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/media/generate', source.requestParams, {
      signal: expect.any(AbortSignal),
    })
    expect(api.stream).toHaveBeenCalledWith(
      'GET',
      '/api/media/tasks/remote-task/status',
      expect.any(Function),
      undefined,
      { signal: expect.any(AbortSignal) },
    )
    expect(source.aiTaskId).toBe('remote-task')
    expect(source.taskStatus).toBe(TaskStatus.COMPLETED)
    expect(source.resultData).toEqual({ url: 'https://example.com/generated.png' })
    expect(files.saveMetaFile).toHaveBeenCalledWith(mediaItem)
    expect(ensureMediaReady).toHaveBeenCalledExactlyOnceWith(mediaItem.id)
  })

  it('resumes an existing remote task without submitting it again', async () => {
    const { mediaItem, runtime, ensureMediaReady } = setupGeneration('remote-task')

    await runtime.ensure(createAIGeneratedMediaRequest(mediaItem.id))

    expect(api.post).not.toHaveBeenCalled()
    expect(api.stream).toHaveBeenCalledOnce()
    expect(ensureMediaReady).toHaveBeenCalledOnce()
  })

  it('restores a completed source from persisted data without remote requests', async () => {
    const { source, mediaItem, runtime, ensureMediaReady } = setupGeneration('remote-task')
    source.taskStatus = TaskStatus.COMPLETED
    source.resultData = { url: 'https://example.com/generated.png' }
    const persisted = JSON.parse(JSON.stringify(extractAIGenerationSourceData(source)))
    mediaItem.source = AIGenerationSourceFactory.createAIGenerationSource(
      persisted,
      SourceOrigin.PROJECT_LOAD,
    )

    await runtime.ensure(createAIGeneratedMediaRequest(mediaItem.id))

    expect(api.post).not.toHaveBeenCalled()
    expect(api.stream).not.toHaveBeenCalled()
    expect(ensureMediaReady).toHaveBeenCalledOnce()
  })

  it('persists remote failures and allows retrying with a new task', async () => {
    const { source, mediaItem, runtime } = setupGeneration('remote-task')
    completeStream(TaskStatus.FAILED)

    await expect(runtime.ensure(createAIGeneratedMediaRequest(mediaItem.id))).rejects.toThrow(
      'Generation failed',
    )
    expect(mediaItem.mediaStatus).toBe('error')
    expect(isAIGeneratedMediaRecoverable(mediaItem)).toBe(false)
    expect(files.saveMetaFile).toHaveBeenCalledWith(mediaItem)

    resetAIGeneratedMediaForRetry(mediaItem)
    expect(source.aiTaskId).toBe('')
    expect(source.taskStatus).toBe(TaskStatus.PENDING)
    expect(source.progress).toBe(0)
    expect(source.resultData).toBeUndefined()
    expect(source.errorMessage).toBeUndefined()
    expect(isAIGeneratedMediaRecoverable(mediaItem)).toBe(true)
  })

  it('cancels the backend task and persists its cancelled state', async () => {
    const { source, mediaItem, resolver } = setupGeneration('remote-task')
    const ctx = context(createAIGeneratedMediaRequest(mediaItem.id))

    await resolver.cancel(ctx)
    await resolver.cancel(ctx)

    expect(api.delete).toHaveBeenCalledExactlyOnceWith('/api/media/tasks/remote-task')
    expect(source.taskStatus).toBe(TaskStatus.CANCELLED)
    expect(mediaItem.mediaStatus).toBe('cancelled')
    expect(files.saveMetaFile).toHaveBeenCalledWith(mediaItem)
  })

  it('keeps the task recoverable when remote cancellation fails', async () => {
    const { source, mediaItem, resolver } = setupGeneration('remote-task')
    api.delete.mockRejectedValue(new Error('Network unavailable'))

    await expect(
      resolver.cancel(context(createAIGeneratedMediaRequest(mediaItem.id))),
    ).rejects.toThrow('Network unavailable')

    expect(source.taskStatus).toBe(TaskStatus.PENDING)
    expect(mediaItem.mediaStatus).toBe('pending')
    expect(files.saveMetaFile).not.toHaveBeenCalled()
    expect(isAIGeneratedMediaRecoverable(mediaItem)).toBe(true)
  })
})
