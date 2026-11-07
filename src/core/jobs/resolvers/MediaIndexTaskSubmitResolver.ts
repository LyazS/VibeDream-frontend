import { exportMediaItem } from '@/core/utils/mediaExporter'
import type { ImageMediaItem, VideoMediaItem } from '@/core/mediaitem/types'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import { CfBailianTempFileUploader } from '@/core/utils/cfBailianTempFileUploader'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { resolveMediaIndex, submitMediaManifestSegments } from '@/core/agent/services/mediaIndexService'
import { framesToTimecode } from '@/core/utils/timeUtils'
import {
  canResumeMediaIndexingFromRemote,
  createVideoSegmentExportsRequest,
  createMediaIndexTaskSubmitRequest,
  createVideoSegmentOssUploadsRequest,
  getIndexableMediaItem,
  persistMediaItem,
  setIndexingMetadata,
  type MediaIndexTaskSubmitInput,
  type MediaIndexTaskSubmitResult,
  type MediaIndexSegmentInput,
  type MediaIndexingModule,
  type VideoSceneSegment,
  type VideoSegmentExportsResult,
  type VideoSegmentOssUploadsResult,
  MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE,
} from './mediaIndexingShared'

const IMAGE_INDEXING_MAX_SIDE = 768

function videoSegmentKey(segment: {
  segmentKey?: string
  segmentIndex: number
  startFrame: number
  endFrame: number
}): string {
  if (segment.segmentKey) return segment.segmentKey
  return `segment-${String(segment.segmentIndex).padStart(4, '0')}-S-${String(segment.startFrame).padStart(6, '0')}-E-${String(segment.endFrame).padStart(6, '0')}`
}

function segmentPlanFromExports(exportResult: VideoSegmentExportsResult) {
  return exportResult.exportPlans.map(({ segment }) => ({
    segment_key: videoSegmentKey(segment),
    segment_index: segment.segmentIndex,
    start_frame: segment.startFrame,
    end_frame: segment.endFrame,
    start_timecode: framesToTimecode(segment.startFrame),
    end_timecode: framesToTimecode(segment.endFrame),
    duration_n: segment.durationN,
  }))
}

function canonicalSegmentsFromPlan(
  mediaId: string,
  plan: Array<Record<string, unknown>>,
): VideoSceneSegment[] {
  return plan.map((row, index) => {
    const segmentIndex = row.segment_index
    const startFrame = row.start_frame
    const endFrame = row.end_frame
    const segmentKey = row.segment_key
    if (
      typeof segmentKey !== 'string' ||
      !segmentKey ||
      !Number.isSafeInteger(segmentIndex) ||
      !Number.isSafeInteger(startFrame) ||
      !Number.isSafeInteger(endFrame) ||
      Number(segmentIndex) < 0 ||
      Number(startFrame) < 0 ||
      Number(endFrame) <= Number(startFrame)
    ) {
      throw new Error(`服务端 canonical 分片计划无效: index=${index}`)
    }
    return {
      mediaItemId: mediaId,
      segmentKey,
      segmentIndex: Number(segmentIndex),
      startFrame: Number(startFrame),
      endFrame: Number(endFrame),
      durationN:
        typeof row.duration_n === 'number' && Number.isFinite(row.duration_n)
          ? row.duration_n
          : Number(endFrame) - Number(startFrame),
    }
  })
}

function normalizeIndexSummary(value: unknown): { title?: string; summary?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
  return title || summary ? { title: title || undefined, summary: summary || undefined } : undefined
}

const HASH_CHUNK_SIZE = 4 * 1024 * 1024

async function hashFileInMainThread(file: Blob): Promise<string> {
  const hasher = sha256.create()
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        hasher.update(value)
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    for (let offset = 0; offset < file.size; offset += HASH_CHUNK_SIZE) {
      const chunk = await file.slice(offset, offset + HASH_CHUNK_SIZE).arrayBuffer()
      hasher.update(new Uint8Array(chunk))
    }
  }
  return bytesToHex(hasher.digest())
}

async function hashFile(file: File): Promise<string> {
  if (typeof Worker === 'undefined') return hashFileInMainThread(file)

  return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/contentSha256.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<{ hash?: string; error?: string }>) => {
      worker.terminate()
      if (event.data.hash) resolve(event.data.hash)
      else reject(new Error(event.data.error || 'SHA-256 计算失败'))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(event.error || new Error('SHA-256 Worker 失败'))
    }
    worker.postMessage({ file })
  })
}

function buildImageIndexingExportSize(
  mediaItem: ImageMediaItem | VideoMediaItem,
): { outputWidth?: number; outputHeight?: number } | undefined {
  if (mediaItem.mediaType !== 'image') {
    return undefined
  }

  const width = mediaItem.runtime.bunny?.originalWidth
  const height = mediaItem.runtime.bunny?.originalHeight
  if (!width || !height) {
    return {
      outputWidth: IMAGE_INDEXING_MAX_SIDE,
    }
  }

  const maxSide = Math.max(width, height)
  if (maxSide <= IMAGE_INDEXING_MAX_SIDE) {
    return {
      outputWidth: width,
      outputHeight: height,
    }
  }

  const scale = IMAGE_INDEXING_MAX_SIDE / maxSide
  return {
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  }
}

function providerSegments(
  segments: MediaIndexSegmentInput[],
): Array<Record<string, unknown> & { segment_key: string; provider_urls: string[] }> {
  return segments.map((segment) => {
    if (segment.sourceType === 'image_url') {
      return {
        segment_key: 'image',
        provider_urls: [segment.taggingImageUrl, segment.embeddingImageUrl],
        source_type: segment.sourceType,
      }
    }
    const metadata = {
      source_type: segment.sourceType,
      segment_index: segment.segmentIndex,
      start_frame: segment.startFrame,
      end_frame: segment.endFrame,
      start_timecode: segment.startTimecode,
      end_timecode: segment.endTimecode,
      duration_n: segment.durationN,
    }
    if (segment.sourceType === 'image_urls') {
      return {
        segment_key: videoSegmentKey(segment),
        provider_urls: [...segment.taggingImageUrls, segment.embeddingVideoUrl],
        image_timecodes: segment.imageTimecodes,
        ...metadata,
      }
    }
    return {
      segment_key: videoSegmentKey(segment),
      provider_urls: [segment.taggingOssUrl, segment.embeddingOssUrl],
      ...metadata,
    }
  })
}

export class MediaIndexTaskSubmitResolver
  implements ResourceResolver<MediaIndexTaskSubmitInput, MediaIndexTaskSubmitResult>
{
  readonly type = MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: MediaIndexTaskSubmitInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaIndexTaskSubmitInput>,
  ): Promise<MediaIndexTaskSubmitResult | null> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const indexing = mediaItem?.metadata?.indexing
    const taskId = indexing?.taskId
    // 项目重新打开时优先复用仍在处理中的新 Cloudflare 任务，避免再次上传与重复扣费。
    if (
      indexing?.manifestId &&
      canResumeMediaIndexingFromRemote(indexing) &&
      typeof taskId === 'string' &&
      taskId.trim()
    ) {
      return {
        mediaId: ctx.input.mediaId,
        taskId,
      }
    }

    return null
  }

  async getDependencies(
    ctx: ResolveContext<MediaIndexTaskSubmitInput>,
  ): Promise<ResourceRequest[]> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    if (mediaItem?.mediaType === 'video') {
      // 先按内容哈希解析统一索引对象；只有缺少分片时才动态生成分片计划。
      return []
    }
    return []
  }

  async resolve(
    ctx: ResolveContext<MediaIndexTaskSubmitInput>,
  ): Promise<MediaIndexTaskSubmitResult> {
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    ctx.signal.throwIfAborted()
    const sourceFile = await globalMetaFileManager.loadMediaFile(mediaItem)
    const contentSha256 = await hashFile(sourceFile)
    let exportResult: VideoSegmentExportsResult | undefined
    let segmentPlan: Array<Record<string, unknown>> | undefined
    if (mediaItem.mediaType === 'video') {
      segmentPlan = undefined
    } else if (mediaItem.mediaType === 'image') {
      await this.module.ensureMediaReady(mediaItem.id)
      segmentPlan = [{ segment_key: 'image' }]
    } else {
      throw new Error('不支持的索引素材类型')
    }
    let index
    try {
      index = await resolveMediaIndex({
        segmentPlan,
        contentSha256,
        mediaKind: mediaItem.mediaType,
        byteSize: sourceFile.size,
      })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'MEDIA_SEGMENT_PLAN_REQUIRED')) {
        throw error
      }
      exportResult = await ctx.ensure<VideoSegmentExportsResult>(
        createVideoSegmentExportsRequest(ctx.input.mediaId),
      )
      segmentPlan = segmentPlanFromExports(exportResult)
      index = await resolveMediaIndex({
        segmentPlan,
        contentSha256,
        mediaKind: mediaItem.mediaType,
        byteSize: sourceFile.size,
      })
    }
    setIndexingMetadata(mediaItem, {
      mediaKind: mediaItem.mediaType,
      indexStatus: index.status === 'completed' ? 'completed' : 'processing',
      assetId: index.asset_id,
      manifestId: index.manifest_id,
      contentSha256,
      indexRecipeId: 'media-index-recipe-v3.1',
      indexVersion: 'media-index-v3.1',
      segmentPlanHash: index.segment_plan_hash,
      indexedAt: index.indexed_at,
      segmentCount: index.canonical_segment_plan.length,
      // missing_segments are planned work, not failures. Only the completed
      // task result can report the authoritative failed segment count.
      failedSegmentCount: 0,
      summary: normalizeIndexSummary(index.summary),
      segmentSummaries: index.segment_summaries?.map((segment) => ({
        segmentIndex: segment.segment_index,
        startTimecode: segment.start_timecode,
        endTimecode: segment.end_timecode,
        title: segment.title,
        summary: segment.summary,
      })),
    })
    if (index.status === 'completed') {
      await persistMediaItem(mediaItem)
      return {
        mediaId: mediaItem.id,
        taskId: index.task_id || index.manifest_id,
        completed: true,
      }
    }
    if (index.status === 'processing' && index.task_id) {
      setIndexingMetadata(mediaItem, {
        mediaKind: mediaItem.mediaType,
        indexStatus: 'processing',
        taskId: index.task_id,
      })
      await persistMediaItem(mediaItem)
      return { mediaId: mediaItem.id, taskId: index.task_id }
    }
    let segments: MediaIndexSegmentInput[]
    if (mediaItem.mediaType === 'video') {
      const canonicalSegments = canonicalSegmentsFromPlan(
        mediaItem.id,
        index.canonical_segment_plan,
      )
      const uploadResult = await ctx.ensure<VideoSegmentOssUploadsResult>(
        createVideoSegmentOssUploadsRequest(ctx.input.mediaId, undefined, canonicalSegments),
      )
      segments = uploadResult.segments
    } else {
      ctx.update({
        progress: 0.05,
        stage: 'uploading-image',
        message: `正在上传图片素材（打标）: ${mediaItem.name}`,
      })
      const imageBlob = await exportMediaItem({
        mediaItem,
        ...buildImageIndexingExportSize(mediaItem),
      })
      const fileName = `${mediaItem.id}.png`
      console.info('[MediaIdentity] indexing:export-image', {
        id: mediaItem.id,
        sourceExt: mediaItem.ext,
        name: mediaItem.name,
        outputFileName: fileName,
        outputType: imageBlob.type,
        outputSize: imageBlob.size,
      })
      const taggingResult = await CfBailianTempFileUploader.uploadBlob(
        imageBlob,
        { capability: 'indexing', purpose: 'tagging', fileName },
        (progress) => ctx.update({
          progress: Math.max(0.05, Math.min(0.25, (progress / 100) * 0.2 + 0.05)),
          stage: 'uploading-image',
          message: `上传打标图片: ${progress}%`,
        }),
        ctx.signal,
      )
      if (!taggingResult.success || !taggingResult.url)
        throw new Error(taggingResult.error || `上传打标图片失败: ${mediaItem.name}`)
      const embeddingResult = await CfBailianTempFileUploader.uploadBlob(
        imageBlob,
        { capability: 'indexing', purpose: 'embedding', fileName },
        (progress) => ctx.update({
          progress: Math.max(0.25, Math.min(0.45, (progress / 100) * 0.2 + 0.25)),
          stage: 'uploading-image',
          message: `上传向量化图片: ${progress}%`,
        }),
        ctx.signal,
      )
      if (!embeddingResult.success || !embeddingResult.url)
        throw new Error(embeddingResult.error || `上传向量化图片失败: ${mediaItem.name}`)
      segments = [{
        mediaItemId: mediaItem.id,
        sourceType: 'image_url',
        taggingImageUrl: taggingResult.url,
        embeddingImageUrl: embeddingResult.url,
      }]
    }
    const taskSegments = providerSegments(segments)
    const localByKey = new Map(taskSegments.map((segment) => [segment.segment_key, segment]))
    const missing = index.missing_segments.map((missingSegment) => {
      const segment = localByKey.get(missingSegment.segment_key)
      if (!segment) throw new Error('MEDIA_INDEX_CANONICAL_PLAN_MISMATCH')
      return { ...segment }
    })
    if (!missing.length) throw new Error('manifest 缺少可提交的分片')
    const submitted = await submitMediaManifestSegments({
      manifestId: index.manifest_id,
      segments: missing,
    })
    setIndexingMetadata(mediaItem, {
      mediaKind: mediaItem.mediaType,
      indexStatus: 'processing',
      taskId: submitted.task_id,
    })
    await persistMediaItem(mediaItem)
    ctx.update({
      progress: 1,
      stage: 'index-task-submitted',
      message: `索引任务已提交: ${submitted.task_id}`,
    })
    return { mediaId: mediaItem.id, taskId: submitted.task_id }
  }
}

export function createMediaIndexTaskSubmitResolver(
  module: MediaIndexingModule,
): MediaIndexTaskSubmitResolver {
  return new MediaIndexTaskSubmitResolver(module)
}

export { createMediaIndexTaskSubmitRequest }
