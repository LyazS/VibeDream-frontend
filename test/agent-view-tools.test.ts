/** 覆盖素材与时间轴观察的参数预算、裁剪、抽帧去重、快照复用和取消清理。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { executeViewMedia } from '@/core/agent/tools/viewMedia'
import { executeViewTimeline } from '@/core/agent/tools/viewTimeline'
import { createToolRuntime } from '@/core/agent/runtime/ToolRuntime'
import { viewSampleFrames } from '@/core/agent/tools/viewShared'
import { visualCrop } from '@/core/agent/services/agentImageService'
import type { ToolExecutionContext } from '@/core/agent/tools/types'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import { agentImageFixture } from './helpers/agent-files'

const mocks = vi.hoisted(() => ({
  getMediaItem: vi.fn(),
  ensureMediaReady: vi.fn(),
  createCapture: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  readAttachment: vi.fn(),
  draw: vi.fn(),
  sampleDraw: vi.fn(),
  sampleClose: vi.fn(),
  bitmapClose: vi.fn(),
}))
vi.mock('@/core/unifiedStore', () => ({
  useUnifiedStore: () => ({
    projectId: 'project',
    totalDurationFrames: 300,
    getMediaItem: mocks.getMediaItem,
    ensureMediaReady: mocks.ensureMediaReady,
    createTimelineFrameCaptureSession: mocks.createCapture,
  }),
}))
vi.mock('@/core/managers/filesystem/fileSystemService', async () => ({
  fileSystemService: {
    ...(await import('./helpers/agent-files')).agentFileSystem,
    readAgentAttachment: mocks.readAttachment,
  },
}))
let controller: AbortController,
  context: ToolExecutionContext,
  staged: Array<{ description: string; width: number; height: number; blob: Blob }>
const bitmap = { width: 4000, height: 2000, close: mocks.bitmapClose }
/** 用非零起始时间及低帧率模拟视频，验证相对时间换算与实际帧去重。 */
function video() {
  return {
    id: 'video',
    mediaType: 'video',
    mediaStatus: 'ready',
    name: 'Source',
    runtime: {
      bunny: {
        bunnyMedia: {
          getVideoDisplayRange: vi.fn().mockResolvedValue({ start: 2, end: 12 }),
          videoGetSample: () =>
            vi.fn(async (at: number) => ({
              timestamp: Math.floor((at - 2) * 2) / 2 + 2,
              duration: 0.5,
              displayWidth: 1920,
              displayHeight: 1080,
              drawWithFit: mocks.sampleDraw,
              close: mocks.sampleClose,
            })),
        },
      },
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  controller = new AbortController()
  staged = []
  context = {
    toolCallId: 'call',
    userId: 'user',
    projectId: 'project',
    sessionId: 'session',
    modelCallId: 'model',
    signal: controller.signal,
    isCurrent: () => true,
    stageImage: (image) => {
      staged.push(image)
      return { type: 'image', image: { id: `observed_${staged.length}` } }
    },
  }
  mocks.ensureMediaReady.mockResolvedValue(undefined)
  mocks.createCapture.mockReturnValue({ renderToCanvas: mocks.render, dispose: mocks.dispose })
  mocks.render.mockResolvedValue({ width: 1920, height: 1080 })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage: mocks.draw }),
      toBlob: (done: BlobCallback) => done(new Blob(['encoded'], { type: 'image/webp' })),
    }),
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  { items: [] },
  { items: [{ source: { kind: 'media', mediaId: 'm', attachmentId: 'a' } }] },
  { items: [{ source: { kind: 'media', mediaId: 'm' }, unknown: true }] },
  { items: [{ source: { kind: 'media', mediaId: 'm' }, at: '00:00:00+30' }] },
  {
    items: [
      {
        source: { kind: 'media', mediaId: 'm' },
        at: '00:00:00+00',
        timeRange: { start: '00:00:00+00', end: '00:00:01+00' },
      },
    ],
  },
  {
    items: [
      { source: { kind: 'media', mediaId: 'm' }, region: { x: 0.9, y: 0, width: 0.2, height: 1 } },
    ],
  },
])('rejects malformed or ambiguous view arguments before source work: %j', async (args) => {
  const result = await executeViewMedia(args, context)
  expect(result.success).toBe(false)
  expect(result.output).toContain('invalid_arguments')
  expect(mocks.ensureMediaReady).not.toHaveBeenCalled()
})

it('enforces a strict shared schema and reserves the entire image budget before decoding', async () => {
  const runtime = createToolRuntime()
  expect(() =>
    runtime.validate({ id: 'c', name: 'view_timeline', args: { items: [{}] } }),
  ).toThrow()
  expect(() =>
    runtime.validate({
      id: 'c',
      name: 'view_timeline',
      args: {
        items: [{ at: '00:00:00+00', timeRange: { start: '00:00:00+00', end: '00:00:01+00' } }],
      },
    }),
  ).toThrow()
  const result = await executeViewMedia(
    {
      items: [
        {
          source: { kind: 'media', mediaId: 'video' },
          timeRange: { start: '00:00:00+00', end: '00:00:01+00', frameCount: 9 },
        },
        { source: { kind: 'attachment', attachmentId: 'a' } },
      ],
    },
    context,
  )
  expect(result.output).toContain('visual_budget_exceeded')
  expect(mocks.getMediaItem).not.toHaveBeenCalled()
})

it('rounds crop boundaries outward in original oriented display coordinates', async () => {
  expect(visualCrop(101, 51, { x: 0.5, y: 0.5, width: 0.001, height: 0.001 })).toEqual({
    x: 50,
    y: 25,
    width: 1,
    height: 1,
  })
  const media = {
    id: 'photo',
    name: 'Photo',
    mediaType: 'image',
    mediaStatus: 'ready',
    runtime: { bunny: { imageClip: bitmap } },
  }
  mocks.getMediaItem.mockReturnValue(media)
  const result = await executeViewMedia(
    {
      items: [
        {
          source: { kind: 'media', mediaId: 'photo' },
          region: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
        },
      ],
    },
    context,
  )
  expect(result).toMatchObject({
    success: true,
    output: '',
    attachIds: [{ type: 'image', image: { id: 'observed_1' } }],
  })
  expect(mocks.draw).toHaveBeenCalledWith(bitmap, 2000, 1000, 2000, 1000, 0, 0, 2000, 1000)
  expect(staged[0]!.description).toContain('x=0.5')
  expect(mocks.bitmapClose).not.toHaveBeenCalled()
})

it('uses committed user references and original orientation for attachment observations', async () => {
  const image = agentImageFixture('a', 'user', 'project')
  const read = vi
    .spyOn(AgentSessionStore.prototype, 'readImage')
    .mockResolvedValue({ ...image, recordKind: 'user_attachment' } as never)
  mocks.readAttachment.mockResolvedValue(new Blob(['original'], { type: 'image/jpeg' }))
  const result = await executeViewMedia(
    { items: [{ source: { kind: 'attachment', attachmentId: 'a' } }] },
    context,
  )
  expect(result.success).toBe(true)
  expect(read).toHaveBeenCalledWith({ id: 'session', userId: 'user', projectId: 'project' }, 'a', {
    requireUserReference: true,
  })
  expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
    imageOrientation: 'from-image',
  })
  expect(mocks.bitmapClose).toHaveBeenCalledOnce()
  expect(staged[0]).toMatchObject({ width: 2048, height: 1024 })
})

it('samples half-open editing ticks, deduplicates actual video frames and labels requested timecodes', async () => {
  expect(
    viewSampleFrames(
      { timeRange: { start: '00:00:10+00', end: '00:00:13+00', frameCount: 3 } },
      400,
    ),
  ).toEqual([300, 345, 389])
  expect(
    viewSampleFrames({ timeRange: { start: '00:00:00+00', end: '00:00:00+01' } }, 300),
  ).toEqual([0])
  mocks.getMediaItem.mockReturnValue(video())
  const result = await executeViewMedia(
    {
      items: [
        {
          source: { kind: 'media', mediaId: 'video' },
          timeRange: { start: '00:00:00+00', end: '00:00:00+10' },
        },
      ],
    },
    context,
  )
  expect(result.success).toBe(true)
  expect(result.attachIds).toHaveLength(1)
  expect(result.output).toContain('请求 9 帧，去重后返回 1 帧')
  expect(staged[0]!.description).toContain('at=00:00:00+00')
  expect(mocks.sampleDraw).toHaveBeenCalledOnce()
  expect(mocks.sampleClose).toHaveBeenCalledTimes(9)
})

it('keeps successful targets but drops an entire range if any necessary frame fails', async () => {
  const media = video(),
    bunny = media.runtime.bunny.bunnyMedia
  bunny.videoGetSample = () =>
    vi
      .fn()
      .mockResolvedValueOnce({
        timestamp: 2,
        duration: 1,
        displayWidth: 10,
        displayHeight: 10,
        drawWithFit: mocks.sampleDraw,
        close: mocks.sampleClose,
      })
      .mockResolvedValue(null)
  mocks.getMediaItem.mockImplementation((id) => (id === 'video' ? media : undefined))
  const result = await executeViewMedia(
    {
      items: [
        {
          source: { kind: 'media', mediaId: 'video' },
          timeRange: { start: '00:00:00+00', end: '00:00:02+00', frameCount: 2 },
        },
        { source: { kind: 'media', mediaId: 'missing' } },
      ],
    },
    context,
  )
  expect(result.success).toBe(false)
  expect(result.output).toContain('frame_unavailable')
  expect(result.output).toContain('media_not_found')
  expect(staged).toEqual([])
})

it.each([
  { source: { kind: 'media', mediaId: 'video' } },
  { source: { kind: 'media', mediaId: 'video' }, at: '00:00:10+00' },
  {
    source: { kind: 'media', mediaId: 'video' },
    timeRange: { start: '00:00:02+00', end: '00:00:01+00' },
  },
])('rejects missing time and out-of-range video targets: %j', async (item) => {
  mocks.getMediaItem.mockReturnValue(video())
  expect((await executeViewMedia({ items: [item] }, context)).success).toBe(false)
  expect(staged).toEqual([])
})

it('shares one timeline snapshot across items without deduplicating composition frames', async () => {
  const result = await executeViewTimeline(
    {
      items: [
        { at: '00:00:00+00' },
        { timeRange: { start: '00:00:01+00', end: '00:00:02+00', frameCount: 2 } },
      ],
    },
    context,
  )
  expect(result.attachIds).toHaveLength(3)
  expect(mocks.createCapture).toHaveBeenCalledOnce()
  expect(mocks.render.mock.calls.map(([frame]) => frame)).toEqual([0, 30, 59])
  expect(staged.map((i) => i.description)).toEqual([
    '当前工程时间轴，at=00:00:00+00，完整画面。',
    '当前工程时间轴，at=00:00:01+00，完整画面。',
    '当前工程时间轴，at=00:00:01+29，完整画面。',
  ])
  expect(mocks.dispose).toHaveBeenCalledOnce()
})

it('cancels a pending native video decode promptly and closes its late sample', async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => {
      resolve = done
    }),
    media = video()
  media.runtime.bunny.bunnyMedia.videoGetSample = () => vi.fn().mockReturnValue(pending)
  mocks.getMediaItem.mockReturnValue(media)
  const running = executeViewMedia(
    { items: [{ source: { kind: 'media', mediaId: 'video' }, at: '00:00:00+00' }] },
    context,
  )
  await vi.waitFor(() =>
    expect(media.runtime.bunny.bunnyMedia.getVideoDisplayRange).toHaveBeenCalled(),
  )
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  expect((await running).output).toContain('cancelled')
  // 原生解码在取消后才返回，迟到的视频帧仍须关闭且不能进入结果。
  resolve({ close: mocks.sampleClose })
  await Promise.resolve()
  await Promise.resolve()
  expect(mocks.sampleClose).toHaveBeenCalledOnce()
  expect(staged).toEqual([])
})
