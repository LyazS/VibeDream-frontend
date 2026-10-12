import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData, UnifiedMediaIndexMetadata } from '@/core/mediaitem/types'
import {
  cloudflareTaskProgressClient,
  type TaskProgressUpdate,
} from '@/core/utils/cloudflareTaskProgressClient'
import { MediaIndexTaskCompleteResolver } from '@/core/jobs/resolvers/MediaIndexTaskCompleteResolver'
import {
  canResumeMediaIndexingFromRemote,
  createMediaIndexTaskCompleteRequest,
  createMediaIndexTaskSubmitRequest,
  shouldRecoverMediaIndexing,
  waitForMediaIndexTaskCompletion,
  type MediaIndexTaskCompleteInput,
} from '@/core/jobs/resolvers/mediaIndexingShared'
import { createResourceNode } from '@/core/jobs/ResourceTypes'
import type { ResolveContext } from '@/core/jobs/ResourceResolver'

vi.mock('@/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: { saveMetaFile: vi.fn() },
}))
vi.mock('@/core/utils/cloudflareTaskProgressClient', () => ({
  cloudflareTaskProgressClient: { subscribe: vi.fn() },
}))
vi.mock('@/core/timelineitem/model/timelineItem', () => ({
  createDefaultTimelineExtraRenderConfig: vi.fn(),
}))

const taskId = 'missing-task'
const missingTaskError = () =>
  Object.assign(new Error('Task does not exist'), {
    code: 'AI_TASK_NOT_FOUND',
  })
let savedIndexing: UnifiedMediaIndexMetadata | undefined

function media(indexStatus: 'pending' | 'processing' = 'processing'): UnifiedMediaItemData {
  return {
    id: 'image-1',
    name: 'image.png',
    mediaType: 'image',
    metadata: { indexing: { mediaKind: 'image', indexStatus, lastIndexTaskId: taskId } },
  } as UnifiedMediaItemData
}

function subscribeWith(next: () => Promise<TaskProgressUpdate>) {
  const close = vi.fn()
  vi.mocked(cloudflareTaskProgressClient.subscribe).mockReturnValue({
    close,
    next: vi.fn(next),
  })
  return close
}

beforeEach(() => {
  vi.resetAllMocks()
  savedIndexing = undefined
  vi.mocked(globalMetaFileManager.saveMetaFile).mockImplementation(async (item) => {
    savedIndexing = JSON.parse(JSON.stringify(item.metadata?.indexing))
    return true
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('missing media indexing task recovery', () => {
  it.each(['pending', 'processing'] as const)(
    'clears persisted %s recovery state and lets the next attempt submit a new task',
    async (status) => {
      const item = media(status)
      const close = subscribeWith(async () => {
        throw missingTaskError()
      })
      await expect(
        waitForMediaIndexTaskCompletion(item, taskId, vi.fn(), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'AI_TASK_NOT_FOUND' })
      expect(close).toHaveBeenCalledOnce()
      expect(savedIndexing).toEqual({ mediaKind: 'image', indexStatus: 'failed' })
      expect(item.metadata?.indexing?.lastIndexTaskId).toBeUndefined()
      expect(shouldRecoverMediaIndexing(savedIndexing)).toBe(false)
      expect(canResumeMediaIndexingFromRemote(savedIndexing)).toBe(false)

      const reopenedItem = { ...item, metadata: { indexing: savedIndexing } }
      const resolver = new MediaIndexTaskCompleteResolver({
        getMediaItem: () => reopenedItem,
        getProjectId: () => 'project-1',
        ensureMediaReady: vi.fn(),
      })
      const request = createMediaIndexTaskCompleteRequest(item.id)
      const ctx: ResolveContext<MediaIndexTaskCompleteInput> = {
        input: request.input,
        node: createResourceNode(request),
        signal: new AbortController().signal,
        ensure: vi.fn(),
        update: vi.fn(),
        emit: vi.fn(),
      }
      expect(await resolver.getDependencies(ctx)).toEqual([
        createMediaIndexTaskSubmitRequest(item.id),
      ])
      vi.mocked(ctx.ensure).mockResolvedValue({ mediaId: item.id, taskId: 'new-task' })
      subscribeWith(async () => ({
        task_id: 'new-task',
        type: 'media.indexing',
        status: 'completed',
        revision: 2,
      }))
      const result = {
        media_kind: 'image',
        project_id: 'project-1',
        media_item_id: item.id,
        indexed_count: 1,
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ task_id: 'new-task', result })),
      )
      expect(await resolver.resolve(ctx)).toEqual({ mediaId: item.id, taskId: 'new-task', result })
      expect(ctx.ensure).toHaveBeenCalledWith(createMediaIndexTaskSubmitRequest(item.id))
      expect(cloudflareTaskProgressClient.subscribe).toHaveBeenLastCalledWith('new-task')
    },
  )

  it('clears recovery state if the task disappears before its result is fetched', async () => {
    const item = media()
    const close = subscribeWith(async () => ({
      task_id: taskId,
      type: 'media.indexing',
      status: 'completed',
      revision: 2,
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'AI_TASK_NOT_FOUND', message: 'Task does not exist' },
          { status: 404 },
        ),
      ),
    )
    await expect(
      waitForMediaIndexTaskCompletion(item, taskId, vi.fn(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'AI_TASK_NOT_FOUND', status: 404 })
    expect(savedIndexing).toEqual({ mediaKind: 'image', indexStatus: 'failed' })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    new Error('Network disconnected'),
    new DOMException('Aborted', 'AbortError'),
    Object.assign(new Error('Session expired'), { code: 'UNAUTHENTICATED' }),
  ])('retains recovery state for other failures: %s', async (error) => {
    const item = media()
    const close = subscribeWith(async () => {
      throw error
    })
    await expect(
      waitForMediaIndexTaskCompletion(item, taskId, vi.fn(), new AbortController().signal),
    ).rejects.toBe(error)
    expect(item.metadata?.indexing).toEqual({
      mediaKind: 'image',
      indexStatus: 'processing',
      lastIndexTaskId: taskId,
    })
    expect(globalMetaFileManager.saveMetaFile).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not clear a newer task when an older wait fails', async () => {
    const item = media()
    subscribeWith(async () => {
      item.metadata!.indexing!.lastIndexTaskId = 'new-task'
      throw missingTaskError()
    })
    await expect(
      waitForMediaIndexTaskCompletion(item, taskId, vi.fn(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'AI_TASK_NOT_FOUND' })
    expect(item.metadata?.indexing?.lastIndexTaskId).toBe('new-task')
    expect(item.metadata?.indexing?.indexStatus).toBe('processing')
    expect(globalMetaFileManager.saveMetaFile).not.toHaveBeenCalled()
  })
})
