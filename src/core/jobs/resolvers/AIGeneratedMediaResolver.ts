import { fetchClient, sleepWithAbortSignal } from '@/utils/fetchClient'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import {
  BizyAirTypeGuards,
  type BizyAirSourceData,
} from '@/core/datasource/providers/bizyair/BizyAirSource'
import { BizyAirAPIClient } from '@/core/datasource/providers/bizyair/BizyAirAPIClient'
import { BizyAirConfigManager } from '@/core/datasource/providers/bizyair/BizyAirConfigManager'
import { BizyAirTaskStatus } from '@/core/datasource/providers/bizyair/types'
import {
  AIGenerationTypeGuards,
  type AIGenerationSourceData,
} from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import {
  TaskStatus,
  TaskStreamEventType,
  type FinalEvent,
  type TaskStreamEvent,
} from '@/core/datasource/providers/ai-generation/types'
import type { TaskSubmitResponse } from '@/types/taskApi'

export const AI_GENERATED_MEDIA_RESOURCE_TYPE = 'ai-generated-media'
export const AI_INPUT_PREPARED_RESOURCE_TYPE = 'ai-input-prepared'
export const AI_TASK_SUBMITTED_RESOURCE_TYPE = 'ai-task-submitted'
export const REMOTE_TASK_COMPLETED_RESOURCE_TYPE = 'remote-task-completed'

export type AIGeneratedMediaProvider = 'backend' | 'bizyair'

export interface AIGeneratedMediaInput {
  mediaId: string
}

export interface AIGeneratedMediaResult {
  mediaId: string
  status: 'ready'
}

export interface RemoteTaskSubmittedInput {
  mediaId: string
  provider: AIGeneratedMediaProvider
}

export interface RemoteTaskSubmittedResult {
  mediaId: string
  provider: AIGeneratedMediaProvider
  taskId: string
}

export interface AIInputPreparedInput {
  mediaId: string
  provider: AIGeneratedMediaProvider
}

export interface AIInputPreparedResult {
  mediaId: string
  provider: AIGeneratedMediaProvider
  prepared: true
}

export interface RemoteTaskCompletedInput {
  mediaId: string
  provider: AIGeneratedMediaProvider
  taskId: string
}

export interface RemoteTaskCompletedResult {
  mediaId: string
  provider: AIGeneratedMediaProvider
  taskId: string
}

type AIGeneratedMediaModule = Pick<
  UnifiedMediaModule,
  'getMediaItem'
> & {
  ensureMediaReady(mediaId: string): Promise<unknown>
  getBizyAirApiKey(): Promise<string | null>
}

type AIGeneratedSource = AIGenerationSourceData | BizyAirSourceData

export function isAIGeneratedMediaItem(
  mediaItem: UnifiedMediaItemData | null | undefined,
): mediaItem is UnifiedMediaItemData {
  if (!mediaItem) {
    return false
  }

  return (
    AIGenerationTypeGuards.isAIGenerationSource(mediaItem.source) ||
    BizyAirTypeGuards.isBizyAirSource(mediaItem.source)
  )
}

export function isAIGeneratedMediaRecoverable(mediaItem: UnifiedMediaItemData): boolean {
  if (!isAIGeneratedMediaItem(mediaItem)) {
    return false
  }

  if (mediaItem.mediaStatus === 'error' || mediaItem.mediaStatus === 'cancelled') {
    return false
  }

  const source = getAIGeneratedSourceFromMediaItem(mediaItem)
  if (AIGenerationTypeGuards.isAIGenerationSource(source)) {
    if (source.taskStatus === TaskStatus.FAILED || source.taskStatus === TaskStatus.CANCELLED) {
      return false
    }

    return Boolean(source.aiTaskId || source.resultData || source.requestParams)
  }

  if (
    source.taskStatus === BizyAirTaskStatus.FAILED ||
    source.taskStatus === BizyAirTaskStatus.CANCELED
  ) {
    return false
  }

  return Boolean(source.bizyairTaskId || source.resultData || source.requestParams)
}

export function resetAIGeneratedMediaForRetry(mediaItem: UnifiedMediaItemData): void {
  if (!isAIGeneratedMediaItem(mediaItem)) {
    throw new Error('Media item is not AI generated')
  }

  mediaItem.mediaStatus = 'pending'

  const source = getAIGeneratedSourceFromMediaItem(mediaItem)
  if (AIGenerationTypeGuards.isAIGenerationSource(source)) {
    source.aiTaskId = ''
    source.taskStatus = TaskStatus.PENDING
    source.resultData = undefined
  } else {
    source.bizyairTaskId = ''
    source.taskStatus = BizyAirTaskStatus.QUEUING
    source.resultData = undefined
  }

  source.progress = 0
  source.errorMessage = undefined
}

export class AIGeneratedMediaResolver
  implements ResourceResolver<AIGeneratedMediaInput, AIGeneratedMediaResult>
{
  readonly type = AI_GENERATED_MEDIA_RESOURCE_TYPE

  constructor(private readonly mediaModule: AIGeneratedMediaModule) {}

  getKey(input: AIGeneratedMediaInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<AIGeneratedMediaInput>,
  ): Promise<AIGeneratedMediaResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem) || mediaItem.mediaStatus !== 'ready') {
      return null
    }

    const localFileExists = await globalMetaFileManager.verifyMediaFileExists(mediaItem.id)
    return localFileExists ? toResult(mediaItem) : null
  }

  async resolve(ctx: ResolveContext<AIGeneratedMediaInput>): Promise<AIGeneratedMediaResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    const source = this.getAIGeneratedSource(mediaItem)

    if (isTerminalFailure(mediaItem, source)) {
      throw new Error(source.errorMessage || `AI generated media is ${mediaItem.mediaStatus}`)
    }

    ctx.update({
      progress: normalizeProgress(source.progress),
      stage: 'dispatching',
      message: `Resolving AI generated media: ${mediaItem.name}`,
    })

    if (hasCompletedResult(source)) {
      await this.ensureMediaReady(ctx, mediaItem.id)
      return toResult(this.getExistingMediaItem(mediaItem.id))
    }

    const provider = getProviderForMediaItem(mediaItem)
    const taskId =
      getTaskId(source) ||
      (await ctx.ensure<RemoteTaskSubmittedResult>(createAITaskSubmittedRequest(mediaItem.id, provider)))
        .taskId

    await ctx.ensure<RemoteTaskCompletedResult>(
      createRemoteTaskCompletedRequest(mediaItem.id, provider, taskId),
    )

    await this.ensureMediaReady(ctx, mediaItem.id)

    return toResult(this.getExistingMediaItem(mediaItem.id))
  }

  async getDependencies(ctx: ResolveContext<AIGeneratedMediaInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    const source = this.getAIGeneratedSource(mediaItem)

    if (hasCompletedResult(source)) {
      return []
    }

    return [createAITaskSubmittedRequest(mediaItem.id, getProviderForMediaItem(mediaItem))]
  }

  private async ensureMediaReady(ctx: ResolveContext<AIGeneratedMediaInput>, mediaId: string) {
    ctx.update({
      progress: 0.95,
      stage: 'media-ready',
      message: 'Preparing local media file',
    })
    await this.mediaModule.ensureMediaReady(mediaId)
    ctx.update({
      progress: 1,
      stage: 'ready',
      message: 'AI generated media ready',
    })
  }

  private getExistingMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)
    if (!mediaItem) {
      throw new Error(`Media item not found: ${mediaId}`)
    }

    return mediaItem
  }

  private getAIGeneratedSource(mediaItem: UnifiedMediaItemData): AIGeneratedSource {
    if (!isAIGeneratedMediaItem(mediaItem)) {
      throw new Error('Media item is not AI generated')
    }

    return getAIGeneratedSourceFromMediaItem(mediaItem)
  }
}

export class AIInputPreparedResolver
  implements ResourceResolver<AIInputPreparedInput, AIInputPreparedResult>
{
  readonly type = AI_INPUT_PREPARED_RESOURCE_TYPE

  constructor(private readonly mediaModule: AIGeneratedMediaModule) {}

  getKey(input: AIInputPreparedInput): string {
    return `${input.provider}:${input.mediaId}`
  }

  async isSatisfied(
    ctx: ResolveCheckContext<AIInputPreparedInput>,
  ): Promise<AIInputPreparedResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      return null
    }

    return hasPreparedInput(getAIGeneratedSourceFromMediaItem(mediaItem))
      ? {
          mediaId: mediaItem.id,
          provider: ctx.input.provider,
          prepared: true,
        }
      : null
  }

  async resolve(ctx: ResolveContext<AIInputPreparedInput>): Promise<AIInputPreparedResult> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const source = getAIGeneratedSourceFromMediaItem(mediaItem)

    if (!hasPreparedInput(source)) {
      throw new Error(`AI generated media input is not prepared: ${mediaItem.name}`)
    }

    ctx.update({
      progress: 1,
      stage: 'prepared-input',
      message: `AI input prepared: ${mediaItem.name}`,
    })

    return {
      mediaId: mediaItem.id,
      provider: ctx.input.provider,
      prepared: true,
    }
  }

  private getMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      throw new Error(`AI generated media item not found: ${mediaId}`)
    }

    return mediaItem
  }
}

export class AITaskSubmittedResolver
  implements ResourceResolver<RemoteTaskSubmittedInput, RemoteTaskSubmittedResult>
{
  readonly type = AI_TASK_SUBMITTED_RESOURCE_TYPE

  constructor(private readonly mediaModule: AIGeneratedMediaModule) {}

  getKey(input: RemoteTaskSubmittedInput): string {
    return `${input.provider}:${input.mediaId}`
  }

  async isSatisfied(
    ctx: ResolveCheckContext<RemoteTaskSubmittedInput>,
  ): Promise<RemoteTaskSubmittedResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      return null
    }

    const taskId = getTaskId(getAIGeneratedSourceFromMediaItem(mediaItem))
    return taskId
      ? {
          mediaId: mediaItem.id,
          provider: ctx.input.provider,
          taskId,
        }
      : null
  }

  async getDependencies(ctx: ResolveContext<RemoteTaskSubmittedInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const source = getAIGeneratedSourceFromMediaItem(mediaItem)

    if (getTaskId(source)) {
      return []
    }

    return [createAIInputPreparedRequest(mediaItem.id, ctx.input.provider)]
  }

  async resolve(ctx: ResolveContext<RemoteTaskSubmittedInput>): Promise<RemoteTaskSubmittedResult> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const source = getAIGeneratedSourceFromMediaItem(mediaItem)
    const existingTaskId = getTaskId(source)
    if (existingTaskId) {
      return {
        mediaId: mediaItem.id,
        provider: ctx.input.provider,
        taskId: existingTaskId,
      }
    }

    ctx.update({
      progress: 0.1,
      stage: 'submitting',
      message: `Submitting remote task: ${mediaItem.name}`,
    })

    await ctx.ensure<AIInputPreparedResult>(createAIInputPreparedRequest(mediaItem.id, ctx.input.provider))

    const taskId =
      ctx.input.provider === 'bizyair'
        ? await this.submitBizyAirTask(mediaItem, ctx.signal)
        : await submitBackendTask(mediaItem, ctx.signal)

    console.log(
      `🆔 [AIGeneratedMediaResolver] 已获取远程任务 ID: ${taskId} (provider=${ctx.input.provider}, mediaId=${mediaItem.id})`,
    )

    await persistMediaItem(mediaItem)

    ctx.update({
      progress: 1,
      stage: 'submitted',
      message: `Remote task submitted: ${taskId}`,
    })

    return {
      mediaId: mediaItem.id,
      provider: ctx.input.provider,
      taskId,
    }
  }

  private async submitBizyAirTask(
    mediaItem: UnifiedMediaItemData,
    signal: AbortSignal,
  ): Promise<string> {
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      throw new Error(`Unexpected source type for BizyAir submit: ${source.type}`)
    }

    const apiKey = await this.mediaModule.getBizyAirApiKey()
    if (!apiKey) {
      throw new Error('BizyAir API Key 未配置')
    }

    const appConfig = BizyAirConfigManager.getConfig(source.requestParams.task_config)
    const requestBuilder = BizyAirConfigManager.getRequestBuilder(source.requestParams.task_config)
    const requestData = requestBuilder(source.requestParams.task_config, appConfig)

    const taskId = await BizyAirAPIClient.submitAsyncTask(requestData, apiKey, signal)
    source.bizyairTaskId = taskId
    source.taskStatus = BizyAirTaskStatus.QUEUING
    source.errorMessage = undefined
    source.progress = 0

    return taskId
  }

  private getMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      throw new Error(`AI generated media item not found: ${mediaId}`)
    }

    return mediaItem
  }
}

export class RemoteTaskCompletedResolver
  implements ResourceResolver<RemoteTaskCompletedInput, RemoteTaskCompletedResult>
{
  readonly type = REMOTE_TASK_COMPLETED_RESOURCE_TYPE
  private abortControllers = new Map<string, AbortController>()

  constructor(private readonly mediaModule: AIGeneratedMediaModule) {}

  getKey(input: RemoteTaskCompletedInput): string {
    return `${input.provider}:${input.taskId}`
  }

  async isSatisfied(
    ctx: ResolveCheckContext<RemoteTaskCompletedInput>,
  ): Promise<RemoteTaskCompletedResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    if (
      !mediaItem ||
      !isAIGeneratedMediaItem(mediaItem) ||
      !hasCompletedResult(getAIGeneratedSourceFromMediaItem(mediaItem))
    ) {
      return null
    }

    return {
      mediaId: mediaItem.id,
      provider: ctx.input.provider,
      taskId: ctx.input.taskId,
    }
  }

  async resolve(ctx: ResolveContext<RemoteTaskCompletedInput>): Promise<RemoteTaskCompletedResult> {
    const mediaItem = this.getMediaItem(ctx.input.mediaId)
    const source = getAIGeneratedSourceFromMediaItem(mediaItem)

    if (hasCompletedResult(source)) {
      ctx.update({
        progress: 1,
        stage: 'completed',
        message: `Remote task already completed: ${ctx.input.taskId}`,
      })
      return {
        mediaId: mediaItem.id,
        provider: ctx.input.provider,
        taskId: ctx.input.taskId,
      }
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    this.abortControllers.set(ctx.input.taskId, controller)

    try {
      ctx.update({
        progress: normalizeProgress(source.progress),
        stage: 'polling',
        message: `Waiting for remote task: ${ctx.input.taskId}`,
      })

      if (ctx.input.provider === 'bizyair') {
        await this.waitForBizyAirCompletion(mediaItem, ctx, controller.signal)
      } else {
        await waitForBackendCompletion(mediaItem, ctx, controller.signal)
      }

      await persistMediaItem(mediaItem)

      ctx.update({
        progress: 1,
        stage: 'completed',
        message: `Remote task completed: ${ctx.input.taskId}`,
      })

      return {
        mediaId: mediaItem.id,
        provider: ctx.input.provider,
        taskId: ctx.input.taskId,
      }
    } catch (error) {
      await persistMediaItem(mediaItem)
      throw error
    } finally {
      this.abortControllers.delete(ctx.input.taskId)
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }

  async cancel(ctx: ResolveContext<RemoteTaskCompletedInput>): Promise<void> {
    this.abortControllers.get(ctx.input.taskId)?.abort()

    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      return
    }

    if (ctx.input.provider === 'bizyair') {
      const apiKey = await this.mediaModule.getBizyAirApiKey()
      if (apiKey) {
        await BizyAirAPIClient.cancelTask(ctx.input.taskId, apiKey)
      }
      if (BizyAirTypeGuards.isBizyAirSource(mediaItem.source)) {
        mediaItem.source.taskStatus = BizyAirTaskStatus.CANCELED
      }
    } else {
      await fetchClient.delete(`/api/media/tasks/${ctx.input.taskId}`)
      if (AIGenerationTypeGuards.isAIGenerationSource(mediaItem.source)) {
        mediaItem.source.taskStatus = TaskStatus.CANCELLED
      }
    }

    mediaItem.mediaStatus = 'cancelled'
    mediaItem.source.errorMessage = '任务已取消'
    await persistMediaItem(mediaItem)
  }

  private async waitForBizyAirCompletion(
    mediaItem: UnifiedMediaItemData,
    ctx: ResolveContext<RemoteTaskCompletedInput>,
    signal: AbortSignal,
  ): Promise<void> {
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      throw new Error(`Unexpected source type for BizyAir completion: ${source.type}`)
    }

    const apiKey = await this.mediaModule.getBizyAirApiKey()
    if (!apiKey) {
      throw new Error('BizyAir API Key 未配置')
    }

    const taskDetail = await BizyAirAPIClient.pollUntilComplete(
      ctx.input.taskId,
      apiKey,
      (progress, message) => {
        source.progress = progress
        mediaItem.mediaStatus = 'asyncprocessing'
        ctx.update({
          progress: Math.max(0.1, Math.min(0.95, progress / 100)),
          stage: 'polling',
          message,
        })
      },
      signal,
    )

    source.taskStatus = taskDetail.status

    if (taskDetail.status === BizyAirTaskStatus.FAILED) {
      mediaItem.mediaStatus = 'error'
      source.errorMessage = taskDetail.error?.message || 'BizyAir 任务失败'
      throw new Error(source.errorMessage)
    }

    if (taskDetail.status === BizyAirTaskStatus.CANCELED) {
      mediaItem.mediaStatus = 'cancelled'
      source.errorMessage = 'BizyAir 任务已取消'
      throw new Error(source.errorMessage)
    }

    const result = await BizyAirAPIClient.getTaskResults(ctx.input.taskId, apiKey, signal)
    source.resultData = {
      url: result.url,
      bizyair_task_id: ctx.input.taskId,
    }
    source.errorMessage = undefined
    mediaItem.mediaStatus = 'pending'
  }

  private getMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)
    if (!mediaItem || !isAIGeneratedMediaItem(mediaItem)) {
      throw new Error(`AI generated media item not found: ${mediaId}`)
    }

    return mediaItem
  }
}

export function createAIGeneratedMediaResolver(
  mediaModule: AIGeneratedMediaModule,
): AIGeneratedMediaResolver {
  return new AIGeneratedMediaResolver(mediaModule)
}

export function createAIInputPreparedResolver(
  mediaModule: AIGeneratedMediaModule,
): AIInputPreparedResolver {
  return new AIInputPreparedResolver(mediaModule)
}

export function createAITaskSubmittedResolver(
  mediaModule: AIGeneratedMediaModule,
): AITaskSubmittedResolver {
  return new AITaskSubmittedResolver(mediaModule)
}

export function createRemoteTaskCompletedResolver(
  mediaModule: AIGeneratedMediaModule,
): RemoteTaskCompletedResolver {
  return new RemoteTaskCompletedResolver(mediaModule)
}

export function createAIGeneratedMediaRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<AIGeneratedMediaInput> {
  return {
    type: AI_GENERATED_MEDIA_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'remote',
      maxRetries: 3,
      ...policy,
    },
  }
}

export function createAIInputPreparedRequest(
  mediaId: string,
  provider: AIGeneratedMediaProvider,
  policy?: ResourcePolicy,
): ResourceRequest<AIInputPreparedInput> {
  return {
    type: AI_INPUT_PREPARED_RESOURCE_TYPE,
    key: `${provider}:${mediaId}`,
    input: { mediaId, provider },
    policy: {
      queue: 'export',
      maxRetries: 1,
      ...policy,
    },
  }
}

export function createAITaskSubmittedRequest(
  mediaId: string,
  provider: AIGeneratedMediaProvider,
  policy?: ResourcePolicy,
): ResourceRequest<RemoteTaskSubmittedInput> {
  return {
    type: AI_TASK_SUBMITTED_RESOURCE_TYPE,
    key: `${provider}:${mediaId}`,
    input: { mediaId, provider },
    policy: {
      queue: 'remote',
      maxRetries: 3,
      ...policy,
    },
  }
}

export function createRemoteTaskCompletedRequest(
  mediaId: string,
  provider: AIGeneratedMediaProvider,
  taskId: string,
  policy?: ResourcePolicy,
): ResourceRequest<RemoteTaskCompletedInput> {
  return {
    type: REMOTE_TASK_COMPLETED_RESOURCE_TYPE,
    key: `${provider}:${taskId}`,
    input: { mediaId, provider, taskId },
    policy: {
      queue: 'remote',
      maxRetries: 3,
      ...policy,
    },
  }
}

async function submitBackendTask(
  mediaItem: UnifiedMediaItemData,
  signal: AbortSignal,
): Promise<string> {
  const source = mediaItem.source
  if (!AIGenerationTypeGuards.isAIGenerationSource(source)) {
    throw new Error(`Unexpected source type for backend submit: ${source.type}`)
  }

  const response = await fetchClient.post<TaskSubmitResponse>(
    '/api/media/generate',
    source.requestParams,
    { signal },
  )

  if (response.status !== 200) {
    throw new Error(`提交任务失败: ${response.statusText}`)
  }

  if (!response.data.success) {
    const details = response.data.error_details
    const message =
      (details && typeof details.error === 'string' && details.error) ||
      `提交任务失败: ${response.data.error_code}`
    throw new Error(message)
  }

  source.aiTaskId = response.data.task_id
  source.taskStatus = TaskStatus.PENDING
  source.errorMessage = undefined
  source.progress = 0

  return response.data.task_id
}

async function waitForBackendCompletion(
  mediaItem: UnifiedMediaItemData,
  ctx: ResolveContext<RemoteTaskCompletedInput>,
  signal: AbortSignal,
): Promise<void> {
  const source = mediaItem.source
  if (!AIGenerationTypeGuards.isAIGenerationSource(source)) {
    throw new Error(`Unexpected source type for backend completion: ${source.type}`)
  }

  let needReconnect = true
  let delaySeconds = 1

  while (needReconnect) {
    await fetchClient
      .stream(
        'GET',
        `/api/media/tasks/${ctx.input.taskId}/status`,
        (event: TaskStreamEvent): boolean | void => {
          if (event.type === TaskStreamEventType.PROGRESS_UPDATE) {
            source.taskStatus = event.status
            source.progress = event.progress
            source.errorMessage = undefined
            mediaItem.mediaStatus = 'asyncprocessing'
            ctx.update({
              progress: Math.max(0.1, Math.min(0.95, event.progress / 100)),
              stage: 'polling',
              message: event.message,
            })
            return false
          }

          if (event.type === TaskStreamEventType.FINAL) {
            const finalEvent = event as FinalEvent
            source.taskStatus = finalEvent.status
            source.progress = finalEvent.progress

            if (finalEvent.status === TaskStatus.FAILED) {
              source.errorMessage = finalEvent.message
              mediaItem.mediaStatus = 'error'
              throw new Error(finalEvent.message)
            }

            if (finalEvent.status === TaskStatus.CANCELLED) {
              source.errorMessage = finalEvent.message
              mediaItem.mediaStatus = 'cancelled'
              throw new Error(finalEvent.message)
            }

            if (!finalEvent.result_data) {
              throw new Error('FINAL 事件中缺少 result_data')
            }

            source.resultData = finalEvent.result_data
            source.errorMessage = undefined
            mediaItem.mediaStatus = 'pending'
            needReconnect = false
            return true
          }

          if (event.type === TaskStreamEventType.NOT_FOUND) {
            source.taskStatus = TaskStatus.FAILED
            source.errorMessage = event.message
            mediaItem.mediaStatus = 'error'
            throw new Error(event.message)
          }

          if (event.type === TaskStreamEventType.ERROR) {
            return true
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
}

function getProviderForMediaItem(mediaItem: UnifiedMediaItemData): AIGeneratedMediaProvider {
  return BizyAirTypeGuards.isBizyAirSource(getAIGeneratedSourceFromMediaItem(mediaItem))
    ? 'bizyair'
    : 'backend'
}

function getTaskId(source: AIGeneratedSource): string {
  return AIGenerationTypeGuards.isAIGenerationSource(source)
    ? source.aiTaskId
    : source.bizyairTaskId
}

function hasPreparedInput(source: AIGeneratedSource): boolean {
  return Boolean(source.requestParams)
}

function hasCompletedResult(source: AIGeneratedSource): boolean {
  if (AIGenerationTypeGuards.isAIGenerationSource(source)) {
    return source.taskStatus === TaskStatus.COMPLETED && Boolean(source.resultData)
  }

  return source.taskStatus === BizyAirTaskStatus.SUCCESS && Boolean(source.resultData)
}

function isTerminalFailure(mediaItem: UnifiedMediaItemData, source: AIGeneratedSource): boolean {
  if (mediaItem.mediaStatus === 'error' || mediaItem.mediaStatus === 'cancelled') {
    return true
  }

  if (AIGenerationTypeGuards.isAIGenerationSource(source)) {
    return source.taskStatus === TaskStatus.FAILED || source.taskStatus === TaskStatus.CANCELLED
  }

  return (
    source.taskStatus === BizyAirTaskStatus.FAILED ||
    source.taskStatus === BizyAirTaskStatus.CANCELED
  )
}

function toResult(mediaItem: UnifiedMediaItemData): AIGeneratedMediaResult {
  return {
    mediaId: mediaItem.id,
    status: 'ready',
  }
}

function normalizeProgress(progress: number | undefined): number {
  if (typeof progress !== 'number') {
    return 0
  }

  return Math.max(0, Math.min(1, progress / 100))
}

async function persistMediaItem(mediaItem: UnifiedMediaItemData): Promise<void> {
  const success = await globalMetaFileManager.saveMetaFile(mediaItem)
  if (!success) {
    throw new Error(`保存媒体元数据失败: ${mediaItem.name}`)
  }
}

function getAIGeneratedSourceFromMediaItem(mediaItem: UnifiedMediaItemData): AIGeneratedSource {
  if (AIGenerationTypeGuards.isAIGenerationSource(mediaItem.source)) {
    return mediaItem.source
  }

  if (BizyAirTypeGuards.isBizyAirSource(mediaItem.source)) {
    return mediaItem.source
  }

  throw new Error(`Media item is not AI generated: ${mediaItem.id}`)
}
