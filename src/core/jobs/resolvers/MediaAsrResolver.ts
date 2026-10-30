import { exportMediaItemAudioWindow } from '@/core/utils/mediaExporter'
import { CfBailianTempFileUploader } from '@/core/utils/cfBailianTempFileUploader'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaReadyRequest } from './MediaReadyResolver'
import { isRangeCovered, mergeAsrResult, segmentsForRange } from '@/core/asr/cache'
import { createMediaVersion, submitMediaAsrTask, waitForMediaAsrTask } from '@/core/asr/task'
import type { AsrSegment, MediaAsrInput, MediaAsrResult, MediaAsrTask } from '@/core/asr/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

export const MEDIA_ASR_RESOURCE_TYPE = 'media-asr'

const INPUT_TTL_MS = 45 * 60 * 1000

function persistMediaItem(
  mediaItem: Parameters<typeof globalMetaFileManager.saveMetaFile>[0],
): Promise<void> {
  return globalMetaFileManager.saveMetaFile(mediaItem).then((success) => {
    if (!success) throw new Error(`保存字幕识别元数据失败: ${mediaItem.name}`)
  })
}

function normalizeSegments(
  result: { text?: string; segments?: AsrSegment[]; words?: AsrSegment['words'] },
  range: MediaAsrInput['recognitionRange'],
): AsrSegment[] {
  const segments = Array.isArray(result.segments) ? result.segments : []
  if (segments.length) return segments
  if (!result.text?.trim()) return []
  return [
    {
      start_ms: range.start_ms,
      end_ms: range.end_ms,
      text: result.text.trim(),
      words: result.words,
    },
  ]
}

export class MediaAsrResolver implements ResourceResolver<MediaAsrInput, MediaAsrResult> {
  readonly type = MEDIA_ASR_RESOURCE_TYPE
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly module: {
      getMediaItem(mediaId: string): UnifiedMediaItemData | undefined
      getTimelineItem?(
        timelineItemId: string,
      ): { timelinePlaceholder?: { payload: unknown } } | undefined
      getProjectId(): string
    },
  ) {}

  private getMediaItem(mediaId: string) {
    return this.module.getMediaItem(mediaId)
  }

  private async clearFailedTask(mediaId: string, taskId: string): Promise<void> {
    const mediaItem = this.getMediaItem(mediaId)
    const metadata = mediaItem?.metadata?.asr
    if (!mediaItem || !metadata?.tasks.some((task) => task.taskId === taskId)) return
    mediaItem.metadata = {
      ...mediaItem.metadata,
      asr: {
        ...metadata,
        tasks: metadata.tasks.filter((task) => task.taskId !== taskId),
      },
    }
    await persistMediaItem(mediaItem)
  }

  private async clearTasksForRange(
    mediaItem: UnifiedMediaItemData,
    range: MediaAsrInput['recognitionRange'],
  ) {
    const metadata = mediaItem.metadata?.asr
    if (!metadata) return
    const tasks = metadata.tasks.filter(
      (task) =>
        task.recognitionRange.start_ms !== range.start_ms ||
        task.recognitionRange.end_ms !== range.end_ms,
    )
    if (tasks.length === metadata.tasks.length) return
    mediaItem.metadata = { ...mediaItem.metadata, asr: { ...metadata, tasks } }
    await persistMediaItem(mediaItem)
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
  }

  private setTimelineTaskId(input: MediaAsrInput, taskId: string): void {
    if (!input.timelineItemId) return
    const timelineItem = this.module.getTimelineItem?.(input.timelineItemId)
    const payload = timelineItem?.timelinePlaceholder?.payload
    if (payload && typeof payload === 'object') {
      ;(payload as { taskId?: string }).taskId = taskId
    }
  }

  getKey(input: MediaAsrInput): string {
    return `${input.mediaId}:${input.recognitionRange.start_ms}-${input.recognitionRange.end_ms}`
  }

  async isSatisfied(ctx: ResolveCheckContext<MediaAsrInput>): Promise<MediaAsrResult | null> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const metadata = mediaItem?.metadata?.asr
    if (!mediaItem || !isRangeCovered(metadata, ctx.input.recognitionRange)) return null
    await this.clearTasksForRange(mediaItem, ctx.input.recognitionRange).catch(() => undefined)
    return {
      mediaId: mediaItem.id,
      recognitionRange: ctx.input.recognitionRange,
      segments: segmentsForRange(metadata!.segments, ctx.input.requestedRange),
      fromCache: true,
    }
  }

  async getDependencies(ctx: ResolveContext<MediaAsrInput>): Promise<ResourceRequest[]> {
    return [createMediaReadyRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<MediaAsrInput>): Promise<MediaAsrResult> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || (mediaItem.mediaType !== 'audio' && mediaItem.mediaType !== 'video')) {
      throw new Error('字幕识别只支持音频和视频素材')
    }
    const latest = this.getMediaItem(mediaItem.id)
    if (!latest) throw new Error('素材在字幕识别期间已被移除')
    const metadata = latest.metadata?.asr
    if (isRangeCovered(metadata, ctx.input.recognitionRange)) {
      await this.clearTasksForRange(latest, ctx.input.recognitionRange).catch(() => undefined)
      return {
        mediaId: latest.id,
        recognitionRange: ctx.input.recognitionRange,
        segments: segmentsForRange(metadata!.segments, ctx.input.requestedRange),
        fromCache: true,
      }
    }

    const existing = latest.metadata?.asr?.tasks.find(
      (task) =>
        task.recognitionRange.start_ms === ctx.input.recognitionRange.start_ms &&
        task.recognitionRange.end_ms === ctx.input.recognitionRange.end_ms,
    )
    if (existing) {
      this.setTimelineTaskId(ctx.input, existing.taskId)
      const controller = new AbortController()
      const abort = () => controller.abort()
      ctx.signal.addEventListener('abort', abort, { once: true })
      this.controllers.set(existing.taskId, controller)
      try {
        const raw = await waitForMediaAsrTask(
          existing.taskId,
          (progressTask) =>
            ctx.update({
              progress: 0.4 + Math.max(0, Math.min(100, progressTask.progress ?? 0)) * 0.005,
              stage: 'waiting-asr-task',
              message: progressTask.progress_message || '正在等待字幕识别完成',
            }),
          controller.signal,
        )
        const segments = normalizeSegments(raw, ctx.input.recognitionRange)
        const nextMetadata = mergeAsrResult(
          latest.metadata?.asr,
          ctx.input.recognitionRange,
          segments,
        )
        nextMetadata.tasks = nextMetadata.tasks.filter(
          (record) => record.taskId !== existing.taskId,
        )
        latest.metadata = { ...latest.metadata, asr: nextMetadata }
        await persistMediaItem(latest)
        return {
          mediaId: latest.id,
          taskId: existing.taskId,
          recognitionRange: ctx.input.recognitionRange,
          segments: segmentsForRange(segments, ctx.input.requestedRange),
          fromCache: false,
        }
      } catch (error) {
        if (!this.isAbortError(error)) {
          await this.clearFailedTask(latest.id, existing.taskId).catch(() => undefined)
        }
        throw error
      } finally {
        this.controllers.delete(existing.taskId)
        ctx.signal.removeEventListener('abort', abort)
      }
    }

    const startSeconds = ctx.input.recognitionRange.start_ms / 1000
    const endSeconds = ctx.input.recognitionRange.end_ms / 1000
    ctx.update({ progress: 0.1, stage: 'exporting-audio', message: '正在准备字幕识别音频' })
    const audioBlob = await exportMediaItemAudioWindow(
      latest,
      startSeconds,
      endSeconds,
      (progress) => {
        ctx.update({
          progress: 0.1 + progress * 0.002,
          stage: 'exporting-audio',
          message: `准备音频 ${progress}%`,
        })
      },
    )
    ctx.signal.throwIfAborted()
    const upload = await CfBailianTempFileUploader.uploadBlob(
      audioBlob,
      {
        capability: 'asr',
        purpose: 'asr',
        fileName: `${latest.id}-${ctx.input.recognitionRange.start_ms}.mp3`,
      },
      (progress) =>
        ctx.update({
          progress: 0.1 + progress * 0.003,
          stage: 'uploading-audio',
          message: `上传音频 ${progress}%`,
        }),
      ctx.signal,
    )
    if (!upload.success || !upload.url) throw new Error(upload.error || '上传字幕识别音频失败')

    const mediaVersion = await createMediaVersion({
      mediaId: latest.id,
      createdAt: latest.createdAt,
      mediaKind: latest.mediaType,
      duration: latest.duration,
    })
    const controller = new AbortController()
    const abort = () => controller.abort()
    ctx.signal.addEventListener('abort', abort, { once: true })
    const task = await submitMediaAsrTask(
      this.module.getProjectId(),
      {
        media_id: latest.id,
        media_version: mediaVersion,
        media_kind: latest.mediaType === 'video' ? 'video' : 'audio',
        audio_url: upload.url,
        recognition_range: ctx.input.recognitionRange,
        requested_range: ctx.input.requestedRange,
        language: ctx.input.language,
        expires_at: new Date(Date.now() + INPUT_TTL_MS).toISOString(),
      },
      controller.signal,
    )
    const taskId = task.task_id
    if (!taskId) throw new Error('字幕识别任务缺少 taskId')
    this.setTimelineTaskId(ctx.input, taskId)
    latest.metadata = {
      ...latest.metadata,
      asr: {
        completedRanges: latest.metadata?.asr?.completedRanges ?? [],
        segments: latest.metadata?.asr?.segments ?? [],
        tasks: [
          ...(latest.metadata?.asr?.tasks ?? []),
          {
            taskId,
            recognitionRange: ctx.input.recognitionRange,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }
    await persistMediaItem(latest)
    this.controllers.set(taskId, controller)
    try {
      const raw = await waitForMediaAsrTask(
        taskId,
        (progressTask: MediaAsrTask) => {
          ctx.update({
            progress: 0.4 + Math.max(0, Math.min(100, progressTask.progress ?? 0)) * 0.005,
            stage: 'waiting-asr-task',
            message: progressTask.progress_message || '正在等待字幕识别完成',
          })
        },
        controller.signal,
      )
      const segments = normalizeSegments(raw, ctx.input.recognitionRange)
      const nextMetadata = mergeAsrResult(
        latest.metadata?.asr,
        ctx.input.recognitionRange,
        segments,
      )
      nextMetadata.tasks = nextMetadata.tasks.filter((record) => record.taskId !== taskId)
      latest.metadata = { ...latest.metadata, asr: nextMetadata }
      await persistMediaItem(latest)
      ctx.update({ progress: 1, stage: 'asr-completed', message: '字幕识别完成' })
      return {
        mediaId: latest.id,
        taskId,
        recognitionRange: ctx.input.recognitionRange,
        segments: segmentsForRange(segments, ctx.input.requestedRange),
        fromCache: false,
      }
    } catch (error) {
      if (!this.isAbortError(error)) {
        await this.clearFailedTask(latest.id, taskId).catch(() => undefined)
      }
      throw error
    } finally {
      this.controllers.delete(taskId)
      ctx.signal.removeEventListener('abort', abort)
    }
  }

  async cancel(ctx: ResolveContext<MediaAsrInput>): Promise<void> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const taskId = mediaItem?.metadata?.asr?.tasks.find(
      (task) =>
        task.recognitionRange.start_ms === ctx.input.recognitionRange.start_ms &&
        task.recognitionRange.end_ms === ctx.input.recognitionRange.end_ms,
    )?.taskId
    if (taskId) {
      this.controllers.get(taskId)?.abort()
    }
  }
}

export function createMediaAsrRequest(
  input: MediaAsrInput,
  policy?: ResourcePolicy,
): ResourceRequest<MediaAsrInput> {
  return {
    type: MEDIA_ASR_RESOURCE_TYPE,
    key: `${input.mediaId}:${input.recognitionRange.start_ms}-${input.recognitionRange.end_ms}`,
    input,
    policy: { queue: 'ai-remote', ...policy },
  }
}

export function createMediaAsrResolver(
  module: ConstructorParameters<typeof MediaAsrResolver>[0],
): MediaAsrResolver {
  return new MediaAsrResolver(module)
}
