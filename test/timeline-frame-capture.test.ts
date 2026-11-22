import { beforeEach, expect, it, vi } from 'vitest'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { TimelineFrameCaptureSession } from '@/core/utils/timelineFrameCapture'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  rendererOptions: vi.fn(),
  toBlob: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('@/core/managers/filesystem/fileSystemService', () => ({ fileSystemService: {} }))
vi.mock('@/core/bunnyUtils/timelineItemSetup', () => ({ setupTimelineItemBunny: vi.fn() }))
vi.mock('@/core/timelineitem/runtime/factory', () => ({
  TimelineItemFactory: { clone: (item: unknown) => structuredClone(item) },
}))
vi.mock('@/core/utils/WebGLExportRenderer', () => ({
  WebGLExportRenderer: class {
    constructor(options: unknown) {
      mocks.rendererOptions(options)
    }
    canvas = { toBlob: mocks.toBlob }
    render = mocks.render
    dispose = mocks.dispose
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(setupTimelineItemBunny).mockResolvedValue(undefined)
  mocks.toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob(['frame'])))
})

it('fails a visible video frame instead of encoding a blank canvas, but accepts an empty composition', async () => {
  const make = (visible = true) =>
    new TimelineFrameCaptureSession({
      videoWidth: 100,
      videoHeight: 100,
      tracks: [{ id: 'track', isVisible: visible, isMuted: false }],
      timelineItems: [
        {
          id: 'video',
          mediaItemId: 'media',
          mediaType: 'video',
          trackId: 'track',
          timeRange: {
            timelineStartTime: 0,
            timelineEndTime: 60,
            clipStartTime: 0,
            clipEndTime: 60,
          },
          baseRenderConfig: { visual: {} },
          runtime: {},
        } as UnifiedTimelineItemData<'video'>,
      ],
      getMediaItem: () => ({ id: 'media', runtime: {} }) as UnifiedMediaItemData,
    })
  vi.mocked(setupTimelineItemBunny).mockImplementation(async (item) => {
    item.runtime.bunnyClip = {
      tickN: async () => ({ state: 'error', video: null }),
      dispose: async () => {},
    } as never
  })
  const invalid = make()
  await expect(invalid.captureFrame(0)).rejects.toThrow('frame_unavailable')
  expect(mocks.toBlob).not.toHaveBeenCalled()
  await invalid.dispose()
  const blank = make(false)
  await expect(blank.captureFrame(0)).resolves.toBeInstanceOf(Blob)
  await blank.dispose()
})

// 解码和释放都可能迟到；取消必须及时结束，同时关闭最终返回的视频帧。
it('cancels pending frame decoding and closes a late sample without rendering or persisting it', async () => {
  const gate = deferred<{ state: string; video: { close: () => void } }>()
  const tick = vi.fn().mockReturnValue(gate.promise),
    close = vi.fn(),
    dispose = vi.fn().mockReturnValue(new Promise(() => {}))
  vi.mocked(setupTimelineItemBunny).mockImplementation(async (item) => {
    item.runtime.bunnyClip = { tickN: tick, dispose } as never
  })
  const controller = new AbortController()
  const capture = new TimelineFrameCaptureSession({
    videoWidth: 100,
    videoHeight: 100,
    signal: controller.signal,
    tracks: [{ id: 'track', isVisible: true, isMuted: false }],
    timelineItems: [
      {
        id: 'video',
        mediaItemId: 'media',
        mediaType: 'video',
        trackId: 'track',
        timeRange: { timelineStartTime: 0, timelineEndTime: 60 },
        baseRenderConfig: { visual: {} },
        runtime: {},
      } as UnifiedTimelineItemData<'video'>,
    ],
    getMediaItem: () => ({ id: 'media', runtime: {} }) as UnifiedMediaItemData,
  })
  const pending = capture.captureFrame(0)
  await vi.waitFor(() => expect(tick).toHaveBeenCalledOnce())
  controller.abort()
  await expect(pending).rejects.toThrow()
  await capture.dispose()
  gate.resolve({ state: 'success', video: { close } })
  await Promise.resolve()
  await Promise.resolve()
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.render).not.toHaveBeenCalled()
  expect(mocks.toBlob).not.toHaveBeenCalled()
})

it('keeps borrowed media resources and metadata from the initial snapshot across later edits', async () => {
  const gate = deferred<void>(),
    close = vi.fn()
  const originalBitmap = { close },
    replacement = { close: vi.fn() }
  const media = {
    id: 'photo',
    name: 'original',
    runtime: { bunny: { imageClip: originalBitmap } },
  } as unknown as UnifiedMediaItemData
  const getMediaItem = vi.fn(() => media)
  const item = {
    id: 'image',
    mediaItemId: 'photo',
    mediaType: 'image',
    trackId: 'track',
    timeRange: { timelineStartTime: 0, timelineEndTime: 60, clipStartTime: 0, clipEndTime: 60 },
    baseRenderConfig: { visual: {} },
    runtime: {},
  } as UnifiedTimelineItemData<'image'>
  vi.mocked(setupTimelineItemBunny).mockImplementationOnce(async () => {
    await gate.promise
  })
  const capture = new TimelineFrameCaptureSession({
    videoWidth: 100,
    videoHeight: 100,
    timelineItems: [item],
    tracks: [{ id: 'track', isVisible: true, isMuted: false }],
    getMediaItem,
  })
  const pending = capture.captureFrame(0)
  media.name = 'later edit'
  media.runtime.bunny!.imageClip = replacement as ImageBitmap
  gate.resolve()
  await pending
  const options = mocks.rendererOptions.mock.calls[0]![0]
  expect(options.getMediaItem('photo').name).toBe('original')
  expect(options.getMediaItem('photo').runtime.bunny.imageClip).toBe(originalBitmap)
  expect(getMediaItem).toHaveBeenCalledOnce()
  await capture.dispose()
  expect(close).not.toHaveBeenCalled()
})
