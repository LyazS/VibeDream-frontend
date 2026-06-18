import { fetchClient, sleepWithAbortSignal } from '@/utils/fetchClient'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { splitAllUtterancesToSubtitles } from '@/core/utils/subtitleSplitter'
import {
  ASRStreamEventType,
  ASRTaskStatus,
  type ASRQueryResponse,
  type ASRRequestConfig,
  type BackendTaskStreamEvent,
} from '@/core/datasource/providers/asr/types'

export const ASR_SUBTITLES_RESOURCE_TYPE = 'asr-subtitles'
export const ASR_REMOTE_TASK_COMPLETED_RESOURCE_TYPE = 'asr-remote-task-completed'

export interface ASRTaskSubmitResponse {
  success: boolean
  task_id?: string
  error_message?: string
}

export interface ASRSubtitlesInput {
  placeholderTimelineItemId: string
}

export interface ASRSubtitlesResult {
  placeholderTimelineItemId: string
  status: 'completed' | 'skipped'
}

export interface ASRRemoteTaskCompletedInput {
  placeholderTimelineItemId: string
  remoteTaskId: string
}

export interface ASRRemoteTaskCompletedResult {
  placeholderTimelineItemId: string
  remoteTaskId: string
  asrResult: ASRQueryResponse
}

type ASRSubtitlesModule = {
  getTimelineItem: (id: string) => UnifiedTimelineItemData | undefined
  getTimelineItems: () => UnifiedTimelineItemData[]
  addTimelineItem: (timelineItem: UnifiedTimelineItemData) => Promise<void>
  removeTimelineItem: (timelineItemId: string) => Promise<void>
  getTrack: (trackId: string) => UnifiedTrackData | undefined
}

type PlaceholderTask = NonNullable<UnifiedTimelineItemData['task']>

export class ASRSubtitlesResolver
  implements ResourceResolver<ASRSubtitlesInput, ASRSubtitlesResult>
{
  readonly type = ASR_SUBTITLES_RESOURCE_TYPE

  constructor(private readonly module: ASRSubtitlesModule) {}

  getKey(input: ASRSubtitlesInput): string {
    return input.placeholderTimelineItemId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<ASRSubtitlesInput>,
  ): Promise<ASRSubtitlesResult | null> {
    const placeholder = this.module.getTimelineItem(ctx.input.placeholderTimelineItemId)
    if (!placeholder) {
      return {
        placeholderTimelineItemId: ctx.input.placeholderTimelineItemId,
        status: 'skipped',
      }
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<ASRSubtitlesInput>): Promise<ResourceRequest[]> {
    const placeholder = this.module.getTimelineItem(ctx.input.placeholderTimelineItemId)
    const task = getASRPlaceholderTask(placeholder)

    if (!task?.remoteTaskId) {
      return []
    }

    return [createASRRemoteTaskCompletedRequest(placeholder!.id, task.remoteTaskId)]
  }

  async resolve(ctx: ResolveContext<ASRSubtitlesInput>): Promise<ASRSubtitlesResult> {
    const placeholder = this.module.getTimelineItem(ctx.input.placeholderTimelineItemId)
    if (!placeholder) {
      ctx.update({
        progress: 1,
        stage: 'skipped',
        message: `ASR placeholder missing: ${ctx.input.placeholderTimelineItemId}`,
      })
      return {
        placeholderTimelineItemId: ctx.input.placeholderTimelineItemId,
        status: 'skipped',
      }
    }

    const task = getASRPlaceholderTask(placeholder)
    if (!task?.remoteTaskId) {
      await cleanupPlaceholder(this.module, placeholder.id)
      throw new Error(`ASR placeholder is missing remoteTaskId: ${placeholder.id}`)
    }

    ctx.update({
      progress: 0.96,
      stage: 'materializing',
      message: 'Creating subtitles on timeline',
    })

    try {
      const completed = await ctx.ensure<ASRRemoteTaskCompletedResult>(
        createASRRemoteTaskCompletedRequest(placeholder.id, task.remoteTaskId),
      )

      await materializeASRSubtitles(this.module, placeholder, task.requestId, completed.asrResult)
      await cleanupPlaceholder(this.module, placeholder.id)

      ctx.update({
        progress: 1,
        stage: 'completed',
        message: 'ASR subtitles created',
      })

      return {
        placeholderTimelineItemId: placeholder.id,
        status: 'completed',
      }
    } catch (error) {
      await cleanupPlaceholder(this.module, placeholder.id)
      throw error
    }
  }

  async cancel(ctx: ResolveContext<ASRSubtitlesInput>): Promise<void> {
    const placeholder = this.module.getTimelineItem(ctx.input.placeholderTimelineItemId)
    const task = getASRPlaceholderTask(placeholder)

    if (!placeholder && !task) {
      return
    }

    // ASR 远程任务不需要主动调用后端取消接口，仅清理本地 placeholder 即可。
    // 轮询会通过 AbortSignal 自动停止，后端任务会自然超时结束。
    if (placeholder) {
      await cleanupPlaceholder(this.module, placeholder.id)
    }
  }
}

export class ASRRemoteTaskCompletedResolver
  implements ResourceResolver<ASRRemoteTaskCompletedInput, ASRRemoteTaskCompletedResult>
{
  readonly type = ASR_REMOTE_TASK_COMPLETED_RESOURCE_TYPE
  private abortControllers = new Map<string, AbortController>()

  getKey(input: ASRRemoteTaskCompletedInput): string {
    return input.remoteTaskId
  }

  async isSatisfied(
    _ctx: ResolveCheckContext<ASRRemoteTaskCompletedInput>,
  ): Promise<ASRRemoteTaskCompletedResult | null> {
    return null
  }

  async resolve(
    ctx: ResolveContext<ASRRemoteTaskCompletedInput>,
  ): Promise<ASRRemoteTaskCompletedResult> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    this.abortControllers.set(ctx.input.remoteTaskId, controller)

    try {
      ctx.update({
        progress: 0.1,
        stage: 'polling',
        message: `Waiting for ASR task: ${ctx.input.remoteTaskId}`,
      })

      const asrResult = await waitForASRCompletion(
        ctx.input.remoteTaskId,
        ctx,
        controller.signal,
      )

      ctx.update({
        progress: 1,
        stage: 'completed',
        message: `ASR task completed: ${ctx.input.remoteTaskId}`,
      })

      return {
        placeholderTimelineItemId: ctx.input.placeholderTimelineItemId,
        remoteTaskId: ctx.input.remoteTaskId,
        asrResult,
      }
    } finally {
      this.abortControllers.delete(ctx.input.remoteTaskId)
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }

  async cancel(ctx: ResolveContext<ASRRemoteTaskCompletedInput>): Promise<void> {
    // ASR 远程任务不需要主动调用后端取消接口，abort 轮询即可。
    this.abortControllers.get(ctx.input.remoteTaskId)?.abort()
  }
}

export function createASRSubtitlesResolver(module: ASRSubtitlesModule): ASRSubtitlesResolver {
  return new ASRSubtitlesResolver(module)
}

export function createASRRemoteTaskCompletedResolver(): ASRRemoteTaskCompletedResolver {
  return new ASRRemoteTaskCompletedResolver()
}

export function createASRSubtitlesRequest(
  placeholderTimelineItemId: string,
  policy?: ResourcePolicy,
): ResourceRequest<ASRSubtitlesInput> {
  return {
    type: ASR_SUBTITLES_RESOURCE_TYPE,
    key: placeholderTimelineItemId,
    input: { placeholderTimelineItemId },
    policy: {
      queue: 'asr',
      ...policy,
    },
  }
}

export function createASRRemoteTaskCompletedRequest(
  placeholderTimelineItemId: string,
  remoteTaskId: string,
  policy?: ResourcePolicy,
): ResourceRequest<ASRRemoteTaskCompletedInput> {
  return {
    type: ASR_REMOTE_TASK_COMPLETED_RESOURCE_TYPE,
    key: remoteTaskId,
    input: {
      placeholderTimelineItemId,
      remoteTaskId,
    },
    policy: {
      queue: 'asr',
      ...policy,
    },
  }
}

export async function submitASRTask(config: ASRRequestConfig): Promise<ASRTaskSubmitResponse> {
  try {
    const response = await fetchClient.post<ASRTaskSubmitResponse>('/api/media/generate', {
      ai_task_type: 'volcengine_asr',
      content_type: 'audio',
      task_config: config,
    })

    if (response.status !== 200) {
      return {
        success: false,
        error_message: `提交任务失败: ${response.statusText}`,
      }
    }

    return response.data
  } catch (error) {
    return {
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    }
  }
}

function getASRPlaceholderTask(
  timelineItem: UnifiedTimelineItemData | undefined,
): PlaceholderTask | null {
  if (!timelineItem?.isPlaceholder || timelineItem.task?.kind !== 'asr-subtitles') {
    return null
  }

  return timelineItem.task
}

async function cleanupPlaceholder(module: ASRSubtitlesModule, timelineItemId: string): Promise<void> {
  const placeholder = module.getTimelineItem(timelineItemId)
  if (!placeholder) {
    return
  }

  await module.removeTimelineItem(timelineItemId)
}

async function materializeASRSubtitles(
  module: ASRSubtitlesModule,
  placeholder: UnifiedTimelineItemData,
  requestId: string,
  asrResult: ASRQueryResponse,
): Promise<void> {
  if (hasExistingASRSubtitles(module, requestId)) {
    return
  }

  const utterances = asrResult.result?.utterances || []
  if (utterances.length === 0) {
    return
  }

  if (!module.getTrack(placeholder.trackId)) {
    throw new Error(`ASR target track not found: ${placeholder.trackId}`)
  }

  const subtitles = splitAllUtterancesToSubtitles(utterances)
  for (const subtitle of subtitles) {
    const startFrames =
      placeholder.timeRange.timelineStartTime +
      Math.round((subtitle.start_time / 1000) * RENDERER_FPS)
    const durationFrames = Math.round(((subtitle.end_time - subtitle.start_time) / 1000) * RENDERER_FPS)

    if (durationFrames <= 0) {
      continue
    }

    const textItem = await createTextTimelineItem(
      subtitle.text,
      {
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      },
      startFrames,
      placeholder.trackId,
      durationFrames,
    )

    textItem.timelineStatus = 'loading'
    await setupTimelineItemBunny(textItem)
    if (textItem.runtime.textBitmap) {
      TimelineItemQueries.patchVisualRenderConfig(textItem, {
        width: textItem.runtime.textBitmap.width,
        height: textItem.runtime.textBitmap.height,
      })
    }
    textItem.provenance = {
      ...textItem.provenance,
      asrRequestId: requestId,
    }
    textItem.timelineStatus = 'ready'
    textItem.runtime.isInitialized = true

    await module.addTimelineItem(textItem)
  }
}

function hasExistingASRSubtitles(module: ASRSubtitlesModule, requestId: string): boolean {
  return module.getTimelineItems().some((item) => item.provenance?.asrRequestId === requestId)
}

async function waitForASRCompletion(
  remoteTaskId: string,
  ctx: ResolveContext<ASRRemoteTaskCompletedInput>,
  signal: AbortSignal,
): Promise<ASRQueryResponse> {
  let needReconnect = true
  let delaySeconds = 1
  let resolvedResult: ASRQueryResponse | null = null

  while (needReconnect) {
    await fetchClient
      .stream(
        'GET',
        `/api/media/tasks/${remoteTaskId}/status`,
        (event: BackendTaskStreamEvent): boolean | void => {
          if (event.type === ASRStreamEventType.PROGRESS_UPDATE) {
            ctx.update({
              progress: Math.max(0.1, Math.min(0.95, (event.progress ?? 0) / 100)),
              stage: 'polling',
              message: event.message || 'ASR task processing',
            })
            return false
          }

          if (event.type === ASRStreamEventType.FINAL) {
            if (event.status === ASRTaskStatus.FAILED) {
              throw new Error(event.message || 'ASR task failed')
            }

            if (event.status === ASRTaskStatus.CANCELLED) {
              throw new Error(event.message || 'ASR task cancelled')
            }

            const resultData = event.result_data?.asr_result
            if (!resultData) {
              throw new Error('FINAL 事件中缺少 asr_result')
            }

            resolvedResult = resultData
            needReconnect = false
            return true
          }

          if (event.type === ASRStreamEventType.ERROR) {
            throw new Error(event.message || 'ASR task error')
          }

          return false
        },
        undefined,
        { signal },
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }

        if (error instanceof Error) {
          throw error
        }

        throw new Error(String(error))
      })

    if (needReconnect) {
      const jitter = delaySeconds * 0.2 * (Math.random() * 2 - 1)
      const actualDelay = Math.max(0, delaySeconds + jitter)
      await sleepWithAbortSignal(actualDelay * 1000, signal)
      delaySeconds = Math.min(delaySeconds * 2, 60)
    }
  }

  if (!resolvedResult) {
    throw new Error(`ASR task completed without result: ${remoteTaskId}`)
  }

  return resolvedResult
}
