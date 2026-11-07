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
import { MediaIndexTaskSubmitResolver } from '@/core/jobs/resolvers/MediaIndexTaskSubmitResolver'
import {
  buildSegmentsFromBoundaries,
  createVideoSegmentExportsRequest,
  createVideoSegmentOssUploadsRequest,
  createMediaIndexTaskSubmitRequest,
} from '@/core/jobs/resolvers/mediaIndexingShared'
import { exportMediaItem, exportTimelineItem, exportVideoFrames } from '@/core/utils/mediaExporter'
import { CfBailianTempFileUploader } from '@/core/utils/cfBailianTempFileUploader'
import { RENDERER_FPS } from '@/core/mediabunny/constant'

vi.mock('@/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: { saveMetaFile: vi.fn(), loadMediaFile: vi.fn() },
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
  exportMediaItem: vi.fn(),
  exportTimelineItem: vi.fn(),
  exportVideoFrames: vi.fn(),
}))
vi.mock('@/core/utils/cfBailianTempFileUploader', () => ({
  CfBailianTempFileUploader: { uploadBlob: vi.fn() },
}))
vi.mock('@/core/ai-tasks/taskApi', () => ({
  submitAiTask: vi.fn(),
  createAiTaskIdempotencyKey: () => 'indexing-test',
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
  vi.mocked(globalMetaFileManager.loadMediaFile).mockResolvedValue(
    new File(['original-image'], 'source.jpg', { type: 'image/jpeg' }),
  )
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
      id: 'media_music',
      ext: '.wav',
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
    expect(CfBailianTempFileUploader.uploadBlob).not.toHaveBeenCalled()
  })
})

describe('video indexing exports', () => {
  it('uses a supplied canonical plan without running local scene detection', async () => {
    const item = {
      id: 'media_canonical_video',
      ext: '.mov',
      name: 'canonical.mov',
      mediaType: 'video',
      runtime: { bunny: { originalWidth: 1920, originalHeight: 1080 } },
    } as unknown as UnifiedMediaItemData
    const module = {
      getMediaItem: () => item,
      getProjectId: () => 'project',
      ensureMediaReady: vi.fn(),
    }
    const canonicalSegments = [
      {
        mediaItemId: item.id,
        segmentKey: 'segment-0003-S-000090-E-000150',
        segmentIndex: 3,
        startFrame: 90,
        endFrame: 150,
        durationN: 60,
      },
    ]
    const request = createVideoSegmentExportsRequest(item.id, undefined, canonicalSegments)
    const ctx = context(request)
    const resolver = new VideoSegmentExportsResolver(module)

    await expect(resolver.getDependencies(ctx)).resolves.toEqual([])
    const result = await resolver.resolve(ctx)

    expect(ctx.ensure).not.toHaveBeenCalled()
    expect(result.exportPlans[0].segment).toEqual(canonicalSegments[0])
  })

  it('uploads short-segment frames and long-segment videos using their own export plans', async () => {
    const item = {
      id: 'media_video',
      ext: '.mov',
      name: 'Renamed video.webm',
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
    vi.mocked(CfBailianTempFileUploader.uploadBlob).mockImplementation(async (_, options) => ({
      success: true,
      url: `https://upload.example/${options.purpose}/${options.fileName}`,
    }))
    const uploadCtx = context(createVideoSegmentOssUploadsRequest(item.id))
    vi.mocked(uploadCtx.ensure).mockResolvedValue(plans)

    const result = await new VideoSegmentOssUploadsResolver(module).resolve(uploadCtx)

    expect(result.segments).toMatchObject([
      {
        segmentIndex: 0,
        sourceType: 'image_urls',
        taggingImageUrls: frames.map(
          (_, i) => `https://upload.example/tagging/media_video-segment-0000-frame-0${i}.png`,
        ),
        imageTimecodes: expect.any(Array),
        embeddingVideoUrl: 'https://upload.example/embedding/media_video-segment-0000.mp4',
      },
      {
        segmentIndex: 1,
        sourceType: 'video_url',
        taggingOssUrl: 'https://upload.example/tagging/media_video-segment-0001.mp4',
        embeddingOssUrl: 'https://upload.example/embedding/media_video-segment-0001.mp4',
      },
    ])
    expect(exportTimelineItem).toHaveBeenCalledTimes(2)
    expect(exportVideoFrames).toHaveBeenCalledOnce()
    expect(CfBailianTempFileUploader.uploadBlob).toHaveBeenCalledTimes(7)
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

describe('image indexing exports', () => {
  it('uploads PNG exports using the media ID and submits the original display name separately', async () => {
    const item = {
      id: 'media_image',
      ext: '.jpg',
      name: 'Renamed image.gif',
      mediaType: 'image',
      createdAt: '2026-10-15T00:00:00.000Z',
      runtime: { bunny: { originalWidth: 100, originalHeight: 100 } },
    } as UnifiedMediaItemData
    const module = {
      getMediaItem: () => item,
      getProjectId: () => 'project',
      ensureMediaReady: vi.fn(),
    }
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(exportMediaItem).mockResolvedValue(imageBlob)
    vi.mocked(CfBailianTempFileUploader.uploadBlob).mockImplementation(async (_, options) => ({
      success: true,
      url: `https://upload.example/${options.purpose}/${options.fileName}`,
    }))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            asset_id: 'asset-image',
            manifest_id: 'manifest-image',
            content_sha256: 'a'.repeat(64),
            media_kind: 'image',
            segment_plan_hash: 'b'.repeat(64),
            status: 'missing',
            task_id: null,
            canonical_segment_plan: [{ segment_key: 'image' }],
            missing_segments: [{ segment_key: 'image', point_id: 'point-image' }],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            manifest_id: 'manifest-image',
            task_id: 'task-image',
            status: 'processing',
            submitted_segments: ['image'],
          }),
        ),
    )
    const ctx = context(createMediaIndexTaskSubmitRequest(item.id))

    await expect(new MediaIndexTaskSubmitResolver(module).resolve(ctx)).resolves.toEqual({
      mediaId: item.id,
      taskId: 'task-image',
    })

    expect(item.metadata?.indexing?.failedSegmentCount).toBe(0)

    expect(CfBailianTempFileUploader.uploadBlob).toHaveBeenCalledTimes(2)
    expect(CfBailianTempFileUploader.uploadBlob).toHaveBeenCalledWith(
      imageBlob,
      { capability: 'indexing', purpose: 'tagging', fileName: 'media_image.png' },
      expect.any(Function),
      ctx.signal,
    )
    expect(globalMetaFileManager.loadMediaFile).toHaveBeenCalledWith(item)
  })

  it('resolves a completed video manifest before uploading any segment', async () => {
    const item = {
      id: 'media_video',
      ext: '.mov',
      name: 'shared.mov',
      mediaType: 'video',
      createdAt: '2026-10-15T00:00:00.000Z',
      runtime: {},
    } as UnifiedMediaItemData
    const module = {
      getMediaItem: () => item,
      getProjectId: () => 'project-b',
      ensureMediaReady: vi.fn(),
    }
    vi.mocked(CfBailianTempFileUploader.uploadBlob).mockResolvedValue({
      success: true,
      url: 'https://upload.example/unused',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          asset_id: 'asset-shared',
          manifest_id: 'manifest-shared',
          content_sha256: 'c'.repeat(64),
          media_kind: 'video',
          segment_plan_hash: 'd'.repeat(64),
          status: 'completed',
          task_id: null,
          indexed_at: '2026-11-07T00:00:00.000Z',
          canonical_segment_plan: [
            {
              segment_key: 'segment-0000-S-000000-E-000030',
              segment_index: 0,
              start_frame: 0,
              end_frame: 30,
              start_timecode: '00:00:00+00',
              end_timecode: '00:00:01+00',
              duration_n: 30,
            },
          ],
          segment_summaries: [
            {
              segment_index: 0,
              start_timecode: '00:00:00+00',
              end_timecode: '00:00:01+00',
              title: 'Shared shot',
              summary: 'Shared summary',
            },
          ],
          missing_segments: [],
          summary: { title: 'Shared video', summary: 'Shared video summary' },
        }),
      ),
    )
    const request = createMediaIndexTaskSubmitRequest(item.id)
    const ctx = context(request)
    vi.mocked(ctx.ensure).mockResolvedValue({
      mediaId: item.id,
      exportPlans: [
        {
          exportKind: 'video',
          segment: { mediaItemId: item.id, segmentIndex: 0, startFrame: 0, endFrame: 30, durationN: 30 },
          fileName: 'segment.mp4',
          timelineItemId: 'timeline-1',
        },
      ],
      timelineItems: {},
    })

    await expect(new MediaIndexTaskSubmitResolver(module).resolve(ctx)).resolves.toMatchObject({
      mediaId: item.id,
      completed: true,
    })
    expect(item.metadata?.indexing).toMatchObject({
      indexStatus: 'completed',
      indexedAt: '2026-11-07T00:00:00.000Z',
      assetId: 'asset-shared',
      manifestId: 'manifest-shared',
    })
    expect(ctx.ensure).not.toHaveBeenCalled()
    expect(CfBailianTempFileUploader.uploadBlob).not.toHaveBeenCalled()
  })
})
