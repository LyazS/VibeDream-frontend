import type { MusicAnalysisMetadata, UnifiedMediaItemData } from '@/core/mediaitem/types'
import {
  analyzeMusicStructure,
  MUSIC_ANALYSIS_MAX_DURATION_SECONDS,
  MUSIC_ANALYSIS_MIN_DURATION_SECONDS,
  MUSIC_ANALYSIS_PIPELINE_VERSION,
  type MusicAnalysisProgressEvent,
} from '@/core/utils/music-analysis'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaReadyRequest } from './MediaReadyResolver'

export const MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE = 'music-structure-analysis'

export interface MusicStructureAnalysisInput {
  mediaId: string
  force?: boolean
}

export interface MusicStructureAnalysisResult {
  mediaId: string
  musicAnalysis: MusicAnalysisMetadata
}

type MusicStructureAnalysisModule = {
  getMediaItem: (mediaId: string) => UnifiedMediaItemData | undefined
}

export class MusicStructureAnalysisResolver
  implements ResourceResolver<MusicStructureAnalysisInput, MusicStructureAnalysisResult>
{
  readonly type = MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE

  constructor(private readonly module: MusicStructureAnalysisModule) {}

  getKey(input: MusicStructureAnalysisInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MusicStructureAnalysisInput>,
  ): Promise<MusicStructureAnalysisResult | null> {
    if (ctx.input.force) {
      return null
    }

    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const musicAnalysis = mediaItem?.metadata?.musicAnalysis
    if (
      !mediaItem ||
      !musicAnalysis ||
      musicAnalysis.pipelineVersion !== MUSIC_ANALYSIS_PIPELINE_VERSION
    ) {
      return null
    }

    return { mediaId: mediaItem.id, musicAnalysis }
  }

  async getDependencies(
    ctx: ResolveContext<MusicStructureAnalysisInput>,
  ): Promise<ResourceRequest[]> {
    return [createMediaReadyRequest(ctx.input.mediaId)]
  }

  async resolve(
    ctx: ResolveContext<MusicStructureAnalysisInput>,
  ): Promise<MusicStructureAnalysisResult> {
    const mediaItem = this.getAudioCapableMedia(ctx.input.mediaId)
    const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
    if (!bunnyMedia) {
      throw new Error(`音乐素材未就绪: ${mediaItem.name}`)
    }
    await bunnyMedia.ready

    const durationSeconds = bunnyMedia.duration
    if (
      durationSeconds < MUSIC_ANALYSIS_MIN_DURATION_SECONDS ||
      durationSeconds > MUSIC_ANALYSIS_MAX_DURATION_SECONDS
    ) {
      throw new Error(
        `${mediaItem.name} 时长为 ${durationSeconds.toFixed(1)} 秒；音乐结构分析仅支持 ` +
          `${MUSIC_ANALYSIS_MIN_DURATION_SECONDS}-${MUSIC_ANALYSIS_MAX_DURATION_SECONDS} 秒素材`,
      )
    }

    const file = bunnyMedia.getOriFile()
    ctx.update({
      progress: 0,
      stage: 'checking-model-cache',
      message: `准备音乐结构分析: ${mediaItem.name}`,
    })

    const result = await analyzeMusicStructure(file, durationSeconds, {
      signal: ctx.signal,
      onProgress: (event) => this.updateProgress(ctx, mediaItem, event),
    })
    const musicAnalysis: MusicAnalysisMetadata = {
      schemaVersion: 2,
      pipelineVersion: MUSIC_ANALYSIS_PIPELINE_VERSION,
      analyzedAt: new Date().toISOString(),
      ...result,
    }

    mediaItem.metadata = {
      ...mediaItem.metadata,
      musicAnalysis,
    }
    const persisted = await globalMetaFileManager.saveMetaFile(mediaItem)
    if (!persisted) {
      throw new Error(`保存音乐分析结果失败: ${mediaItem.name}`)
    }

    ctx.update({
      progress: 1,
      stage: 'completed',
      message: `音乐结构分析完成: ${mediaItem.name}`,
    })
    return { mediaId: mediaItem.id, musicAnalysis }
  }

  private getAudioCapableMedia(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.module.getMediaItem(mediaId)
    if (!mediaItem) {
      throw new Error(`素材不存在: ${mediaId}`)
    }
    if (mediaItem.mediaStatus !== 'ready') {
      throw new Error(`素材尚未就绪: ${mediaItem.name}`)
    }
    if (mediaItem.mediaType !== 'audio' && mediaItem.mediaType !== 'video') {
      throw new Error(`仅音频或视频素材支持音乐结构分析: ${mediaItem.name}`)
    }
    return mediaItem
  }

  private updateProgress(
    ctx: ResolveContext<MusicStructureAnalysisInput>,
    mediaItem: UnifiedMediaItemData,
    event: MusicAnalysisProgressEvent,
  ): void {
    ctx.update({
      progress: event.progress,
      stage: event.stage,
      message: `${mediaItem.name}: ${event.detail}`,
    })
  }
}

export function createMusicStructureAnalysisResolver(
  module: MusicStructureAnalysisModule,
): MusicStructureAnalysisResolver {
  return new MusicStructureAnalysisResolver(module)
}

export function createMusicStructureAnalysisRequest(
  mediaId: string,
  options: { force?: boolean; policy?: ResourcePolicy } = {},
): ResourceRequest<MusicStructureAnalysisInput> {
  return {
    type: MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId, force: options.force },
    policy: {
      queue: 'local-heavy',
      ...options.policy,
    },
  }
}
