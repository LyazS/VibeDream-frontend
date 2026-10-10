import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VirtualDirectory } from '../src/core/directory/types'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeListMedia } from '../src/core/agent/tools/listMedia'

const mocks = vi.hoisted(() => ({
  directories: new Map<string, VirtualDirectory>(),
  assets: [] as Array<Record<string, unknown>>,
  getAssetIdsInDirectory: vi.fn<(dirId: string) => string[]>(),
}))

vi.mock('../src/core/unifiedStore', () => ({
  useUnifiedStore: () => ({
    directories: mocks.directories,
    currentDir: mocks.directories.get('dir_videos'),
    getDirectory: (dirId: string) => mocks.directories.get(dirId),
    getAllAssets: () => mocks.assets,
    getAssetIdsInDirectory: mocks.getAssetIdsInDirectory,
  }),
}))
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (_name: string, args: Record<string, unknown>) => executeListMedia(args),
}))

function directory(id: string, name: string, parentId: string | null, childDirIds: string[] = []) {
  const value: VirtualDirectory = {
    id,
    name,
    parentId,
    childDirIds,
    type: 'base',
    createdAt: '2026-10-10T00:00:00Z',
  }
  mocks.directories.set(id, value)
  return value
}

async function list(args: Record<string, unknown> = {}) {
  const result = await createToolRuntime().execute(
    { id: 'list1', name: 'list_media', args },
    {
      toolCallId: 'list1',
      userId: 'u1',
      projectId: 'p1',
      sessionId: 's1',
      modelCallId: 't1',
      signal: new AbortController().signal,
      isCurrent: () => true,
    },
  )
  return { result, output: JSON.parse(result.output) }
}

beforeEach(() => {
  mocks.directories.clear()
  mocks.assets = []
  mocks.getAssetIdsInDirectory.mockReset().mockReturnValue([])
  directory('dir_root', '素材库', null, ['dir_videos'])
  directory('dir_videos', '视频', 'dir_root')
})

describe('list_media ID contract', () => {
  it('defaults to the root independently of the UI directory and exposes child IDs', async () => {
    const { result, output } = await list()
    expect(result.success).toBe(true)
    expect(output).toEqual({
      tool: 'list_media',
      dirId: 'dir_root',
      name: '素材库',
      parentDirId: null,
      path: '/',
      entries: [{ type: 'directory', dirId: 'dir_videos', name: '视频' }],
      page: { offset: 1, limit: 20, total: 1, nextOffset: null },
    })
    expect((await list({ dirId: output.entries[0].dirId })).output).toMatchObject({
      dirId: 'dir_videos',
      name: '视频',
      parentDirId: 'dir_root',
      path: '/视频/',
    })
  })

  it('selects historical same-name directories by exact ID and reflects ancestor renames', async () => {
    directory('dir_other', '视频', 'dir_root', ['dir_shots'])
    directory('dir_shots', '镜头', 'dir_other')
    expect((await list({ dirId: 'dir_other' })).output.entries).toEqual([
      { type: 'directory', dirId: 'dir_shots', name: '镜头' },
    ])
    mocks.directories.get('dir_other')!.name = '精选'
    expect((await list({ dirId: 'dir_shots' })).output.path).toBe('/精选/镜头/')
  })

  it.each(['dir_missing', 'dir_video', '/视频/', ' dir_videos '])(
    'fails for explicit unknown ID %s without falling back',
    async (dirId) => {
      const { result, output } = await list({ dirId })
      expect(result.success).toBe(false)
      expect(output).toMatchObject({ code: 'directory_not_found', details: { dirId } })
      expect(output).not.toHaveProperty('entries')
    },
  )

  it('reports a missing root', async () => {
    mocks.directories.delete('dir_root')
    expect((await list()).output.code).toBe('directory_not_found')
  })

  it.each(['missing', 'cycle'])('reports a %s parent chain', async (kind) => {
    mocks.directories.get('dir_videos')!.parentId =
      kind === 'missing' ? 'dir_missing' : 'dir_videos'
    const { result, output } = await list({ dirId: 'dir_videos' })
    expect(result.success).toBe(false)
    expect(output.code).toBe('invalid_directory_structure')
  })

  it.each([
    { filePath: '/' },
    { dirId: 'dir_root', filePath: '/' },
    { dirId: '' },
    { dirId: null },
    { dirId: 1 },
    { dirId: { id: 'dir_root' } },
    { offset: 0 },
    { offset: 1.5 },
    { offset: '1' },
    { limit: 0 },
    { limit: null },
  ])('rejects invalid or legacy arguments via ToolRuntime: %j', async (args) => {
    await expect(list(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
  })

  it('rejects whitespace IDs in the executor', async () => {
    expect((await list({ dirId: '   ' })).output.code).toBe('invalid_arguments')
  })

  it('keeps same-name pagination deterministic by type and full ID', async () => {
    const root = mocks.directories.get('dir_root')!
    root.childDirIds = ['dir_b', 'dir_a']
    directory('dir_b', '同名', 'dir_root')
    directory('dir_a', '同名', 'dir_root')
    mocks.assets = ['media_b.mp4', 'media_a.mp4'].map((id) => ({
      id,
      name: '同名',
      mediaType: 'video',
    }))
    mocks.getAssetIdsInDirectory.mockReturnValue(['media_b.mp4', 'media_a.mp4'])
    const first = (await list({ limit: 2 })).output
    expect(first.entries.map((entry: { dirId: string }) => entry.dirId)).toEqual(['dir_a', 'dir_b'])
    expect(first.page).toEqual({ offset: 1, limit: 2, total: 4, nextOffset: 3 })
    const second = (await list({ dirId: first.dirId, offset: first.page.nextOffset, limit: 2 }))
      .output
    expect(second.entries.map((entry: { mediaId: string }) => entry.mediaId)).toEqual([
      'media_a.mp4',
      'media_b.mp4',
    ])
    expect(second.page.nextOffset).toBeNull()
    expect((await list({ offset: 5 })).output).toMatchObject({
      code: 'invalid_arguments',
      details: { offset: 5, total: 4 },
    })
  })

  it('preserves media fields and completed indexing metadata without repeating parent fields', async () => {
    mocks.assets = [
      {
        id: 'media_video.mp4',
        name: 'A.mp4',
        mediaType: 'video',
        metadata: {
          indexing: {
            indexStatus: 'completed',
            mediaKind: 'video',
            summary: { title: ' 海边日落 ' },
            segmentCount: 4,
          },
        },
      },
      {
        id: 'media_image.png',
        name: 'B.png',
        mediaType: 'image',
        metadata: {
          indexing: {
            indexStatus: 'completed',
            mediaKind: 'image',
            summary: { title: '照片' },
          },
        },
      },
      {
        id: 'media_pending.mp4',
        name: 'C.mp4',
        mediaType: 'video',
        metadata: { indexing: { indexStatus: 'processing', segmentCount: 9 } },
      },
    ]
    mocks.getAssetIdsInDirectory.mockImplementation((dirId) =>
      dirId === 'dir_videos' ? mocks.assets.map((asset) => asset.id as string) : [],
    )
    expect((await list({ dirId: 'dir_videos' })).output.entries).toEqual([
      {
        type: 'media',
        mediaId: 'media_video.mp4',
        name: 'A.mp4',
        mediaType: 'video',
        title: '海边日落',
        shots: 4,
      },
      {
        type: 'media',
        mediaId: 'media_image.png',
        name: 'B.png',
        mediaType: 'image',
        title: '照片',
      },
      { type: 'media', mediaId: 'media_pending.mp4', name: 'C.mp4', mediaType: 'video' },
    ])
    expect(
      (await list()).output.entries.every((entry: { type: string }) => entry.type === 'directory'),
    ).toBe(true)
  })

  it('preserves empty-directory pagination and reports lookup exceptions as failures', async () => {
    expect((await list({ dirId: 'dir_videos', offset: 10 })).output.page).toEqual({
      offset: 10,
      limit: 20,
      total: 0,
      nextOffset: null,
    })
    mocks.getAssetIdsInDirectory.mockImplementation(() => {
      throw new Error('index unavailable')
    })
    const { result, output } = await list({ dirId: 'dir_videos' })
    expect(result.success).toBe(false)
    expect(output).toMatchObject({ code: 'internal_error', error: 'index unavailable' })
  })
})
