import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import type { RetrievalResultItem } from '../src/core/agent/services/mediaIndexService'
import { executeReadMedia } from '../src/core/agent/tools/readMedia'
import { executeSearchMedia } from '../src/core/agent/tools/searchMedia'
import type { ToolExecutionContext, ToolResult } from '../src/core/agent/tools/types'
import {
  createUnifiedMediaItemData,
  type MediaIndexStatus,
  type UnifiedMediaItemData,
} from '../src/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '../src/core/datasource/providers/user-selected/UserSelectedFileSource'

const mocks = vi.hoisted(() => ({
  items: [] as UnifiedMediaItemData[],
  search: vi.fn(),
  indexing: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  getMediaItem: vi.fn<(id: string) => UnifiedMediaItemData | undefined>(),
}))

vi.mock('../src/core/unifiedStore', () => ({
  useUnifiedStore: () => ({
    projectId: 'p1',
    get mediaItems() {
      return mocks.items
    },
    getMediaItem: mocks.getMediaItem,
    ensureMediaIndexing: mocks.indexing,
    jobRuntime: { onResourceEvent: mocks.subscribe },
  }),
}))
vi.mock('../src/core/agent/services/mediaIndexService', () => ({ searchMedia: mocks.search }))
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (name: string, args: Record<string, unknown>, context: ToolExecutionContext) =>
    name === 'read_media' ? executeReadMedia(args, context) : executeSearchMedia(args, context),
}))

const runtime = createToolRuntime()

function context(): ToolExecutionContext {
  return {
    toolCallId: 'read-search-1',
    userId: 'u1',
    projectId: 'p1',
    sessionId: 's1',
    modelCallId: 't1',
    signal: new AbortController().signal,
    isCurrent: () => true,
  }
}

function parse(result: ToolResult) {
  return { result, output: JSON.parse(result.output) }
}

async function run(name: string, args: Record<string, unknown>) {
  return parse(await runtime.execute({ id: 'read-search-1', name, args }, context()))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function media(
  id = 'media_video.mp4',
  mediaType: 'video' | 'image' | 'audio' = 'video',
  indexStatus: MediaIndexStatus = 'completed',
) {
  const item = createUnifiedMediaItemData(
    id,
    'Original name',
    UserSelectedFileSourceFactory.createFromBaseData({ type: 'user-selected' }),
    {
      parentDirectoryId: 'dir_original',
      mediaType,
      duration: 75,
      runtime: { bunny: { originalWidth: 1920, originalHeight: 1080 } },
      metadata:
        mediaType === 'audio'
          ? {}
          : {
              indexing: {
                mediaKind: mediaType,
                indexStatus,
                summary: { title: 'Title', summary: 'Local summary' },
              },
            },
    },
  )
  mocks.items.push(item)
  return item
}

function candidate(id = 'media_video.mp4', segmentIndex?: number): RetrievalResultItem {
  const pointId = `${id}:${segmentIndex ?? 'image'}`
  return {
    point_id: pointId,
    media_item_id: id,
    media_name: 'Stale indexed name',
    media_kind: segmentIndex === undefined ? 'image' : 'video',
    segment:
      segmentIndex === undefined
        ? null
        : {
            segment_index: segmentIndex,
            start_timecode: '00:00:01+00',
            end_timecode: '00:00:02+00',
            duration_n: 25,
          },
    title: null,
    summary: null,
    score: 0.9,
    validation_result: {
      point_id: pointId,
      verdict: 'relevant',
      reason: '  Matching scene  ',
      model: 'validator',
    },
    routes: [],
    keyword_matches: [],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.items = []
  mocks.getMediaItem.mockImplementation((id) => mocks.items.find((item) => item.id === id))
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
  mocks.search.mockResolvedValue({ results: [] })
})

describe('read_media ID contract', () => {
  it.each([
    {},
    { mediaIds: [] },
    { mediaIds: [''] },
    { mediaIds: [null] },
    { mediaIds: 'media_video.mp4' },
    { mediaIds: Array.from({ length: 11 }, () => 'media_video.mp4') },
    { mediaIds: ['media_video.mp4'], includeSegments: 'true' },
    { mediaIds: ['media_video.mp4'], parentDirId: 'dir_original' },
  ])('rejects malformed input via ToolRuntime: %j', async (args) => {
    await expect(run('read_media', args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expect(mocks.indexing).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only IDs without starting indexing', async () => {
    const { result, output } = await run('read_media', { mediaIds: [' \t '] })
    expect(result.success).toBe(false)
    expect(output.code).toBe('invalid_arguments')
    expect(mocks.indexing).not.toHaveBeenCalled()
  })

  it.each([' media_video.mp4 ', 'media_video', 'media_video.mp4.extra'])(
    'does not trim or substitute the requested ID %j',
    async (id) => {
      media()
      const { output } = await run('read_media', { mediaIds: [id] })
      expect(output.mediaItems).toEqual([
        { mediaId: id, status: 'not_found', error: expect.any(String) },
      ])
      expect(mocks.indexing).not.toHaveBeenCalled()
    },
  )

  it('accepts an exact stored ID with surrounding whitespace', async () => {
    media(' media_video.mp4 ')
    const { output } = await run('read_media', { mediaIds: [' media_video.mp4 '] })
    expect(output.mediaItems[0]).toMatchObject({ mediaId: ' media_video.mp4 ', status: 'found' })
  })

  it('preserves basic, summary and segment formats without adding identity or location fields', async () => {
    const item = media()
    item.metadata = {
      indexing: {
        mediaKind: 'video',
        indexStatus: 'partial_failed',
        failedSegmentCount: 1,
        summary: { summary: 'Local summary' },
        segmentSummaries: [
          {
            segmentIndex: 2,
            startTimecode: '00:00:01+00',
            endTimecode: '00:00:02+00',
            title: 'Shot',
            summary: 'Shot summary',
          },
        ],
      },
    }
    const { output } = await run('read_media', { mediaIds: [item.id], includeSegments: true })
    expect(output.mediaItems).toEqual([
      {
        mediaId: item.id,
        status: 'found',
        mediaType: 'video',
        basic: { name: item.name, width: 1920, height: 1080, duration: '00:00:02+15' },
        summary: 'Local summary',
        segments: [
          {
            index: 2,
            clipStart: '00:00:01+00',
            clipEnd: '00:00:02+00',
            title: 'Shot',
            summary: 'Shot summary',
          },
        ],
        warning: '有 1 个分镜分析失败，已返回可用分镜',
      },
    ])
    expect(
      (await run('read_media', { mediaIds: [item.id] })).output.mediaItems[0],
    ).not.toHaveProperty('segments')
  })

  it('returns audio basics without content indexing', async () => {
    const item = media('audio.wav', 'audio')
    const { output } = await run('read_media', { mediaIds: [item.id] })
    expect(output.mediaItems).toEqual([
      {
        mediaId: item.id,
        status: 'found',
        mediaType: 'audio',
        basic: { name: item.name, duration: '00:00:02+15' },
      },
    ])
    expect(mocks.indexing).not.toHaveBeenCalled()
  })

  it('uses current local names and details after indexing, including items already resolved', async () => {
    const ready = media('ready.mp4')
    const waiting = media('waiting.mp4', 'video', 'processing')
    const indexing = deferred<void>()
    mocks.indexing.mockReturnValue(indexing.promise)
    const pending = executeReadMedia({ mediaIds: [ready.id, waiting.id] }, context())
    expect(mocks.indexing).toHaveBeenCalledWith(waiting.id)

    mocks.items = [
      { ...ready, name: 'Renamed ready', parentDirectoryId: 'dir_moved' },
      {
        ...waiting,
        name: 'Renamed waiting',
        parentDirectoryId: 'dir_moved',
        runtime: { bunny: { originalWidth: 1280, originalHeight: 720 } },
        metadata: {
          indexing: {
            mediaKind: 'video',
            indexStatus: 'completed',
            summary: { summary: 'Latest summary' },
          },
        },
      },
    ]
    indexing.resolve()
    const { output } = parse(await pending)
    expect(output.mediaItems[0].basic.name).toBe('Renamed ready')
    expect(output.mediaItems[1]).toEqual({
      mediaId: waiting.id,
      status: 'found',
      mediaType: 'video',
      basic: { name: 'Renamed waiting', width: 1280, height: 720, duration: '00:00:02+15' },
      summary: 'Latest summary',
    })
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['ready', 'waiting'])(
    'reports a deleted %s item after waiting without using its replacement',
    async (kind) => {
      const ready = media('ready.mp4')
      const waiting = media('waiting.mp4', 'video', 'processing')
      const deletedId = kind === 'ready' ? ready.id : waiting.id
      const indexing = deferred<void>()
      mocks.indexing.mockReturnValue(indexing.promise)
      const pending = executeReadMedia({ mediaIds: [ready.id, waiting.id] }, context())
      mocks.items = mocks.items.filter((item) => item.id !== deletedId)
      media(`${deletedId}.replacement`)
      waiting.metadata!.indexing!.indexStatus = 'completed'
      indexing.resolve()
      const { output } = parse(await pending)
      expect(
        output.mediaItems.find((item: { mediaId: string }) => item.mediaId === deletedId),
      ).toMatchObject({
        mediaId: deletedId,
        status: 'not_found',
        error: expect.any(String),
      })
    },
  )

  it.each(['status', 'rejection'])(
    'keeps local basics when analysis fails through %s',
    async (kind) => {
      const item = media('failed.mp4', 'video', kind === 'status' ? 'failed' : 'processing')
      mocks.indexing.mockRejectedValue(new Error('Indexing service unavailable'))
      const { output } = await run('read_media', { mediaIds: [item.id] })
      expect(output.mediaItems[0]).toMatchObject({
        mediaId: item.id,
        status: 'failed',
        basic: { name: item.name, width: 1920, height: 1080, duration: '00:00:02+15' },
        error: kind === 'status' ? '素材内容分析失败' : 'Indexing service unavailable',
      })
      expect(output.mediaItems[0]).not.toHaveProperty('parentDirId')
      expect(output.mediaItems[0]).not.toHaveProperty('parentPath')
    },
  )
})

describe('search_media ID contract', () => {
  it.each([
    {},
    { query: '' },
    { query: 1 },
    { query: 'city', parentDirId: 'dir_original' },
    { query: 'city', top_k: 0 },
    { query: 'city', top_k: 11 },
    { query: 'city', top_k: 1.5 },
    { query: 'city', top_k: '5' },
  ])('rejects malformed input via ToolRuntime: %j', async (args) => {
    await expect(run('search_media', args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('rejects whitespace queries without searching', async () => {
    const { result, output } = await run('search_media', { query: ' \t ' })
    expect(result.success).toBe(false)
    expect(output.code).toBe('invalid_arguments')
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('uses current local names after search completes and preserves multiple segment candidates', async () => {
    const item = media()
    const search = deferred<{ results: RetrievalResultItem[] }>()
    mocks.search.mockReturnValue(search.promise)
    const pending = executeSearchMedia({ query: ' city ' }, context())
    expect(mocks.search.mock.calls[0][0]).toMatchObject({ query: 'city', topK: 5 })
    mocks.items = [{ ...item, name: 'Current local name', parentDirectoryId: 'dir_moved' }]
    search.resolve({ results: [candidate(item.id, 2), candidate(item.id, 1)] })
    const { result, output } = parse(await pending)
    expect(result.success).toBe(true)
    expect(output.results).toEqual(
      [2, 1].map((index) => ({
        type: 'video',
        mediaId: item.id,
        mediaName: 'Current local name',
        verdict: 'relevant',
        segment: { index, clipStart: '00:00:01+00', clipEnd: '00:00:02+00' },
        evidence: 'Matching scene',
      })),
    )
    expect(output).not.toHaveProperty('warning')
    expect(mocks.getMediaItem.mock.calls).toEqual([[item.id], [item.id]])
  })

  it('preserves image candidates and the requested limit without directory fields', async () => {
    const item = media('image.png', 'image')
    mocks.search.mockResolvedValue({ results: [candidate(item.id)] })
    const { output } = await run('search_media', { query: 'city', top_k: 10 })
    expect(output.requestedTopK).toBe(10)
    expect(mocks.search.mock.calls[0][0].topK).toBe(10)
    expect(output.results).toEqual([
      {
        type: 'image',
        mediaId: item.id,
        mediaName: item.name,
        verdict: 'relevant',
        evidence: 'Matching scene',
      },
    ])
  })

  it.each([false, true])(
    'filters deleted candidates and counts segments even when allDeleted=%s',
    async (allDeleted) => {
      const deleted = media('deleted.mp4')
      const retained = media('retained.mp4')
      const search = deferred<{ results: RetrievalResultItem[] }>()
      mocks.search.mockReturnValue(search.promise)
      const pending = executeSearchMedia({ query: 'city' }, context())
      mocks.items = allDeleted ? [] : [retained]
      media('deleted.mp4.replacement')
      search.resolve({
        results: [candidate(deleted.id, 1), candidate(retained.id, 1), candidate(deleted.id, 2)],
      })
      const { result, output } = parse(await pending)
      expect(result.success).toBe(true)
      expect(output.warning).toBe(`已剔除 ${allDeleted ? 3 : 2} 个已删除素材的候选结果。`)
      expect(output.results.map((item: { mediaId: string }) => item.mediaId)).toEqual(
        allDeleted ? [] : [retained.id],
      )
      expect(output.summary).toBe(`找到 ${allDeleted ? 0 : 1} 个匹配素材。`)
    },
  )

  it('does not normalize or complete backend candidate IDs', async () => {
    media()
    mocks.search.mockResolvedValue({
      results: [candidate(' media_video.mp4 '), candidate('media_video')],
    })
    const { output } = await run('search_media', { query: 'city' })
    expect(output.results).toEqual([])
    expect(output.warning).toBe('已剔除 2 个已删除素材的候选结果。')
  })

  it('ignores missing validation only for candidates that no longer exist', async () => {
    mocks.search.mockResolvedValue({
      results: [{ ...candidate('deleted.mp4'), validation_result: undefined }],
    })
    const { result, output } = await run('search_media', { query: 'city' })
    expect(result.success).toBe(true)
    expect(output.results).toEqual([])
    expect(output.warning).toBe('已剔除 1 个已删除素材的候选结果。')
  })

  it.each(['validation', 'service'])('preserves %s failures', async (kind) => {
    const item = media()
    mocks.search.mockResolvedValue({
      results: [{ ...candidate(item.id, 1), validation_result: undefined }],
      error: kind === 'service' ? 'Search service failed' : undefined,
    })
    const { result, output } = await run('search_media', { query: 'city' })
    expect(result.success).toBe(false)
    expect(output).toMatchObject({
      code: 'internal_error',
      error: kind === 'service' ? 'Search service failed' : '搜索结果缺少校验信息',
    })
    expect(output).not.toHaveProperty('results')
  })
})
