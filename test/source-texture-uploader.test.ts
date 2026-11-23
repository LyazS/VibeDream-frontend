import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceTextureUploader } from '@/core/webgl2/renderer/SourceTextureUploader'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { FrameData, TextureResource } from '@/core/webgl2/types'
import type { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'

vi.mock('@/core/timelineitem/queries', () => ({
  TimelineItemQueries: {
    isVideoTimelineItem: (item: { mediaType: string }) => item.mediaType === 'video',
    isImageTimelineItem: (item: { mediaType: string }) => item.mediaType === 'image',
  },
}))

class FakeVideoFrame {
  readonly displayWidth: number
  readonly displayHeight: number
  readonly close = vi.fn()

  constructor(width = 1920, height = 1080) {
    this.displayWidth = width
    this.displayHeight = height
  }
}

function createRuntime() {
  const resources = new Map<string, TextureResource>()
  const uploadSource = vi.fn((id: string, _source: unknown, width: number, height: number) => {
    const resource: TextureResource = {
      id,
      texture: {} as WebGLTexture,
      target: '2d',
      width,
      height,
    }
    resources.set(id, resource)
    return resource
  })
  const remove = vi.fn((id: string) => {
    resources.delete(id)
  })

  const runtime = {
    textures: {
      uploadSource,
      remove,
    },
  } as unknown as WebGL2Runtime

  return { runtime, resources, uploadSource, remove }
}

function createVideoItem(id = 'clip-1'): UnifiedTimelineItemData<'video'> {
  return { id, mediaType: 'video' } as UnifiedTimelineItemData<'video'>
}

function createImageItem(id = 'clip-1'): UnifiedTimelineItemData<'image'> {
  return {
    id,
    mediaType: 'image',
    mediaItemId: 'media-1',
  } as UnifiedTimelineItemData<'image'>
}

function createFrameData(frameNumber: number): FrameData {
  return {
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: 90,
      clipStartTime: 0,
      clipEndTime: 90,
    },
    frameNumber,
    clockwiseRotation: 0,
    videoSample: {
      toVideoFrame: () => new FakeVideoFrame(),
    } as unknown as FrameData['videoSample'],
  }
}

describe('SourceTextureUploader', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoFrame', FakeVideoFrame)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses a stable source texture ID before the first upload', () => {
    const { runtime } = createRuntime()
    const uploader = new SourceTextureUploader(runtime, () => undefined)

    expect(uploader.getTextureIdForItem('clip-1')).toBe('source:clip-1')
  })

  it('reuses the same video resource for the same frame and uploads changed frames', () => {
    const { runtime, uploadSource } = createRuntime()
    const uploader = new SourceTextureUploader(runtime, () => undefined)
    const item = createVideoItem()
    const frameMap = new Map<string, FrameData>()
    const firstFrame = createFrameData(10)
    frameMap.set(item.id, firstFrame)

    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(1)

    frameMap.set(item.id, createFrameData(11))
    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(2)
    expect(uploadSource).toHaveBeenLastCalledWith(
      'source:clip-1',
      expect.any(FakeVideoFrame),
      1920,
      1080,
    )
  })

  it('uses image identity and dimensions for static source cache hits', () => {
    const { runtime, uploadSource } = createRuntime()
    let imageClip = { width: 640, height: 360 } as ImageBitmap
    const mediaItem = {
      runtime: { bunny: { imageClip } },
    } as unknown as UnifiedMediaItemData
    const uploader = new SourceTextureUploader(runtime, () => mediaItem)
    const item = createImageItem()
    const frameMap = new Map<string, FrameData>()

    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(1)

    imageClip = { width: 640, height: 360 } as ImageBitmap
    mediaItem.runtime.bunny!.imageClip = imageClip
    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(2)

    imageClip = { width: 1280, height: 720 } as ImageBitmap
    mediaItem.runtime.bunny!.imageClip = imageClip
    expect(uploader.ensureTextureForItem(item, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(3)
  })

  it('invalidates the entry when an item switches between video and image', () => {
    const { runtime, uploadSource } = createRuntime()
    let imageClip = { width: 1920, height: 1080 } as ImageBitmap
    const mediaItem = {
      runtime: { bunny: { imageClip } },
    } as unknown as UnifiedMediaItemData
    const uploader = new SourceTextureUploader(runtime, () => mediaItem)
    const frameMap = new Map<string, FrameData>()
    const videoItem = createVideoItem()
    const imageItem = createImageItem()

    frameMap.set(videoItem.id, createFrameData(1))
    expect(uploader.ensureTextureForItem(videoItem, frameMap)).toBe('source:clip-1')

    expect(uploader.ensureTextureForItem(imageItem, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(2)

    imageClip = { width: 1920, height: 1080 } as ImageBitmap
    mediaItem.runtime.bunny!.imageClip = imageClip
    expect(uploader.ensureTextureForItem(imageItem, frameMap)).toBe('source:clip-1')
    expect(uploadSource).toHaveBeenCalledTimes(3)
  })

  it('removes the matching entry with removeTexture and dispose', () => {
    const { runtime, uploadSource, remove } = createRuntime()
    const uploader = new SourceTextureUploader(runtime, () => undefined)
    const item = createVideoItem()
    const frameMap = new Map<string, FrameData>([[item.id, createFrameData(1)]])

    uploader.ensureTextureForItem(item, frameMap)
    uploader.removeTexture('source:clip-1')
    expect(remove).toHaveBeenCalledWith('source:clip-1')

    uploader.ensureTextureForItem(item, frameMap)
    expect(uploadSource).toHaveBeenCalledTimes(2)

    uploader.dispose()
    expect(remove).toHaveBeenLastCalledWith('source:clip-1')

    uploader.ensureTextureForItem(item, frameMap)
    expect(uploadSource).toHaveBeenCalledTimes(3)
  })
})
