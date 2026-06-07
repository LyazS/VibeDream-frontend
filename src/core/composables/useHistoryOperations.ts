import type { MediaType } from '@/core'
import type { UnifiedTimelineItemData, VideoMediaConfig, AudioMediaConfig } from '@/core/timelineitem'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type { UnifiedTrackType, UnifiedTrackData } from '@/core/track/TrackTypes'
import type {
  UnifiedHistoryModule,
  UnifiedTimelineModule,
  UnifiedMediaModule,
  UnifiedConfigModule,
  UnifiedTrackModule,
  UnifiedSelectionModule,
} from '@/core/modules'
import {
  AddTimelineItemCommand,
  RemoveTimelineItemCommand,
  RemoveASRRequestCommand,
  StartASRRequestCommand,
  MoveTimelineItemCommand,
  UpdateVisualTransformCommand,
  UpdateAudioPropertiesCommand,
  type VisualTransformUpdate,
  type AudioPropertyUpdate,
  UpdateTransitionOutCommand,
  UpdateFilterEffectCommand,
  SplitTimelineItemCommand,
  ResizeTimelineItemCommand,
  AddTrackCommand,
  RemoveTrackCommand,
  RenameTrackCommand,
  ToggleTrackVisibilityCommand,
  ToggleTrackMuteCommand,
  SelectTimelineSelectionsCommand,
} from '@/core/modules/commands/timelineCommands'
import { ApplyChangePlanCommand } from '@/core/modules/commands/ApplyChangePlanCommand'
import { BatchAutoArrangeTrackCommand } from '@/core/modules/commands/batchCommands'
import { MoveTrackCommand } from '@/core/modules/commands/MoveTrackCommand'
import { TimelineItemQueries } from '@/core/timelineitem/'
import { duplicateTimelineItem } from '@/core/timelineitem/factory'
import { UpdateTextCommand } from '@/core/modules/commands/UpdateTextCommand'
import type { TextStyleConfig } from '@/core/timelineitem/texttype'
import {
  CreateKeyframeCommand,
  DeleteKeyframeCommand,
  UpdatePropertyCommand,
  UpdateMaskCommand,
  ClearAllKeyframesCommand,
  SetAnimationGroupValueCommand,
  ToggleAnimationGroupKeyframeCommand,
  BatchSetAnimationGroupValuesCommand,
  type TimelineModule as KeyframeTimelineModule,
  type PlaybackControls,
} from '@/core/modules/commands/keyframeCommands'
import type { MaskUpdateAction } from '@/core/modules/commands/keyframes/UpdateMaskCommand'
import { ToggleProportionalScaleCommand } from '@/core/modules/commands/ToggleProportionalScaleCommand'
import type {
  AnimationChannelKey,
  AnimationGroupId,
  AnimationGroupValueMap,
} from '@/core/timelineitem/bunnytype'
import { getAnimationGroupForProperty } from '@/core/timelineitem/bunnytype'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import {
  areClipTransitionOutConfigsEqual,
  normalizeClipTransitionOutConfig,
} from '@/core/timelineitem/transition'
import type { ClipFilterConfig } from '@/core/filter/types'
import {
  areClipFilterConfigsEqual,
  normalizeClipFilterConfig,
} from '@/core/timelineitem/filter'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { ChangePlan } from '@/core/property-mutation'

interface PlaybackRateUpdate {
  playbackRate: number
}

/**
 * 历史记录操作相关方法
 * 包括时间轴项目和轨道相关的历史记录操作方法
 */
export function useHistoryOperations(
  unifiedHistoryModule: UnifiedHistoryModule,
  unifiedTimelineModule: UnifiedTimelineModule,
  unifiedMediaModule: UnifiedMediaModule,
  unifiedConfigModule: UnifiedConfigModule,
  unifiedTrackModule: UnifiedTrackModule,
  unifiedSelectionModule: UnifiedSelectionModule,
  ensureTimelineItemResolved: (timelineItemId: string) => Promise<unknown>,
) {
  // ==================== 辅助函数 ====================

  /**
   * 检查变换属性是否有实际变化
   */
  function hasVisualTransformChanges(
    oldTransform: VisualTransformUpdate,
    newTransform: VisualTransformUpdate,
  ): boolean {
    if (
      newTransform.x !== undefined &&
      oldTransform.x !== undefined &&
      Math.abs(oldTransform.x - newTransform.x) > 0.1
    ) return true
    if (
      newTransform.y !== undefined &&
      oldTransform.y !== undefined &&
      Math.abs(oldTransform.y - newTransform.y) > 0.1
    ) return true
    if (
      newTransform.width !== undefined &&
      oldTransform.width !== undefined &&
      Math.abs(oldTransform.width - newTransform.width) > 0.1
    ) return true
    if (
      newTransform.height !== undefined &&
      oldTransform.height !== undefined &&
      Math.abs(oldTransform.height - newTransform.height) > 0.1
    ) return true
    if (
      newTransform.rotation !== undefined &&
      oldTransform.rotation !== undefined &&
      Math.abs(oldTransform.rotation - newTransform.rotation) > 0.001
    ) return true
    if (
      newTransform.opacity !== undefined &&
      oldTransform.opacity !== undefined &&
      Math.abs(oldTransform.opacity - newTransform.opacity) > 0.001
    ) return true
    if (
      newTransform.blendMode !== undefined &&
      oldTransform.blendMode !== undefined &&
      oldTransform.blendMode !== newTransform.blendMode
    ) return true
    return false
  }

  function hasAudioPropertyChanges(
    oldValues: AudioPropertyUpdate,
    newValues: AudioPropertyUpdate,
  ): boolean {
    return (
      oldValues.isMuted !== undefined &&
      newValues.isMuted !== undefined &&
      oldValues.isMuted !== newValues.isMuted
    )
  }

  function hasPlaybackRateChanges(
    oldValue: PlaybackRateUpdate,
    newValue: PlaybackRateUpdate,
  ): boolean {
    return Math.abs(oldValue.playbackRate - newValue.playbackRate) >= 0.01
  }

  function getEditableTimelineItemOrWarn(
    timelineItemId: string,
    action: string,
  ): UnifiedTimelineItemData<MediaType> | null {
    const timelineItem = unifiedTimelineModule.getTimelineItem(timelineItemId)
    if (!timelineItem) {
      console.warn(`⚠️ 时间轴项目不存在，无法${action}: ${timelineItemId}`)
      return null
    }

    if (TimelineItemQueries.isLoading(timelineItem)) {
      console.warn(`⚠️ loading 状态的时间轴项目不允许${action}: ${timelineItemId}`)
      return null
    }

    return timelineItem
  }

  // ==================== 时间轴项目历史记录方法 ====================

  /**
   * 带历史记录的添加时间轴项目方法
   * 会在拖动素材到时间轴和右键添加文本的时候使用
   * @param timelineItem 要添加的时间轴项目
   */
  async function addTimelineItemWithHistory(timelineItem: UnifiedTimelineItemData<MediaType>) {
    const command = new AddTimelineItemCommand(
      timelineItem,
      unifiedTimelineModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的删除时间轴项目方法
   * @param timelineItemId 要删除的时间轴项目ID
   */
  async function removeTimelineItemWithHistory(timelineItemId: string) {
    const timelineItem = unifiedTimelineModule.getTimelineItem(timelineItemId)
    const asrRequestId = getASRRequestIdFromTimelineItem(timelineItem)

    if (asrRequestId) {
      const command = new RemoveASRRequestCommand(
        asrRequestId,
        unifiedTimelineModule,
        unifiedMediaModule,
        ensureTimelineItemResolved,
        () => unifiedTimelineModule.timelineItems.value,
      )
      await unifiedHistoryModule.executeCommand(command)
      return
    }

    const command = new RemoveTimelineItemCommand(
      timelineItemId,
      unifiedTimelineModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  function getASRRequestIdFromTimelineItem(
    timelineItem: UnifiedTimelineItemData<MediaType> | undefined,
  ): string | null {
    if (!timelineItem) {
      return null
    }

    if (timelineItem.isPlaceholder && timelineItem.task?.kind === 'asr-subtitles') {
      return timelineItem.task.requestId
    }

    return null
  }

  /**
   * 带历史记录的移动时间轴项目方法
   * @param timelineItemId 要移动的时间轴项目ID
   * @param newPositionFrames 新的时间位置（帧数）
   * @param newTrackId 新的轨道ID（可选）
   */
  async function moveTimelineItemWithHistory(
    timelineItemId: string,
    newPositionFrames: number,
    newTrackId?: string,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '移动')
    if (!timelineItem) {
      return
    }

    // 获取当前位置和轨道
    const oldPositionFrames = timelineItem.timeRange.timelineStartTime // 帧数
    const oldTrackId = timelineItem.trackId
    const finalNewTrackId = newTrackId !== undefined ? newTrackId : oldTrackId

    // 检查是否有实际变化
    const positionChanged = Math.abs(oldPositionFrames - newPositionFrames) >= 1 // 允许1帧及以上的变化
    const trackChanged = oldTrackId !== finalNewTrackId

    if (!positionChanged && !trackChanged) {
      console.log('⚠️ 位置和轨道都没有变化，跳过移动操作')
      return
    }

    const command = new MoveTimelineItemCommand(
      timelineItemId,
      oldPositionFrames,
      newPositionFrames,
      oldTrackId,
      finalNewTrackId,
      unifiedTimelineModule,
      unifiedMediaModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的更新变换属性方法（增强版）
   * @param timelineItemId 要更新的时间轴项目ID
   * @param newTransform 新的变换属性
   */
  async function updateVisualTransformWithHistory(
    timelineItemId: string,
    newTransform: VisualTransformUpdate,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新视觉属性')
    if (!timelineItem) {
      return
    }

    if (!TimelineItemQueries.hasVisualProperties(timelineItem)) {
      console.warn(`⚠️ 时间轴项目不支持视觉属性更新: ${timelineItemId}`)
      return
    }

    const config = timelineItem.config as VideoMediaConfig
    const oldTransform: VisualTransformUpdate = {}

    if (newTransform.x !== undefined) oldTransform.x = config.x
    if (newTransform.y !== undefined) oldTransform.y = config.y
    if (newTransform.width !== undefined) oldTransform.width = config.width
    if (newTransform.height !== undefined) oldTransform.height = config.height
    if (newTransform.rotation !== undefined) oldTransform.rotation = config.rotation
    if (newTransform.opacity !== undefined) oldTransform.opacity = config.opacity
    if (newTransform.blendMode !== undefined) oldTransform.blendMode = config.blendMode

    if (!hasVisualTransformChanges(oldTransform, newTransform)) {
      console.log('⚠️ 视觉属性没有变化，跳过更新操作')
      return
    }

    const command = new UpdateVisualTransformCommand(
      timelineItemId,
      oldTransform,
      newTransform,
      unifiedTimelineModule,
      unifiedMediaModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function updateAudioPropertiesWithHistory(
    timelineItemId: string,
    newValues: AudioPropertyUpdate,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新音频属性')
    if (!timelineItem) {
      return
    }

    if (!TimelineItemQueries.hasAudioProperties(timelineItem)) {
      console.warn(`⚠️ 时间轴项目不支持音频属性更新: ${timelineItemId}`)
      return
    }

    const config = timelineItem.config as AudioMediaConfig
    const oldValues: AudioPropertyUpdate = {}

    if (newValues.isMuted !== undefined) {
      oldValues.isMuted = config.isMuted ?? false
    }

    if (!hasAudioPropertyChanges(oldValues, newValues)) {
      console.log('⚠️ 音频属性没有变化，跳过更新操作')
      return
    }

    const command = new UpdateAudioPropertiesCommand(
      timelineItemId,
      oldValues,
      newValues,
      unifiedTimelineModule,
      unifiedMediaModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function updatePlaybackRateWithHistory(
    timelineItemId: string,
    newPlaybackRate: number,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新播放速度')
    if (!timelineItem) {
      return
    }

    const oldValue: PlaybackRateUpdate = { playbackRate: 1 }
    if (
      TimelineItemQueries.isVideoTimelineItem(timelineItem) ||
      TimelineItemQueries.isAudioTimelineItem(timelineItem)
    ) {
      const timeRange = timelineItem.timeRange
      const clipDuration = timeRange.clipEndTime - timeRange.clipStartTime
      const timelineDuration = timeRange.timelineEndTime - timeRange.timelineStartTime
      if (timelineDuration > 0) {
        oldValue.playbackRate = clipDuration / timelineDuration
      }
    }

    const newValue: PlaybackRateUpdate = { playbackRate: newPlaybackRate }
    if (!hasPlaybackRateChanges(oldValue, newValue)) {
      console.log('⚠️ 播放速度没有变化，跳过更新操作')
      return
    }

    const timeRange = timelineItem.timeRange
    const clipDurationFrames = timeRange.clipEndTime - timeRange.clipStartTime
    const targetPlaybackRate = Math.max(0.1, Math.min(100, newPlaybackRate))
    const newTimelineDurationFrames = Math.max(1, Math.round(clipDurationFrames / targetPlaybackRate))
    const newTimeRange: UnifiedTimeRange = {
      timelineStartTime: timeRange.timelineStartTime,
      timelineEndTime: timeRange.timelineStartTime + newTimelineDurationFrames,
      clipStartTime: timeRange.clipStartTime,
      clipEndTime: timeRange.clipEndTime,
    }

    const command = new ResizeTimelineItemCommand(
      timelineItemId,
      timeRange,
      newTimeRange,
      unifiedTimelineModule,
      unifiedMediaModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function updateTransitionOutWithHistory(
    timelineItemId: string,
    nextTransitionOut?: ClipTransitionOutConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新转场')
    if (!timelineItem) {
      return
    }

    const currentTransitionOut = timelineItem.transitionOut
      ? normalizeClipTransitionOutConfig(timelineItem.transitionOut)
      : undefined
    const normalizedNextTransitionOut = nextTransitionOut
      ? normalizeClipTransitionOutConfig(nextTransitionOut)
      : undefined

    const hasSameValue = areClipTransitionOutConfigsEqual(
      currentTransitionOut,
      normalizedNextTransitionOut,
    )

    if (hasSameValue) {
      return
    }

    const command = new UpdateTransitionOutCommand(
      timelineItemId,
      currentTransitionOut,
      normalizedNextTransitionOut,
      unifiedTimelineModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function updateFilterEffectWithHistory(
    timelineItemId: string,
    nextFilterEffect?: ClipFilterConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新滤镜')
    if (!timelineItem) {
      return
    }

    const currentFilterEffect = timelineItem.filterEffect
      ? normalizeClipFilterConfig(timelineItem.filterEffect)
      : undefined
    const normalizedNextFilterEffect = nextFilterEffect
      ? normalizeClipFilterConfig(nextFilterEffect)
      : undefined

    const hasSameValue = areClipFilterConfigsEqual(
      currentFilterEffect,
      normalizedNextFilterEffect,
    )

    if (hasSameValue) {
      return
    }

    await commitFilterEffectWithHistory(
      timelineItemId,
      currentFilterEffect,
      normalizedNextFilterEffect,
    )
  }

  async function commitFilterEffectWithHistory(
    timelineItemId: string,
    previousFilterEffect?: ClipFilterConfig,
    nextFilterEffect?: ClipFilterConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '提交滤镜')
    if (!timelineItem) {
      return
    }

    const normalizedPreviousFilterEffect = previousFilterEffect
      ? normalizeClipFilterConfig(previousFilterEffect)
      : undefined
    const normalizedNextFilterEffect = nextFilterEffect
      ? normalizeClipFilterConfig(nextFilterEffect)
      : undefined

    const hasSameValue = areClipFilterConfigsEqual(
      normalizedPreviousFilterEffect,
      normalizedNextFilterEffect,
    )

    if (hasSameValue) {
      return
    }

    const command = new UpdateFilterEffectCommand(
      timelineItemId,
      normalizedPreviousFilterEffect,
      normalizedNextFilterEffect,
      unifiedTimelineModule,
      unifiedMediaModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function removeFilterEffectWithHistory(timelineItemId: string) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '移除滤镜')
    if (!timelineItem) {
      return
    }

    const currentFilterEffect = timelineItem.filterEffect
      ? normalizeClipFilterConfig(timelineItem.filterEffect)
      : undefined
    const filterIntensityTrack = (timelineItem.animation?.groups as
      | Record<string, { keyframes?: unknown[] }>
      | undefined)?.['filter.intensity']
    const hasFilterIntensityKeyframes = Boolean(
      filterIntensityTrack?.keyframes?.length,
    )

    if (!currentFilterEffect && !hasFilterIntensityKeyframes) {
      return
    }

    const batch = unifiedHistoryModule.startBatch('移除片段滤镜')

    if (currentFilterEffect) {
      batch.addCommand(new UpdateFilterEffectCommand(
        timelineItemId,
        currentFilterEffect,
        undefined,
        unifiedTimelineModule,
        unifiedMediaModule,
      ))
    }

    if (hasFilterIntensityKeyframes) {
      batch.addCommand(new ClearAllKeyframesCommand(
        timelineItemId,
        'filter.intensity',
        unifiedTimelineModule,
        {
          seekTo: (nextFrame: number) => {
            console.log('🔍 滤镜关键帧清除播放头控制:', nextFrame)
          },
        },
      ))
    }

    await unifiedHistoryModule.executeBatchCommand(batch.build())
  }

  /**
   * 带历史记录的分割时间轴项目方法
   * @param timelineItemId 要分割的时间轴项目ID
   * @param splitTimeFrames 分割时间点数组（帧数），按时间顺序排列
   */
  async function splitTimelineItemAtTimeWithHistory(
    timelineItemId: string,
    splitTimeFrames: number[],
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '分割')
    if (!timelineItem) {
      return
    }

    const command = new SplitTimelineItemCommand(
      timelineItemId,
      timelineItem,
      splitTimeFrames,
      unifiedTimelineModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的复制时间轴项目方法
   * @param timelineItemId 要复制的时间轴项目ID
   * @param newPositionFrames 新项目的时间位置（帧数，可选）
   * @param newTrackId 新项目的轨道ID（可选）
   */
  async function duplicateTimelineItemWithHistory(
    timelineItemId: string,
    newPositionFrames?: number,
    newTrackId?: string,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '复制')
    if (!timelineItem) {
      return
    }

    // 计算时间偏移
    const currentPosition = timelineItem.timeRange.timelineStartTime
    const targetPosition = newPositionFrames || timelineItem.timeRange.timelineEndTime
    const timeOffset = targetPosition - currentPosition

    // 使用 TimelineItemFactory 复制项目
    const duplicatedItem = duplicateTimelineItem(
      timelineItem,
      newTrackId || timelineItem.trackId,
      timeOffset,
    )

    // 使用 AddTimelineItemCommand 添加复制后的项目
    const command = new AddTimelineItemCommand(
      duplicatedItem,
      unifiedTimelineModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的调整时间轴项目大小方法
   * @param timelineItemId 要调整的时间轴项目ID
   * @param newTimeRange 新的时间范围
   */
  async function resizeTimelineItemWithHistory(
    timelineItemId: string,
    newTimeRange: UnifiedTimeRange,
  ): Promise<boolean> {
    try {
      console.log('🔧 [UnifiedStore] 调整时间轴项目大小:', {
        timelineItemId,
        newTimeRange,
      })

      // 获取当前项目
      const currentItem = getEditableTimelineItemOrWarn(timelineItemId, '调整时间范围')
      if (!currentItem) {
        return false
      }

      // 检查时间范围是否有变化
      const currentTimeRange = currentItem.timeRange
      if (
        currentTimeRange.timelineStartTime === newTimeRange.timelineStartTime &&
        currentTimeRange.timelineEndTime === newTimeRange.timelineEndTime
      ) {
        console.log('ℹ️ [UnifiedStore] 时间范围无变化，跳过调整')
        return true
      }

      // 创建调整大小命令
      const command = new ResizeTimelineItemCommand(
        timelineItemId,
        currentTimeRange,
        newTimeRange,
        unifiedTimelineModule,
        unifiedMediaModule,
      )

      // 执行命令
      await unifiedHistoryModule.executeCommand(command)
      console.log('✅ [UnifiedStore] 时间轴项目大小调整成功')
      return true
    } catch (error) {
      console.error('❌ [UnifiedStore] 调整时间轴项目大小时发生错误:', error)
      return false
    }
  }

  /**
   * 带历史记录的添加轨道方法
   * @param type 轨道类型
   * @param position 插入位置（可选）
   */
  async function addTrackWithHistory(type: UnifiedTrackType = 'video', position?: number) {
    const command = new AddTrackCommand(type, position, unifiedTrackModule)
    await unifiedHistoryModule.executeCommand(command)
  }

  async function startASRRequestWithHistory(
    sourceTimelineItem: UnifiedTimelineItemData<MediaType>,
    estimatedDurationSeconds: number,
    requestId: string,
    remoteTaskId: string,
  ) {
    const durationFrames = Math.max(1, Math.round(estimatedDurationSeconds * RENDERER_FPS))
    const command = new StartASRRequestCommand(
      sourceTimelineItem,
      durationFrames,
      requestId,
      remoteTaskId,
      unifiedTimelineModule,
      unifiedTrackModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的删除轨道方法
   * @param trackId 要删除的轨道ID
   */
  async function removeTrackWithHistory(trackId: string) {
    // 获取要删除的轨道
    const track = unifiedTrackModule.getTrack(trackId)
    if (!track) {
      console.warn(`⚠️ 轨道不存在，无法删除: ${trackId}`)
      return
    }

    const command = new RemoveTrackCommand(
      trackId,
      unifiedTrackModule,
      unifiedTimelineModule,
      unifiedMediaModule,
      ensureTimelineItemResolved,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的重命名轨道方法
   * @param trackId 要重命名的轨道ID
   * @param newName 新名称
   */
  async function renameTrackWithHistory(trackId: string, newName: string) {
    // 获取要重命名的轨道
    const track = unifiedTrackModule.getTrack(trackId)
    if (!track) {
      console.warn(`⚠️ 轨道不存在，无法重命名: ${trackId}`)
      return
    }

    const command = new RenameTrackCommand(trackId, newName, unifiedTrackModule)
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的自动排列轨道方法
   * 根据轨道ID自动排列该轨道上的所有时间轴项目
   * @param trackId 要排列的轨道ID
   */
  async function autoArrangeTrackWithHistory(trackId: string) {
    const command = new BatchAutoArrangeTrackCommand(
      trackId,
      unifiedTimelineModule.timelineItems.value.filter((item) => item.trackId === trackId),
      unifiedTimelineModule,
      unifiedMediaModule,
      unifiedTrackModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的切换轨道可见性方法
   * @param trackId 要切换的轨道ID
   */
  async function toggleTrackVisibilityWithHistory(trackId: string) {
    // 获取要切换的轨道
    const track = unifiedTrackModule.getTrack(trackId)
    if (!track) {
      console.warn(`⚠️ 轨道不存在，无法切换可见性: ${trackId}`)
      return
    }

    const command = new ToggleTrackVisibilityCommand(trackId, unifiedTrackModule)
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的切换轨道静音方法
   * @param trackId 要切换的轨道ID
   */
  async function toggleTrackMuteWithHistory(trackId: string) {
    // 获取要切换的轨道
    const track = unifiedTrackModule.getTrack(trackId)
    if (!track) {
      console.warn(`⚠️ 轨道不存在，无法切换静音: ${trackId}`)
      return
    }

    const command = new ToggleTrackMuteCommand(trackId, unifiedTrackModule)
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的移动轨道方法
   * @param trackId 要移动的轨道ID
   * @param newPosition 新位置索引
   */
  async function moveTrackWithHistory(trackId: string, newPosition: number) {
    // 获取当前轨道位置
    const currentPosition = unifiedTrackModule.trackIndexMap.value.get(trackId)
    if (currentPosition === undefined) {
      console.warn(`⚠️ 轨道位置未知，无法移动: ${trackId}`)
      return
    }

    // 检查位置是否真的改变了
    if (currentPosition === newPosition) {
      console.log('ℹ️ 轨道位置未改变，跳过移动')
      return
    }

    const command = new MoveTrackCommand(trackId, currentPosition, newPosition, unifiedTrackModule)
    await unifiedHistoryModule.executeCommand(command)
  }

  /**
   * 带历史记录的更新文本内容方法
   * @param timelineItemId 要更新的时间轴项目ID
   * @param newText 新的文本内容
   * @param newStyle 新的文本样式（可选）
   */
  async function updateTextContentWithHistory(
    timelineItemId: string,
    newText: string,
    newStyle: Partial<TextStyleConfig> = {},
  ) {
    // 验证文本项目存在
    const timelineItem = unifiedTimelineModule.getTimelineItem(timelineItemId)
    if (!timelineItem || !TimelineItemQueries.isTextTimelineItem(timelineItem)) {
      console.warn(`⚠️ 文本项目不存在或类型错误: ${timelineItemId}`)
      return
    }

    // 检查文本内容是否有实际变化
    if (timelineItem.config.text === newText.trim() && Object.keys(newStyle).length === 0) {
      console.log('⚠️ 文本内容没有变化，跳过更新操作')
      return
    }

    try {
      console.log('🔄 [useHistoryOperations] 更新文本内容:', {
        timelineItemId,
        newText: newText.substring(0, 20) + (newText.length > 20 ? '...' : ''),
        hasStyleUpdate: Object.keys(newStyle).length > 0,
      })

      // 创建更新文本命令
      const command = new UpdateTextCommand(
        timelineItemId,
        newText.trim(),
        newStyle,
        {
          getTimelineItem: (id: string) =>
            unifiedTimelineModule.getTimelineItem(id) as
              | UnifiedTimelineItemData<'text'>
              | undefined,
        },
        unifiedConfigModule,
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 文本内容更新成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 更新文本内容失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的更新文本样式方法
   * @param timelineItemId 要更新的时间轴项目ID
   * @param newStyle 新的文本样式
   */
  async function updateTextStyleWithHistory(
    timelineItemId: string,
    newStyle: Partial<TextStyleConfig>,
  ) {
    // 验证文本项目存在
    const timelineItem = unifiedTimelineModule.getTimelineItem(timelineItemId)
    if (!timelineItem || !TimelineItemQueries.isTextTimelineItem(timelineItem)) {
      console.warn(`⚠️ 文本项目不存在或类型错误: ${timelineItemId}`)
      return
    }

    // 获取当前样式进行对比
    const currentStyle = timelineItem.config.style
    if (!currentStyle) {
      console.warn(`⚠️ 文本项目样式数据不存在: ${timelineItemId}`)
      return
    }

    // 检查样式是否有实际变化
    const hasChanges = Object.keys(newStyle).some((key) => {
      const styleKey = key as keyof TextStyleConfig
      return newStyle[styleKey] !== currentStyle[styleKey]
    })

    if (!hasChanges) {
      console.log('⚠️ 文本样式没有变化，跳过更新操作')
      return
    }

    try {
      console.log('🔄 [useHistoryOperations] 更新文本样式:', {
        timelineItemId,
        styleChanges: Object.keys(newStyle),
        currentText:
          timelineItem.config.text.substring(0, 20) +
          (timelineItem.config.text.length > 20 ? '...' : ''),
      })

      // 创建更新文本命令（保持文本内容不变，只更新样式）
      const command = new UpdateTextCommand(
        timelineItemId,
        timelineItem.config.text, // 保持文本内容不变
        newStyle,
        {
          getTimelineItem: (id: string) =>
            unifiedTimelineModule.getTimelineItem(id) as
              | UnifiedTimelineItemData<'text'>
              | undefined,
        },
        unifiedConfigModule,
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 文本样式更新成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 更新文本样式失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的选择时间轴项目方法
   * @param itemIds 要操作的项目ID数组
   * @param mode 操作模式：'replace'替换选择，'toggle'切换选择状态
   * @param selectionModule 选择模块实例，提供选择状态和方法
   */
  async function selectTimelineSelectionsWithHistory(
    itemIds: string[],
    mode: 'replace' | 'toggle' = 'replace',
  ) {
    const currentSelection = new Set(unifiedSelectionModule.selectedTimelineSelectionIds.value)
    const newSelection = calculateNewSelection(itemIds, mode, currentSelection)

    // 如果选择状态没有变化，不创建历史记录
    if (setsEqual(currentSelection, newSelection)) {
      console.log('🎯 选择状态无变化，跳过历史记录')
      return
    }

    try {
      console.log('🎯 [useHistoryOperations] 选择时间轴项目:', {
        itemIds,
        mode,
        currentSelectionSize: currentSelection.size,
        newSelectionSize: newSelection.size,
      })

      // 创建选择命令
      const command = new SelectTimelineSelectionsCommand(
        itemIds as any,
        mode,
        unifiedSelectionModule,
        unifiedTimelineModule,
        unifiedMediaModule,
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 时间轴项目选择成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 时间轴项目选择失败:', error)
      throw error
    }
  }

  /**
   * 计算新的选择状态
   */
  function calculateNewSelection(
    itemIds: string[],
    mode: 'replace' | 'toggle',
    currentSelection: Set<string>,
  ): Set<string> {
    const newSelection = new Set(currentSelection)

    if (mode === 'replace') {
      newSelection.clear()
      itemIds.forEach((id) => newSelection.add(id))
    } else {
      itemIds.forEach((id) => {
        if (newSelection.has(id)) {
          newSelection.delete(id)
        } else {
          newSelection.add(id)
        }
      })
    }

    return newSelection
  }

  /**
   * 检查两个Set是否相等
   */
  function setsEqual(set1: Set<string>, set2: Set<string>): boolean {
    if (set1.size !== set2.size) return false
    for (const item of set1) {
      if (!set2.has(item)) return false
    }
    return true
  }

  /**
   * 带历史记录的创建关键帧方法
   * @param timelineItemId 时间轴项目ID
   * @param frame 帧数
   */
  async function createKeyframeWithHistory(
    timelineItemId: string,
    frame: number,
    groupId: AnimationChannelKey = 'transform.position',
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '创建关键帧')) {
      return
    }

    try {
      console.log('🎬 [useHistoryOperations] 创建关键帧:', { timelineItemId, frame })

      // 创建关键帧命令
      const command = new CreateKeyframeCommand(
        timelineItemId,
        frame,
        groupId,
        unifiedTimelineModule,
        {
          seekTo: (frame: number) => {
            // 播放头控制应该由调用方提供，这里简化为不控制播放头
            console.log('🔍 关键帧操作播放头控制:', frame)
          },
        },
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 关键帧创建成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 关键帧创建失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的删除关键帧方法
   * @param timelineItemId 时间轴项目ID
   * @param frame 帧数
   */
  async function deleteKeyframeWithHistory(timelineItemId: string, frame: number) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '删除关键帧')) {
      return
    }

    try {
      console.log('🎬 [useHistoryOperations] 删除关键帧:', { timelineItemId, frame })

      // 创建删除关键帧命令
      const command = new DeleteKeyframeCommand(
        timelineItemId,
        frame,
        'transform.position',
        unifiedTimelineModule,
        {
          seekTo: (frame: number) => {
            console.log('🔍 关键帧操作播放头控制:', frame)
          },
        },
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 关键帧删除成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 关键帧删除失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的更新关键帧属性方法
   * @param timelineItemId 时间轴项目ID
   * @param frame 帧数
   * @param property 属性名
   * @param value 新值
   */
  async function updateAnimationGroupValueWithHistory<G extends AnimationGroupId>(
    timelineItemId: string,
    frame: number,
    groupId: G,
    patch: Partial<AnimationGroupValueMap[G]>,
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '更新动画组')) {
      return
    }

    try {
      const command = new SetAnimationGroupValueCommand(
        timelineItemId,
        frame,
        groupId,
        patch,
        unifiedTimelineModule,
        {
          seekTo: (nextFrame: number) => {
            console.log('🔍 动画组操作播放头控制:', nextFrame)
          },
        },
      )

      await unifiedHistoryModule.executeCommand(command)
    } catch (error) {
      console.error('❌ [useHistoryOperations] 动画组更新失败:', error)
      throw error
    }
  }

  async function applyChangePlanWithHistory(plan: ChangePlan) {
    const targetItemIds = new Set(plan.operations.map((operation) => operation.timelineItemId))
    for (const timelineItemId of targetItemIds) {
      if (!getEditableTimelineItemOrWarn(timelineItemId, '应用属性修改计划')) {
        return
      }
    }

    try {
      const command = new ApplyChangePlanCommand(
        plan,
        unifiedTimelineModule,
        {
          seekTo: (nextFrame: number) => {
            console.log('🔍 属性修改计划播放头控制:', nextFrame)
          },
        },
      )

      await unifiedHistoryModule.executeCommand(command)
    } catch (error) {
      console.error('❌ [useHistoryOperations] 属性修改计划执行失败:', error)
      throw error
    }
  }

  async function updateAnimationGroupsBatchWithHistory(
    timelineItemId: string,
    frame: number,
    updates: Array<{
      groupId: AnimationGroupId
      patch: Partial<AnimationGroupValueMap[AnimationGroupId]>
    }>,
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '批量更新动画组')) {
      return
    }

    try {
      const commands = updates.map((update) => new SetAnimationGroupValueCommand(
        timelineItemId,
        frame,
        update.groupId,
        update.patch,
        unifiedTimelineModule,
        {
          seekTo: (nextFrame: number) => {
            console.log('🔍 动画组批量操作播放头控制:', nextFrame)
          },
        },
      ))

      await unifiedHistoryModule.executeBatchCommand(
        new BatchSetAnimationGroupValuesCommand([timelineItemId], commands),
      )
    } catch (error) {
      console.error('❌ [useHistoryOperations] 动画组批量更新失败:', error)
      throw error
    }
  }

  async function updatePropertyWithHistory(
    timelineItemId: string,
    frame: number,
    property: string,
    value: any,
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '更新关键帧属性')) {
      return
    }

    const groupId = getAnimationGroupForProperty(property)
    if (groupId && typeof value === 'number') {
      const patchKey = property.startsWith('mask.')
        ? property.replace('mask.', '')
        : property.startsWith('filter.')
          ? property.replace('filter.', '')
        : property
      await updateAnimationGroupValueWithHistory(
        timelineItemId,
        frame,
        groupId,
        { [patchKey]: value } as never,
      )
      return
    }

    try {
      console.log('🎬 [useHistoryOperations] 更新关键帧属性:', {
        timelineItemId,
        frame,
        property,
        value,
      })

      // 创建更新属性命令
      const command = new UpdatePropertyCommand(
        timelineItemId,
        frame,
        property,
        value,
        unifiedTimelineModule,
        {
          seekTo: (frame: number) => {
            console.log('🔍 关键帧操作播放头控制:', frame)
          },
        },
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 关键帧属性更新成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 关键帧属性更新失败:', error)
      throw error
    }
  }

  async function updateMaskWithHistory(
    timelineItemId: string,
    frame: number,
    action: MaskUpdateAction,
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '更新蒙版')) {
      return
    }

    try {
      const command = new UpdateMaskCommand(
        timelineItemId,
        frame,
        action,
        unifiedTimelineModule,
        unifiedMediaModule,
        {
          seekTo: (frame: number) => {
            console.log('🔍 蒙版操作播放头控制:', frame)
          },
        },
      )

      await unifiedHistoryModule.executeCommand(command)
    } catch (error) {
      console.error('❌ [useHistoryOperations] 蒙版更新失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的清除所有关键帧方法
   * @param timelineItemId 时间轴项目ID
   */
  async function clearAllKeyframesWithHistory(timelineItemId: string, channel?: any) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '清除关键帧')) {
      return
    }

    try {
      console.log('🎬 [useHistoryOperations] 清除所有关键帧:', { timelineItemId })

      // 创建清除所有关键帧命令
      const command = new ClearAllKeyframesCommand(timelineItemId, channel, unifiedTimelineModule, {
        seekTo: (frame: number) => {
          console.log('🔍 关键帧操作播放头控制:', frame)
        },
      })

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 所有关键帧清除成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 清除所有关键帧失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的切换关键帧方法
   * @param timelineItemId 时间轴项目ID
   * @param frame 帧数
   */
  async function toggleKeyframeWithHistory(
    timelineItemId: string,
    frame: number,
    channel: AnimationChannelKey = 'transform.position',
  ) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '切换关键帧')) {
      return
    }

    try {
      const command = new ToggleAnimationGroupKeyframeCommand(
        timelineItemId,
        frame,
        channel,
        unifiedTimelineModule,
        {
          seekTo: (frame: number) => {
            console.log('🔍 关键帧操作播放头控制:', frame)
          },
        },
      )

      // 执行命令（带历史记录）
      await unifiedHistoryModule.executeCommand(command)
    } catch (error) {
      console.error('❌ [useHistoryOperations] 关键帧切换失败:', error)
      throw error
    }
  }

  /**
   * 带历史记录的切换等比缩放方法
   * @param timelineItemId 时间轴项目ID
   * @param frame 当前帧
   */
  async function toggleProportionalScaleWithHistory(timelineItemId: string, frame: number) {
    if (!getEditableTimelineItemOrWarn(timelineItemId, '切换等比缩放')) {
      return
    }

    try {
      console.log('🎬 [useHistoryOperations] 切换等比缩放:', { timelineItemId, frame })

      const command = new ToggleProportionalScaleCommand(timelineItemId, frame, {
        getTimelineItem: unifiedTimelineModule.getTimelineItem,
        getMediaItem: unifiedMediaModule.getMediaItem,
      })

      await unifiedHistoryModule.executeCommand(command)

      console.log('✅ [useHistoryOperations] 等比缩放切换成功')
    } catch (error) {
      console.error('❌ [useHistoryOperations] 等比缩放切换失败:', error)
      throw error
    }
  }

  return {
    addTimelineItemWithHistory,
    removeTimelineItemWithHistory,
    startASRRequestWithHistory,
    moveTimelineItemWithHistory,
    updateVisualTransformWithHistory,
    updateAudioPropertiesWithHistory,
    updatePlaybackRateWithHistory,
    updateTransitionOutWithHistory,
    updateFilterEffectWithHistory,
    commitFilterEffectWithHistory,
    removeFilterEffectWithHistory,
    splitTimelineItemAtTimeWithHistory,
    duplicateTimelineItemWithHistory,
    resizeTimelineItemWithHistory,
    addTrackWithHistory,
    removeTrackWithHistory,
    renameTrackWithHistory,
    autoArrangeTrackWithHistory,
    toggleTrackVisibilityWithHistory,
    toggleTrackMuteWithHistory,
    moveTrackWithHistory,
    updateTextContentWithHistory,
    updateTextStyleWithHistory,
    selectTimelineSelectionsWithHistory,
    createKeyframeWithHistory,
    deleteKeyframeWithHistory,
    updatePropertyWithHistory,
    updateMaskWithHistory,
    clearAllKeyframesWithHistory,
    toggleKeyframeWithHistory,
    applyChangePlanWithHistory,
    updateAnimationGroupValueWithHistory,
    updateAnimationGroupsBatchWithHistory,
    toggleProportionalScaleWithHistory,
  }
}
