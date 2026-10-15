import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { createResourceNode, type ResourceRequest } from '@/core/jobs/ResourceTypes'
import type { ResolveContext } from '@/core/jobs/ResourceResolver'
import {
  createMusicStructureAnalysisRequest,
  MusicStructureAnalysisResolver,
} from '@/core/jobs/resolvers/MusicStructureAnalysisResolver'
import { analyzeMusicStructure } from '@/core/utils/music-analysis'
import { VideoSegmentExportsResolver } from '@/core/jobs/resolvers/VideoSegmentExportsResolver'
import { VideoSegmentOssUploadsResolver } from '@/core/jobs/resolvers/VideoSegmentOssUploadsResolver'
import {
  buildSegmentsFromBoundaries,
  createVideoSegmentExportsRequest,
  createVideoSegmentOssUploadsRequest,
} from '@/core/jobs/resolvers/mediaIndexingShared'
import { exportTimelineItem, exportVideoFrames } from '@/core/utils/mediaExporter'
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'
import { RENDERER_FPS } from '@/core/mediabunny/constant'

vi.mock('@/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: { saveMetaFile: vi.fn() },
}))
vi.mock('@/core/utils/music-analysis', async () => ({
  ...(await import('@/core/utils/music-analysis/types')),
  analyzeMusicStructure: vi.fn(),
}))
vi.mock('@/core/timelineitem/model/timelineItem', () => ({
  createDefaultTimelineExtraRenderConfig: () => ({}),
}))
vi.mock('@/core/timelineitem/queries', () => ({
  TimelineItemQueries: { isVideoTimelineItem: () => true },
}))
vi.mock('@/core/utils/mediaExporter', () => ({
  exportTimelineItem: vi.fn(),
  exportVideoFrames: vi.fn(),
}))
vi.mock('@/core/utils/cloudflareTemporaryFileUploader', () => ({
  CloudflareTemporaryFileUploader: { uploadBlob: vi.fn() },
}))

function context<T>(request: ResourceRequest<T>): ResolveContext<T> {
  return {
    input: request.input,
    node: createResourceNode(request),
    signal: new AbortController().signal,
    ensure: vi.fn(),
    update: vi.fn(),
    emit: vi.fn(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(globalMetaFileManager.saveMetaFile).mockResolvedValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('local music analysis', () => {
  it('analyzes the original audio and persists structure and anchors without uploading it', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Unexpected network request')
    })
    vi.stubGlobal('fetch', fetch)
    const file = new File(['audio'], 'music.wav', { type: 'audio/wav' })
    const item = {
      id: 'music.wav',
      name: 'music.wav',
      mediaType: 'audio',
      mediaStatus: 'ready',
      runtime: {
        bunny: { bunnyMedia: { ready: Promise.resolve(), duration: 120, getOriFile: () => file } },
      },
    } as unknown as UnifiedMediaItemData
    const analysis = {
      input: { durationSeconds: 120, sampleRate: 44_100 as const },
      bpm: 120,
      meter: 4,
      beats: [0, 0.5],
      downbeats: [0],
      beatPositions: [1, 2],
      segments: [{ start: 0, end: 120, label: 'verse' }],
      editingAnchors: [
        {
          id: 'anchor-1',
          time: 0,
          eventLabel: 'section_entry',
          roles: ['section_entry'],
          strength: 1,
        },
      ],
    }
    vi.mocked(analyzeMusicStructure).mockResolvedValue(analysis)
    const ctx = context(createMusicStructureAnalysisRequest(item.id))
    const resolver = new MusicStructureAnalysisResolver({ getMediaItem: () => item })

    expect(await resolver.getDependencies(ctx)).toMatchObject([{ type: 'media-ready' }])
    const result = await resolver.resolve(ctx)

    expect(analyzeMusicStructure).toHaveBeenCalledWith(file, 120, {
      signal: ctx.signal,
      onProgress: expect.any(Function),
    })
    expect(result.musicAnalysis).toMatchObject({ schemaVersion: 2, ...analysis })
    expect(item.metadata?.musicAnalysis).toBe(result.musicAnalysis)
    expect(globalMetaFileManager.saveMetaFile).toHaveBeenCalledExactlyOnceWith(item)
    expect(fetch).not.toHaveBeenCalled()
    expect(CloudflareTemporaryFileUploader.uploadBlob).not.toHaveBeenCalled()
  })
})

describe('video indexing exports', () => {
  it('uploads short-segment frames and long-segment videos using their own export plans', async () => {
    const item = {
      id: 'video.mp4',
      name: 'video.mp4',
      mediaType: 'video',
      runtime: { bunny: { originalWidth: 1920, originalHeight: 1080 } },
    } as unknown as UnifiedMediaItemData
    const module = {
      getMediaItem: () => item,
      getProjectId: () => 'project',
      ensureMediaReady: vi.fn(),
    }
    const segments = buildSegmentsFromBoundaries(item.id, 10 * RENDERER_FPS, [
      BigInt(2 * RENDERER_FPS),
    ])
    const exportCtx = context(createVideoSegmentExportsRequest(item.id))
    vi.mocked(exportCtx.ensure).mockResolvedValue({ mediaId: item.id, segments })
    const plans = await new VideoSegmentExportsResolver(module).resolve(exportCtx)
    const videoBlob = new Blob(['video'])
    const frames = Array.from({ length: 4 }, () => new Blob(['frame']))
    vi.mocked(exportTimelineItem).mockResolvedValue(videoBlob)
    vi.mocked(exportVideoFrames).mockResolvedValue(frames)
    vi.mocked(CloudflareTemporaryFileUploader.uploadBlob).mockImplementation(
      async (_, options) => ({
        success: true,
        url: `https://upload.example/${options.purpose}/${options.fileName}`,
      }),
    )
    const uploadCtx = context(createVideoSegmentOssUploadsRequest(item.id))
    vi.mocked(uploadCtx.ensure).mockResolvedValue(plans)

    const result = await new VideoSegmentOssUploadsResolver(module).resolve(uploadCtx)

    expect(result.segments).toMatchObject([
      {
        segmentIndex: 0,
        sourceType: 'image_urls',
        taggingImageUrls: frames.map(
          (_, i) => `https://upload.example/tagging/video-segment-0000-frame-0${i}.png`,
        ),
        imageTimecodes: expect.any(Array),
        embeddingVideoUrl: 'https://upload.example/embedding/video-segment-0000.mp4',
      },
      {
        segmentIndex: 1,
        sourceType: 'video_url',
        taggingOssUrl: 'https://upload.example/tagging/video-segment-0001.mp4',
        embeddingOssUrl: 'https://upload.example/embedding/video-segment-0001.mp4',
      },
    ])
    expect(exportTimelineItem).toHaveBeenCalledTimes(2)
    expect(exportVideoFrames).toHaveBeenCalledOnce()
    expect(CloudflareTemporaryFileUploader.uploadBlob).toHaveBeenCalledTimes(7)
    expect(
      vi.mocked(exportTimelineItem).mock.calls.map(([options]) => options.timelineItem.timeRange),
    ).toEqual([
      {
        timelineStartTime: 0,
        timelineEndTime: 2 * RENDERER_FPS,
        clipStartTime: 0,
        clipEndTime: 2 * RENDERER_FPS,
      },
      {
        timelineStartTime: 0,
        timelineEndTime: 8 * RENDERER_FPS,
        clipStartTime: 2 * RENDERER_FPS,
        clipEndTime: 10 * RENDERER_FPS,
      },
    ])
  })
})
