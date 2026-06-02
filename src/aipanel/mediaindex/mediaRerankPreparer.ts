import { DashScopeTemporaryFileUploader } from '@/core/utils/dashscopeTemporaryFileUploader'
import { exportTimelineItem, exportMediaItem } from '@/core/utils/mediaExporter'
import { timecodeToFrames } from '@/core/utils/timeUtils'
import { fetchClient } from '@/utils/fetchClient'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { createDefaultMaskConfig } from '@/core/timelineitem/mask'

export interface RerankCandidateInput {
  pointId: string
  mediaItemId: string
  mediaKind: string
  segment: {
    segment_index: number
    start_timecode: string
    end_timecode: string
    duration_n: number
  } | null
}

export interface RerankDocument {
  type: 'video' | 'image'
  video_url?: string
  image_url?: string
}

export interface PreparedRerankCandidate {
  point_id: string
  media_item_id: string
  media_kind: string
  document: RerankDocument
}

export interface RerankResultItem {
  point_id: string
  rerank_score: number
}

function createVideoSegmentTimelineItem(
  mediaItem: UnifiedMediaItemData & { mediaType: 'video' },
  startFrame: number,
  endFrame: number,
): UnifiedTimelineItemData<'video'> {
  const width = mediaItem.runtime.bunny?.originalWidth || 1920
  const height = mediaItem.runtime.bunny?.originalHeight || 1080

  return {
    id: `rerank-${mediaItem.id}-${startFrame}`,
    mediaType: 'video',
    mediaItemId: mediaItem.id,
    trackId: '__rerank__',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: endFrame - startFrame,
      clipStartTime: startFrame,
      clipEndTime: endFrame,
    },
    config: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      blendMode: DEFAULT_BLEND_MODE,
      proportionalScale: true,
      mask: createDefaultMaskConfig('rectangle', { width, height }),
      volume: 1,
      isMuted: false,
    },
    runtime: {
      isInitialized: true,
    },
  }
}

async function prepareVideoCandidate(
  mediaItem: UnifiedMediaItemData,
  segment: RerankCandidateInput['segment'],
): Promise<RerankDocument | null> {
  if (!segment || mediaItem.mediaType !== 'video') return null

  const startFrame = timecodeToFrames(segment.start_timecode)
  const endFrame = timecodeToFrames(segment.end_timecode)

  const timelineItem = createVideoSegmentTimelineItem(
    mediaItem as UnifiedMediaItemData & { mediaType: 'video' },
    startFrame,
    endFrame,
  )

  const videoBlob = await exportTimelineItem({
    timelineItem,
    getMediaItem: (id: string | null) =>
      id === mediaItem.id ? mediaItem : undefined,
  })

  const fileName = `rerank-${mediaItem.id}-seg-${segment.segment_index}-${Date.now()}.mp4`
  const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
    videoBlob,
    fileName,
    'embedding',
  )

  if (!uploadResult.success || !uploadResult.url) {
    console.warn(`视频候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return { type: 'video', video_url: uploadResult.url }
}

async function prepareImageCandidate(
  mediaItem: UnifiedMediaItemData,
): Promise<RerankDocument | null> {
  if (mediaItem.mediaType !== 'image') return null

  const imageBlob = await exportMediaItem({ mediaItem })

  const fileName = `rerank-${mediaItem.id}-${Date.now()}.png`
  const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
    imageBlob,
    fileName,
    'tagging',
  )

  if (!uploadResult.success || !uploadResult.url) {
    console.warn(`图片候选上传失败: ${fileName}`, uploadResult.error)
    return null
  }

  return { type: 'image', image_url: uploadResult.url }
}

export async function prepareRerankCandidates(
  candidates: RerankCandidateInput[],
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  onProgress?: (current: number, total: number) => void,
): Promise<PreparedRerankCandidate[]> {
  const prepared: PreparedRerankCandidate[] = []
  const total = candidates.length

  for (let i = 0; i < candidates.length; i++) {
    onProgress?.(i, total)
    const candidate = candidates[i]

    try {
      const mediaItem = getMediaItem(candidate.mediaItemId)
      if (!mediaItem) {
        console.warn(`找不到素材: ${candidate.mediaItemId}`)
        continue
      }

      if (mediaItem.mediaStatus !== 'ready') {
        console.warn(`素材未就绪: ${candidate.mediaItemId}`)
        continue
      }

      let document: RerankDocument | null = null

      if (candidate.mediaKind === 'video') {
        document = await prepareVideoCandidate(mediaItem, candidate.segment)
      } else if (candidate.mediaKind === 'image') {
        document = await prepareImageCandidate(mediaItem)
      }

      if (!document) continue

      prepared.push({
        point_id: candidate.pointId,
        media_item_id: candidate.mediaItemId,
        media_kind: candidate.mediaKind,
        document,
      })
    } catch (error) {
      console.warn(`准备 rerank 候选失败: ${candidate.pointId}`, error)
    }
  }

  onProgress?.(total, total)
  return prepared
}

export async function callRerankApi(
  query: string,
  projectId: string,
  candidates: PreparedRerankCandidate[],
  topK: number = 10,
): Promise<RerankResultItem[]> {
  const response = await fetchClient.post<{
    query: string
    total: number
    results: RerankResultItem[]
  }>('/api/media/rerank', {
    query,
    project_id: projectId,
    top_k: topK,
    candidates,
  })

  return response.data?.results || []
}
