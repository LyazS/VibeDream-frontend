import { beforeEach, expect, it, vi } from 'vitest'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
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
