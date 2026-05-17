import { fetchClient } from '@/utils/fetchClient'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { createDefaultMaskConfig } from '@/core/timelineitem/mask'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { detectSceneTransNetV2 } from '@/core/utils/scene-detector-transnetv2'
import type { TransNetV2ProgressEvent } from '@/core/utils/transnetv2/types'
import { exportMediaItem } from '@/core/utils/projectExporter'

const MEDIA_INDEX_LOG_PREFIX = '[MediaIndex]'

interface MediaIndexUploadPolicyResponse {
  upload_host: string
  upload_dir: string
  oss_access_key_id: string
  signature: string
  policy: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
  key: string
  url: string
}

interface MediaIndexShotPayload {
  // 后端只需要每个 shot 的帧范围和两个 OSS 视频地址，避免重复传大文件。
  shot_index: number
  start_frame: number
  end_frame: number
  vision_url: string
  embedding_url: string
}

interface MediaIndexResponse {
  status: 'pending' | 'running' | 'done' | 'failed' | 'partial_failed'
  stage: string
  project_id: string
  media_item_id: string
  collection_name: string
  total_shots: number
  tagged_shots: number
  embedded_shots: number
  indexed_shots: number
  failed_shots: number
  error?: string | null
}

interface ShotRange {
  shotIndex: number
  startFrame: number
  endFrame: number
}

export interface IndexMediaOptions {
  force?: boolean
  onProgress?: (stage: string, progress: number, details?: string) => void
}

export interface IndexMediaResult {
  success: boolean
  cached: boolean
  collectionName?: string
  shotCount?: number
  error?: string
}

type ReadyVideoMediaItem = UnifiedMediaItemData & {
  // 索引流程依赖 bunnyMedia 和 duration，先收窄成已就绪的视频素材类型。
  mediaType: 'video'
  mediaStatus: 'ready'
  duration: number
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'media'
}

function resolveMaxSideSize(width: number, height: number, maxSide: number): { outputWidth: number; outputHeight: number } {
  // 上传给云端模型的视频不需要原始分辨率，按最长边等比压缩以控制上传和推理成本。
  const sourceMaxSide = Math.max(width, height)
  if (sourceMaxSide <= maxSide) {
    return { outputWidth: width, outputHeight: height }
  }
  const scale = maxSide / sourceMaxSide
  const even = (value: number) => {
    const rounded = Math.max(2, Math.round(value))
    return rounded % 2 === 0 ? rounded : rounded + 1
  }
  return {
    outputWidth: even(width * scale),
    outputHeight: even(height * scale),
  }
}

function logMediaIndex(message: string, details?: Record<string, unknown>): void {
  console.debug(MEDIA_INDEX_LOG_PREFIX, message, details ?? '')
}

function warnMediaIndex(message: string, details?: Record<string, unknown>): void {
  console.warn(MEDIA_INDEX_LOG_PREFIX, message, details ?? '')
}

function errorMediaIndex(message: string, details?: Record<string, unknown>): void {
  console.error(MEDIA_INDEX_LOG_PREFIX, message, details ?? '')
}

export class MediaIndexingService {
  async indexMedia(mediaItem: UnifiedMediaItemData, options: IndexMediaOptions = {}): Promise<IndexMediaResult> {
    const unifiedStore = useUnifiedStore()
    const projectId = String(unifiedStore.projectId || '').trim()
    const existing = mediaItem.metadata?.indexing
    logMediaIndex('开始索引媒体', {
      mediaItemId: mediaItem.id,
      mediaName: mediaItem.name,
      mediaType: mediaItem.mediaType,
      mediaStatus: mediaItem.mediaStatus,
      projectId,
      force: options.force === true,
      existingStatus: existing?.status,
      existingProjectId: existing?.projectId,
    })

    // 同一个项目下已经完成索引时默认复用，避免右键重复触发昂贵的云端处理。
    if (existing?.status === 'completed' && existing.projectId === projectId && !options.force) {
      logMediaIndex('命中已有索引，跳过重建', {
        mediaItemId: mediaItem.id,
        projectId,
        collectionName: existing.collectionName,
        shotCount: existing.shotCount,
      })
      return {
        success: true,
        cached: true,
        collectionName: existing.collectionName,
        shotCount: existing.shotCount,
      }
    }

    try {
      if (!projectId) {
        throw new Error('当前项目 ID 无效')
      }

      const readyMediaItem = await this.ensureReadyVideo(mediaItem)
      const dimensions = await this.getVideoDimensions(readyMediaItem)
      logMediaIndex('视频素材已就绪', {
        mediaItemId: readyMediaItem.id,
        mediaName: readyMediaItem.name,
        durationFrames: readyMediaItem.duration,
        width: dimensions.width,
        height: dimensions.height,
      })

      options.onProgress?.('检测分镜', 5)
      // TransNetV2 在浏览器本地完成 shot 边界检测，后端只消费切好的片段。
      const ranges = await this.detectShotRanges(readyMediaItem, (event) => {
        logMediaIndex('分镜检测进度', {
          mediaItemId: readyMediaItem.id,
          stage: event.stage,
          current: event.current,
          total: event.total,
        })
        options.onProgress?.('检测分镜', Math.min(25, Math.round(event.current * 0.25)), event.stage)
      })
      if (!ranges.length) {
        throw new Error('未生成有效 shot range')
      }
      logMediaIndex('分镜检测完成', {
        mediaItemId: readyMediaItem.id,
        shotCount: ranges.length,
        ranges,
      })

      const shots: MediaIndexShotPayload[] = []
      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index]
        const baseProgress = 25 + Math.round((index / ranges.length) * 50)
        options.onProgress?.('导出并上传 Shot', baseProgress, `${index + 1}/${ranges.length}`)
        logMediaIndex('开始导出 Shot', {
          mediaItemId: readyMediaItem.id,
          shotIndex: range.shotIndex,
          startFrame: range.startFrame,
          endFrame: range.endFrame,
          totalShots: ranges.length,
        })

        // 同一 shot 导出两份：720p 给 VLM 看细节，480p/1fps 给 embedding 控制成本。
        const [visionBlob, embeddingBlob] = await Promise.all([
          exportMediaItem({
            mediaItem: readyMediaItem,
            startFrame: range.startFrame,
            endFrame: range.endFrame,
            ...resolveMaxSideSize(dimensions.width, dimensions.height, 720),
          }),
          exportMediaItem({
            mediaItem: readyMediaItem,
            startFrame: range.startFrame,
            endFrame: range.endFrame,
            ...resolveMaxSideSize(dimensions.width, dimensions.height, 480),
            frameRate: 1,
          }),
        ])
        logMediaIndex('Shot 导出完成', {
          mediaItemId: readyMediaItem.id,
          shotIndex: range.shotIndex,
          visionBlobSize: visionBlob.size,
          embeddingBlobSize: embeddingBlob.size,
        })

        // 前端拿后端签发的 DashScope OSS policy 直传，避免后端中转视频文件。
        const [visionUrl, embeddingUrl] = await Promise.all([
          this.uploadShotBlob(visionBlob, 'vision', readyMediaItem.name, range.shotIndex),
          this.uploadShotBlob(embeddingBlob, 'embedding', readyMediaItem.name, range.shotIndex),
        ])
        logMediaIndex('Shot 上传完成', {
          mediaItemId: readyMediaItem.id,
          shotIndex: range.shotIndex,
          visionUrl,
          embeddingUrl,
        })

        shots.push({
          shot_index: range.shotIndex,
          start_frame: range.startFrame,
          end_frame: range.endFrame,
          vision_url: visionUrl,
          embedding_url: embeddingUrl,
        })
      }

      options.onProgress?.('提交后端索引', 80)
      // 前端已完成所有 shot 上传，后端同步完成打标签、生成向量并写入 Qdrant 后再返回。
      logMediaIndex('提交同步后端索引请求', {
        mediaItemId: readyMediaItem.id,
        projectId,
        shotCount: shots.length,
      })
      const status = await this.indexUploadedShots({
        project_id: projectId,
        media_item_id: readyMediaItem.id,
        media_name: readyMediaItem.name,
        fps: RENDERER_FPS,
        duration_frames: readyMediaItem.duration,
        shots,
      })
      logMediaIndex('同步后端索引请求完成', {
        mediaItemId: readyMediaItem.id,
        status: status.status,
        stage: status.stage,
        taggedShots: status.tagged_shots,
        embeddedShots: status.embedded_shots,
        indexedShots: status.indexed_shots,
        failedShots: status.failed_shots,
        totalShots: status.total_shots,
        error: status.error,
      })

      if (status.status !== 'done' && status.status !== 'partial_failed') {
        throw new Error(status.error || '索引任务失败')
      }
      if (status.status === 'partial_failed') {
        warnMediaIndex('索引任务部分失败', {
          mediaItemId: readyMediaItem.id,
          indexedShots: status.indexed_shots,
          failedShots: status.failed_shots,
          error: status.error,
        })
      }

      // 索引结果写回 media metadata，项目再次打开时可以识别该素材已建索引。
      unifiedStore.updateMediaItemMetadata(readyMediaItem.id, {
        indexing: {
          status: 'completed',
          projectId,
          collectionName: status.collection_name,
          indexedAt: new Date().toISOString(),
          shotCount: status.indexed_shots,
          sourceMediaItemId: readyMediaItem.id,
        },
      })
      await unifiedStore.saveCurrentProject({ directoryChanged: true })

      options.onProgress?.('完成', 100)
      logMediaIndex('媒体索引完成', {
        mediaItemId: readyMediaItem.id,
        projectId,
        collectionName: status.collection_name,
        indexedShots: status.indexed_shots,
        failedShots: status.failed_shots,
      })
      return {
        success: true,
        cached: false,
        collectionName: status.collection_name,
        shotCount: status.indexed_shots,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '索引素材失败'
      errorMediaIndex('媒体索引失败', {
        mediaItemId: mediaItem.id,
        mediaName: mediaItem.name,
        projectId,
        error: message,
      })
      // 失败状态也写入 metadata，方便审核问题素材和后续决定是否强制重试。
      unifiedStore.updateMediaItemMetadata(mediaItem.id, {
        indexing: {
          status: 'failed',
          projectId,
          indexedAt: new Date().toISOString(),
          sourceMediaItemId: mediaItem.id,
          error: message,
        },
      })
      return {
        success: false,
        cached: false,
        error: message,
      }
    }
  }

  private async ensureReadyVideo(mediaItem: UnifiedMediaItemData): Promise<ReadyVideoMediaItem> {
    const unifiedStore = useUnifiedStore()
    // 如果素材仍在 pending，先走现有媒体处理链路，等待运行时 bunny 数据准备好。
    if (mediaItem.mediaStatus === 'pending') {
      logMediaIndex('素材处于 pending，启动媒体处理', {
        mediaItemId: mediaItem.id,
        mediaName: mediaItem.name,
      })
      unifiedStore.startMediaProcessing(mediaItem)
    }
    if (mediaItem.mediaStatus !== 'ready') {
      logMediaIndex('等待媒体素材就绪', {
        mediaItemId: mediaItem.id,
        mediaStatus: mediaItem.mediaStatus,
      })
      await unifiedStore.waitForMediaItemReady(mediaItem.id)
    }
    const latest = unifiedStore.getMediaItem(mediaItem.id)
    if (!latest || latest.mediaType !== 'video' || latest.mediaStatus !== 'ready' || !latest.duration) {
      throw new Error('只支持已就绪的视频素材索引')
    }
    return latest as ReadyVideoMediaItem
  }

  private async getVideoDimensions(mediaItem: ReadyVideoMediaItem): Promise<{ width: number; height: number }> {
    const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
    if (!bunnyMedia) {
      throw new Error('媒体项目未就绪：bunnyMedia 不存在')
    }
    await bunnyMedia.ready
    return {
      width: bunnyMedia.width || mediaItem.runtime.bunny?.originalWidth || 1920,
      height: bunnyMedia.height || mediaItem.runtime.bunny?.originalHeight || 1080,
    }
  }

  private async detectShotRanges(
    mediaItem: ReadyVideoMediaItem,
    onProgress?: (event: TransNetV2ProgressEvent) => void,
  ): Promise<ShotRange[]> {
    const dimensions = await this.getVideoDimensions(mediaItem)
    const timelineItem = this.createFullLengthTimelineItem(mediaItem, dimensions)
    await setupTimelineItemBunny(timelineItem, mediaItem)
    logMediaIndex('TransNetV2 临时时间轴项已初始化', {
      mediaItemId: mediaItem.id,
      timelineItemId: timelineItem.id,
      durationFrames: mediaItem.duration,
    })
    let cuts: bigint[] = []
    try {
      // detector 需要一个 ready 的临时时间轴项；完成后必须释放 bunnyClip。
      cuts = await detectSceneTransNetV2(timelineItem, {
        threshold: 0.5,
        minShotFrames: 15,
        onProgress,
      })
    } finally {
      logMediaIndex('释放分镜检测临时 bunnyClip', {
        mediaItemId: mediaItem.id,
        timelineItemId: timelineItem.id,
      })
      timelineItem.runtime.bunnyClip?.dispose()
    }
    const sortedCuts = Array.from(new Set(cuts.map((frame) => Number(frame))))
      .filter((frame) => frame > 0 && frame < mediaItem.duration)
      .sort((a, b) => a - b)
    logMediaIndex('TransNetV2 原始 cut 点已归一化', {
      mediaItemId: mediaItem.id,
      rawCutCount: cuts.length,
      cutCount: sortedCuts.length,
      cuts: sortedCuts,
    })
    // 补上首尾边界，把 cut 点转换成不重叠且覆盖全片的 shot range。
    const boundaries = [0, ...sortedCuts, mediaItem.duration]
    const ranges: ShotRange[] = []
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startFrame = boundaries[index]
      const endFrame = boundaries[index + 1]
      if (endFrame - startFrame >= 3) {
        ranges.push({
          shotIndex: ranges.length,
          startFrame,
          endFrame,
        })
      }
    }
    return ranges
  }

  private createFullLengthTimelineItem(
    mediaItem: ReadyVideoMediaItem,
    dimensions: { width: number; height: number },
  ): UnifiedTimelineItemData<'video'> {
    // 这里的时间轴项只用于本地检测，不会写入项目时间线。
    return {
      id: `temp-index-detect-${mediaItem.id}`,
      mediaType: 'video',
      mediaItemId: mediaItem.id,
      trackId: 'temp-index-track',
      timelineStatus: 'ready',
      timeRange: {
        timelineStartTime: 0,
        timelineEndTime: mediaItem.duration,
        clipStartTime: 0,
        clipEndTime: mediaItem.duration,
      },
      config: {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
        rotation: 0,
        opacity: 1,
        blendMode: DEFAULT_BLEND_MODE,
        proportionalScale: true,
        mask: createDefaultMaskConfig('rectangle', dimensions),
        volume: 1,
        isMuted: false,
      },
      runtime: {
        isInitialized: true,
      },
    }
  }

  private async uploadShotBlob(
    blob: Blob,
    purpose: 'vision' | 'embedding',
    mediaName: string,
    shotIndex: number,
  ): Promise<string> {
    // 文件名包含 shot 序号和用途，便于在 DashScope OSS 侧排查上传内容。
    const fileName = `${sanitizeFileName(mediaName)}-shot${String(shotIndex).padStart(4, '0')}-${purpose}-${Date.now()}.mp4`
    logMediaIndex('请求 DashScope OSS 上传策略', {
      purpose,
      shotIndex,
      fileName,
      blobSize: blob.size,
    })
    const policyResponse = await fetchClient.post<MediaIndexUploadPolicyResponse>(
      '/api/media-index/upload-policy',
      {
        purpose,
        file_name: fileName,
        content_type: 'video/mp4',
      },
    )
    const policy = policyResponse.data
    logMediaIndex('DashScope OSS 上传策略已获取', {
      purpose,
      shotIndex,
      uploadHost: policy.upload_host,
      key: policy.key,
      url: policy.url,
    })
    const formData = new FormData()
    // DashScope OSS 表单字段名必须和 policy 响应匹配，字段顺序保持接近官方示例。
    formData.append('OSSAccessKeyId', policy.oss_access_key_id)
    formData.append('Signature', policy.signature)
    formData.append('policy', policy.policy)
    formData.append('x-oss-object-acl', policy.x_oss_object_acl)
    formData.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite)
    formData.append('key', policy.key)
    formData.append('success_action_status', '200')
    formData.append('file', blob, fileName)

    const response = await fetch(policy.upload_host, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      throw new Error(`DashScope OSS 上传失败: ${response.status} ${response.statusText}`)
    }
    logMediaIndex('DashScope OSS 表单上传成功', {
      purpose,
      shotIndex,
      status: response.status,
      url: policy.url,
    })
    return policy.url
  }

  private async indexUploadedShots(payload: {
    project_id: string
    media_item_id: string
    media_name: string
    fps: number
    duration_frames: number
    shots: MediaIndexShotPayload[]
  }): Promise<MediaIndexResponse> {
    logMediaIndex('发送同步索引请求', {
      projectId: payload.project_id,
      mediaItemId: payload.media_item_id,
      mediaName: payload.media_name,
      shotCount: payload.shots.length,
      fps: payload.fps,
      durationFrames: payload.duration_frames,
    })
    const response = await fetchClient.post<MediaIndexResponse>('/api/media-index/index', payload)
    return response.data
  }
}

export const mediaIndexingService = new MediaIndexingService()
