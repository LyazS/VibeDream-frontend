import { beforeEach, expect, it, vi } from 'vitest'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { prepareEffectPackageResources } from '@/core/effect-package/runtime/prepareEffectPackageResources'
import { TimelineFrameCaptureSession } from '@/core/utils/timelineFrameCapture'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  loadSampledResource: vi.fn(),
  ensureReady: vi.fn(),
  getReadyPackage: vi.fn(),
  render: vi.fn(),
  rendererOptions: vi.fn(),
  toBlob: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('@/core/managers/filesystem/fileSystemService', () => ({
  fileSystemService: { readFile: mocks.readFile },
}))
vi.mock('@/core/effect-package/runtime/sampledResourceLoader', () => ({
  loadSampledResource: mocks.loadSampledResource,
}))
vi.mock('@/core/effect-template/EffectTemplateRegistry', () => ({
  effectTemplateRegistry: {
    ensureReady: mocks.ensureReady,
    getReadyPackage: mocks.getReadyPackage,
  },
}))
vi.mock('@/core/bunnyUtils/timelineItemSetup', () => ({ setupTimelineItemBunny: vi.fn() }))
vi.mock('@/core/timelineitem/runtime/factory', () => ({
  TimelineItemFactory: { clone: (item: unknown) => structuredClone(item) },
}))
vi.mock('@/core/webgl2/transition/TransitionEdgeFrameResolver', () => ({
  TransitionEdgeFrameResolver: class {
    async prepareItems() {}
  },
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

function effectPackage() {
  return {
    effectPackageId: 'transition/fade@1.0.0',
    textResourcePaths: new Map([['fade.frag', '/effects/fade.frag']]),
    textResources: new Map<string, string>(),
    pendingTextLoads: new Map<string, Promise<string>>(),
    sampledResourceDescriptors: new Map([
      [
        'noise.png',
        { absolutePath: '/effects/noise.png', dimension: '2d', resourceType: 'image-2d' },
      ],
    ]),
    sampledResources: new Map(),
    pendingSampledResourceLoads: new Map(),
  } as LoadedEffectPackage
}

function session() {
  const left = {
    id: 'left',
    mediaType: 'image',
    mediaItemId: 'image',
    trackId: 'track',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: 30,
      clipStartTime: 0,
      clipEndTime: 30,
    },
    baseRenderConfig: { visual: {} },
    exRenderConfig: {
      transition: {
        effectPackageId: 'transition/fade@1.0.0',
        templateId: 'fade',
        packageVersion: '1.0.0',
        catalogVersion: 'catalog-v1',
        durationFrames: 10,
        params: {},
      },
    },
    runtime: { exRenderConfig: {} },
  } as UnifiedTimelineItemData<'image'>
  const right = structuredClone(left)
  right.id = 'right'
  right.timeRange.timelineStartTime = 30
  right.timeRange.timelineEndTime = 60
  right.exRenderConfig = {}
  return new TimelineFrameCaptureSession({
    videoWidth: 1920,
    videoHeight: 1080,
    timelineItems: [left, right],
    tracks: [{ id: 'track', isVisible: true, isMuted: false }],
    getMediaItem: () => ({}) as UnifiedMediaItemData,
    getAsset: () => undefined,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(setupTimelineItemBunny).mockResolvedValue(undefined)
  mocks.ensureReady.mockResolvedValue(undefined)
  mocks.readFile.mockResolvedValue('shader')
  mocks.loadSampledResource.mockResolvedValue({ kind: 'image-2d' })
  mocks.toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob(['frame'])))
})

it('waits for cold transition shaders and textures before rendering and capturing', async () => {
  const loaded = effectPackage()
  const shader = deferred<string>()
  const texture = deferred<{ kind: string }>()
  mocks.getReadyPackage.mockReturnValue(loaded)
  mocks.readFile.mockReturnValue(shader.promise)
  mocks.loadSampledResource.mockReturnValue(texture.promise)

  const captureSession = session()
  const capture = captureSession.captureFrame(29)
  await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalledOnce())
  expect(mocks.render).not.toHaveBeenCalled()
  expect(mocks.toBlob).not.toHaveBeenCalled()
  shader.resolve('shader')
  await vi.waitFor(() => expect(loaded.textResources.get('fade.frag')).toBe('shader'))
  expect(mocks.render).not.toHaveBeenCalled()
  texture.resolve({ kind: 'image-2d' })
  await expect(capture).resolves.toBeInstanceOf(Blob)
  expect(mocks.ensureReady).toHaveBeenCalledWith({
    effectType: 'transition',
    effectPackageId: 'transition/fade@1.0.0',
    templateId: 'fade',
    packageVersion: '1.0.0',
    catalogVersion: 'catalog-v1',
  })
  expect(mocks.render).toHaveBeenCalledOnce()
  expect(mocks.toBlob).toHaveBeenCalledOnce()
  await captureSession.dispose()
})

it.each(['missing package', 'missing texture', 'failed shader'])(
  'does not save an incomplete frame on %s and disposes the renderer',
  async (failure) => {
    mocks.getReadyPackage.mockReturnValue(failure === 'missing package' ? null : effectPackage())
    if (failure === 'missing texture') mocks.loadSampledResource.mockResolvedValue(null)
    if (failure === 'failed shader') mocks.readFile.mockRejectedValue(new Error('read failed'))
    await expect(session().captureFrame(29)).rejects.toThrow(
      failure === 'missing package'
        ? '效果包未就绪'
        : failure === 'missing texture'
          ? '效果包资源加载失败'
          : 'read failed',
    )
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.toBlob).not.toHaveBeenCalled()
    expect(mocks.dispose).toHaveBeenCalledOnce()
  },
)

it('shares an in-progress shader load with preview and reuses cached text', async () => {
  const loaded = effectPackage()
  const shader = deferred<string>()
  loaded.textResources.set('cached.frag', 'cached shader')
  loaded.textResourcePaths.set('cached.frag', '/effects/cached.frag')
  loaded.pendingTextLoads.set('fade.frag', shader.promise)
  let finished = false
  const preparation = prepareEffectPackageResources(loaded).then(() => (finished = true))
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(mocks.readFile).not.toHaveBeenCalled()
  loaded.textResources.set('fade.frag', 'shader')
  shader.resolve('shader')
  await preparation
  expect(finished).toBe(true)
})

// 用可控异步等待模拟截帧期间继续编辑，后续帧仍须读取最初快照。
it('freezes nested edits, media metadata, canvas and track visibility before any async setup', async () => {
  const gate = deferred<void>()
  vi.mocked(setupTimelineItemBunny).mockImplementationOnce(async () => {
    await gate.promise
  })
  const item = {
    id: 'text',
    mediaType: 'text',
    mediaItemId: null,
    trackId: 'track',
    timeRange: { timelineStartTime: 0, timelineEndTime: 60 },
    baseRenderConfig: { text: { content: 'original caption' } },
    exRenderConfig: {},
    runtime: { exRenderConfig: {} },
  } as unknown as UnifiedTimelineItemData<'text'>
  const track = { id: 'track', isVisible: true, isMuted: false }
  const config = {
    videoWidth: 1920,
    videoHeight: 1080,
    timelineItems: [item],
    tracks: [track],
    getMediaItem: () => undefined,
    getAsset: () => undefined,
  }
  const capture = new TimelineFrameCaptureSession(config)
  const pending = capture.captureFrame(0)
  item.baseRenderConfig.text.content = 'subsequent edit'
  track.isVisible = false
  config.videoWidth = 100
  gate.resolve()
  await pending
  const rendered = mocks.render.mock.calls[0]![0]
  expect(rendered[0].baseRenderConfig.text.content).toBe('original caption')
  expect(mocks.rendererOptions.mock.calls[0]![0].width).toBe(1920)
  expect(mocks.rendererOptions.mock.calls[0]![0].getTrack('track')).toEqual({ isVisible: true })
  await capture.captureFrame(30)
  expect(mocks.render.mock.calls[1]![0][0].baseRenderConfig.text.content).toBe('original caption')
  await capture.dispose()
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
          exRenderConfig: {},
          runtime: { exRenderConfig: {} },
        } as UnifiedTimelineItemData<'video'>,
      ],
      getMediaItem: () => ({ id: 'media', runtime: {} }) as UnifiedMediaItemData,
      getAsset: () => undefined,
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
        exRenderConfig: {},
        runtime: { exRenderConfig: {} },
      } as UnifiedTimelineItemData<'video'>,
    ],
    getMediaItem: () => ({ id: 'media', runtime: {} }) as UnifiedMediaItemData,
    getAsset: () => undefined,
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
    exRenderConfig: {},
    runtime: { exRenderConfig: {} },
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
    getAsset: () => undefined,
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

it('snapshots library media outside the timeline without retaining editable originals or cloning borrowed bitmaps', async () => {
  const close = vi.fn()
  const bitmap = { close }
  const media = {
    id: 'off-timeline',
    assetKind: 'media',
    name: 'original',
    runtime: { bunny: { imageClip: bitmap } },
  } as unknown as UnifiedMediaItemData
  const capture = new TimelineFrameCaptureSession({
    videoWidth: 100,
    videoHeight: 100,
    timelineItems: [],
    tracks: [],
    assets: [media],
    getMediaItem: () => undefined,
    getAsset: () => media,
  })
  media.name = 'later edit'
  media.runtime.bunny!.imageClip = {} as ImageBitmap
  await capture.captureFrame(0)
  const captured = mocks.rendererOptions.mock.calls[0]![0].getAsset(media.id)
  expect(captured).not.toBe(media)
  expect(captured.name).toBe('original')
  expect(captured.runtime.bunny.imageClip).toBe(bitmap)
  await capture.dispose()
  expect(close).not.toHaveBeenCalled()
})
