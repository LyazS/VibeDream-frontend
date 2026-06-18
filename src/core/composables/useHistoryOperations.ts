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
  UpdateTransitionConfigCommand,
  UpdateFilterConfigCommand,
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
import {
  ClearAllKeyframesCommand,
  type TimelineModule as KeyframeTimelineModule,
  type PlaybackControls,
} from '@/core/modules/commands/keyframeCommands'
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
import type { ChangePlan } from '@/core/property-system'

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

  async function updateTransitionConfigWithHistory(
    timelineItemId: string,
    nextTransitionConfig?: ClipTransitionOutConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新转场')
    if (!timelineItem) {
      return
    }

    const currentTransitionOut = TimelineItemQueries.getTransition(timelineItem)
      ? normalizeClipTransitionOutConfig(TimelineItemQueries.getTransition(timelineItem))
      : undefined
    const normalizedNextTransitionConfig = nextTransitionConfig
      ? normalizeClipTransitionOutConfig(nextTransitionConfig)
      : undefined

    const hasSameValue = areClipTransitionOutConfigsEqual(
      currentTransitionOut,
      normalizedNextTransitionConfig,
    )

    if (hasSameValue) {
      return
    }

    const command = new UpdateTransitionConfigCommand(
      timelineItemId,
      currentTransitionOut,
      normalizedNextTransitionConfig,
      unifiedTimelineModule,
    )
    await unifiedHistoryModule.executeCommand(command)
  }

  async function updateFilterConfigWithHistory(
    timelineItemId: string,
    nextFilterConfig?: ClipFilterConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '更新滤镜')
    if (!timelineItem) {
      return
    }

    const currentFilterConfig = timelineItem.exRenderConfig?.filter
      ? normalizeClipFilterConfig(timelineItem.exRenderConfig.filter)
      : undefined
    const normalizedNextFilterConfig = nextFilterConfig
      ? normalizeClipFilterConfig(nextFilterConfig)
      : undefined

    const hasSameValue = areClipFilterConfigsEqual(
      currentFilterConfig,
      normalizedNextFilterConfig,
    )

    if (hasSameValue) {
      return
    }

    await commitFilterConfigWithHistory(
      timelineItemId,
      currentFilterConfig,
      normalizedNextFilterConfig,
    )
  }

  async function commitFilterConfigWithHistory(
    timelineItemId: string,
    previousFilterConfig?: ClipFilterConfig,
    nextFilterConfig?: ClipFilterConfig,
  ) {
    const timelineItem = getEditableTimelineItemOrWarn(timelineItemId, '提交滤镜')
    if (!timelineItem) {
      return
    }

    const normalizedPreviousFilterConfig = previousFilterConfig
      ? normalizeClipFilterConfig(previousFilterConfig)
      : undefined
    const normalizedNextFilterConfig = nextFilterConfig
      ? normalizeClipFilterConfig(nextFilterConfig)
      : undefined

    const hasSameValue = areClipFilterConfigsEqual(
      normalizedPreviousFilterConfig,
      normalizedNextFilterConfig,
    )

    if (hasSameValue) {
      return
    }

    const command = new UpdateFilterConfigCommand(
      timelineItemId,
      normalizedPreviousFilterConfig,
      normalizedNextFilterConfig,
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

    const currentFilterEffect = timelineItem.exRenderConfig?.filter
      ? normalizeClipFilterConfig(timelineItem.exRenderConfig.filter)
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
      batch.addCommand(new UpdateFilterConfigCommand(
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

  return {
    addTimelineItemWithHistory,
    removeTimelineItemWithHistory,
    startASRRequestWithHistory,
    moveTimelineItemWithHistory,
    updatePlaybackRateWithHistory,
    updateTransitionConfigWithHistory,
    updateFilterConfigWithHistory,
    commitFilterConfigWithHistory,
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
    selectTimelineSelectionsWithHistory,
    clearAllKeyframesWithHistory,
    applyChangePlanWithHistory,
  }
}
