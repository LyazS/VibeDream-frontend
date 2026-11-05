import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeReadMedia } from '../src/core/agent/tools/readMedia'
import type { ToolExecutionContext, ToolResult } from '../src/core/agent/tools/types'
import {
  createUnifiedMediaItemData,
  type MediaIndexStatus,
  type UnifiedMediaItemData,
} from '../src/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '../src/core/datasource/providers/user-selected/UserSelectedFileSource'

const mocks = vi.hoisted(() => ({
  items: [] as UnifiedMediaItemData[],
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
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (name: string, args: Record<string, unknown>, context: ToolExecutionContext) =>
    executeReadMedia(args, context),
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

function media(
  id = 'media_video',
  mediaType: 'video' | 'image' | 'audio' = 'video',
  indexStatus: MediaIndexStatus = 'completed',
) {
  const item = createUnifiedMediaItemData(
    id,
    'Original name',
    UserSelectedFileSourceFactory.createFromBaseData({ type: 'user-selected' }),
    {
      ext: mediaType === 'audio' ? '.wav' : mediaType === 'image' ? '.png' : '.mp4',
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

beforeEach(() => {
  vi.resetAllMocks()
  mocks.items = []
  mocks.getMediaItem.mockImplementation((id) => mocks.items.find((item) => item.id === id))
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
})

describe('read_media ID contract', () => {
  it.each([
    {},
    { mediaIds: [] },
    { mediaIds: [''] },
    { mediaIds: [null] },
    { mediaIds: 'media_video' },
    { mediaIds: Array.from({ length: 11 }, () => 'media_video') },
    { mediaIds: ['media_video'], includeSegments: 'true' },
    { mediaIds: ['media_video'], includeSummary: 'true' },
    { mediaIds: ['media_video'], parentDirId: 'dir_original' },
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

  it.each([' media_video ', 'media_vide', 'media_video.mp4', 'media_video_extra'])(
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
    media(' media_video ')
    const { output } = await run('read_media', { mediaIds: [' media_video '] })
    expect(output.mediaItems[0]).toMatchObject({ mediaId: ' media_video ', status: 'found' })
  })

  it('returns only basic metadata even when legacy include flags are passed directly', async () => {
    const item = media()
    item.metadata = {
      indexing: {
        mediaKind: 'video',
        indexStatus: 'processing',
        summary: { summary: 'Local summary' },
      },
    }
    const { output } = parse(
      await executeReadMedia(
        { mediaIds: [item.id], includeSummary: true, includeSegments: true },
        context(),
      ),
    )
    expect(output.mediaItems).toEqual([
      {
        mediaId: item.id,
        status: 'found',
        mediaType: 'video',
        basic: { name: item.name, width: 1920, height: 1080, duration: '00:00:02+15' },
      },
    ])
    expect(mocks.indexing).not.toHaveBeenCalled()
  })

  it('returns audio basics without content indexing', async () => {
    const item = media('media_audio', 'audio')
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

  it('returns basic metadata by default without content indexing', async () => {
    const item = media('media_unindexed')
    item.metadata = {}

    const { output } = await run('read_media', { mediaIds: [item.id] })

    expect(output.mediaItems[0]).toEqual({
      mediaId: item.id,
      status: 'found',
      mediaType: 'video',
      basic: { name: item.name, width: 1920, height: 1080, duration: '00:00:02+15' },
    })
    expect(mocks.indexing).not.toHaveBeenCalled()
  })

})
