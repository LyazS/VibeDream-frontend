/**
 * 操作配置到命令的转换工厂
 * Phase 2：支持 addTimelineItem, rmTimelineItem, mvTimelineItem, resizeTimelineItem 操作
 * Phase 3：支持 addTrack, removeTrack, renameTrack, toggleTrackMute, toggleTrackVisibility 操作
 */

import type { SimpleCommand } from '@/core/modules/commands/types'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { OperationConfig } from './types'
import { AddTimelineItemCommand } from '@/core/modules/commands/AddTimelineItemCommand'
import { RemoveTimelineItemCommand } from '@/core/modules/commands/RemoveTimelineItemCommand'
import { MoveTimelineItemCommand } from '@/core/modules/commands/MoveTimelineItemCommand'
import { ResizeTimelineItemCommand } from '@/core/modules/commands/ResizeTimelineItemCommand'
import { AddTrackCommand } from '@/core/modules/commands/AddTrackCommand'
import { RemoveTrackCommand } from '@/core/modules/commands/RemoveTrackCommand'
import { RenameTrackCommand } from '@/core/modules/commands/RenameTrackCommand'
import { ToggleTrackMuteCommand } from '@/core/modules/commands/ToggleTrackMuteCommand'
import { ToggleTrackVisibilityCommand } from '@/core/modules/commands/ToggleTrackVisibilityCommand'
import { UpdateTransformCommand } from '@/core/modules/commands/UpdateTransformCommand'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { MediaItemQueries } from '@/core/mediaitem'
import { generateTimelineItemId } from '@/core/utils/idGenerator'
import { computed } from 'vue'

/**
 * 命令工厂类
 * 将操作配置转换为编辑器内部命令
 */
export class CommandFactory {
  /**
   * 将操作配置转换为命令
   * Phase 2：支持 addTimelineItem, rmTimelineItem, mvTimelineItem, resizeTimelineItem 操作
   * Phase 3：支持 addTrack, removeTrack, renameTrack, toggleTrackMute, toggleTrackVisibility 操作
   * 注意：此方法现在是异步的，以支持 addTimelineItem 中的 pending 状态等待
   */
  async createCommand(op: OperationConfig): Promise<SimpleCommand> {
    const { type, params } = op

    switch (type) {
      case 'addTimelineItem':
        return await this.createAddTimelineItemCommand(params)
      case 'rmTimelineItem':
        return this.createRmTimelineItemCommand(params)
      case 'mvTimelineItem':
        return this.createMvTimelineItemCommand(params)
      case 'resizeTimelineItem':
        return this.createResizeTimelineItemCommand(params)
      case 'addTrack':
        return this.createAddTrackCommand(params)
      case 'removeTrack':
        return this.createRemoveTrackCommand(params)
      case 'renameTrack':
        return this.createRenameTrackCommand(params)
      case 'toggleTrackMute':
        return this.createToggleTrackMuteCommand(params)
      case 'toggleTrackVisibility':
        return this.createToggleTrackVisibilityCommand(params)
      case 'updateTimelineItem':
        return this.createUpdateTimelineItemCommand(params)
      default:
        throw new Error(`不支持的操作类型: ${type}`)
    }
  }

  /**
   * 创建添加时间轴项目命令
   */
  private async createAddTimelineItemCommand(params: any): Promise<SimpleCommand> {
    const unifiedStore = useUnifiedStore()

    // 获取素材
    let mediaItem = unifiedStore.getMediaItem(params.mediaItemId)
    if (!mediaItem) {
      throw new Error(`素材不存在: ${params.mediaItemId}`)
    }

    // 检查并等待媒体就绪（如果处于 pending 状态）
    if (mediaItem.mediaStatus === 'pending') {
      // 启动媒体处理
      unifiedStore.startMediaProcessing(mediaItem)

      // 等待媒体就绪
      try {
        await unifiedStore.waitForMediaItemReady(mediaItem.id)
      } catch (error) {
        throw new Error(`媒体处理失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 获取模块引用
    const timelineModule = this.getTimelineModule()
    const mediaModule = this.getMediaModule()
    const configModule = this.getConfigModule()

    // 构建时间轴项目数据
    const timelineItem = this.buildTimelineItemFromParams(params)

    // 创建命令
    return new AddTimelineItemCommand(
      timelineItem,
      timelineModule,
      mediaModule,
      configModule,
    )
  }

  /**
   * 创建删除时间轴项目命令
   */
  private createRmTimelineItemCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证片段存在
    const timelineItem = unifiedStore.getTimelineItem(params.itemId)
    if (!timelineItem) {
      throw new Error(`时间轴项目不存在: ${params.itemId}`)
    }

    // 获取模块引用
    const timelineModule = this.getTimelineModule()
    const mediaModule = this.getMediaModule()
    const configModule = this.getConfigModule()

    // 创建命令
    return new RemoveTimelineItemCommand(params.itemId, timelineModule, mediaModule, configModule)
  }

  /**
   * 创建移动时间轴项目命令
   */
  private createMvTimelineItemCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证片段存在
    const timelineItem = unifiedStore.getTimelineItem(params.itemId)
    if (!timelineItem) {
      throw new Error(`时间轴项目不存在: ${params.itemId}`)
    }

    // 获取当前位置和轨道
    const oldPositionFrames = timelineItem.timeRange.timelineStartTime
    const oldTrackId = timelineItem.trackId

    // 时间码转帧
    const newPositionFrames = this.timecodeToFrames(params.newPosition)

    // 如果提供了 newTrackId，验证轨道存在
    const newTrackId: string = params.newTrackId ?? timelineItem.trackId
    if (params.newTrackId) {
      const targetTrack = unifiedStore.tracks.find(track => track.id === params.newTrackId)
      if (!targetTrack) {
        throw new Error(`目标轨道不存在: ${params.newTrackId}`)
      }

      // 验证轨道类型兼容性
      if (targetTrack.type !== timelineItem.mediaType) {
        throw new Error(
          `轨道类型不匹配：${timelineItem.mediaType} 类型素材不能添加到 ${targetTrack.type} 轨道`,
        )
      }
    }

    // 获取模块引用
    const timelineModule = {
      updateTimelineItemPosition: unifiedStore.updateTimelineItemPosition.bind(unifiedStore),
      getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
    }
    const mediaModule = this.getMediaModule()

    // 创建命令
    return new MoveTimelineItemCommand(
      params.itemId,
      oldPositionFrames,
      newPositionFrames,
      oldTrackId,
      newTrackId,
      timelineModule,
      mediaModule,
    )
  }

  /**
   * 创建调整时间轴项目大小命令
   */
  private createResizeTimelineItemCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证片段存在
    const timelineItem = unifiedStore.getTimelineItem(params.itemId)
    if (!timelineItem) {
      throw new Error(`时间轴项目不存在: ${params.itemId}`)
    }

    // 保存原始时间范围
    const originalTimeRange = { ...timelineItem.timeRange }

    // 构建新的时间范围
    const newTimeRange: any = { ...timelineItem.timeRange }

    if (params.newStartTime !== undefined) {
      newTimeRange.timelineStartTime = this.timecodeToFrames(params.newStartTime)
    }

    if (params.newEndTime !== undefined) {
      newTimeRange.timelineEndTime = this.timecodeToFrames(params.newEndTime)
    }

    // 验证时间范围逻辑
    if (newTimeRange.timelineStartTime >= newTimeRange.timelineEndTime) {
      throw new Error('timelineStartTime 必须小于 timelineEndTime')
    }

    // 获取模块引用
    const timelineModule = {
      getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
    }
    const mediaModule = this.getMediaModule()

    // 创建命令
    return new ResizeTimelineItemCommand(params.itemId, originalTimeRange, newTimeRange, timelineModule, mediaModule)
  }

  // === 辅助方法 ===

  /**
   * 获取时间轴模块
   */
  private getTimelineModule() {
    const unifiedStore = useUnifiedStore()
    return {
      addTimelineItem: unifiedStore.addTimelineItem.bind(unifiedStore),
      removeTimelineItem: unifiedStore.removeTimelineItem.bind(unifiedStore),
      getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
    }
  }

  /**
   * 获取媒体模块
   */
  private getMediaModule() {
    const unifiedStore = useUnifiedStore()
    return {
      getMediaItem: (id: string | null) => (id ? unifiedStore.mediaItems.find(item => item.id === id) : undefined),
    }
  }

  /**
   * 获取配置模块
   */
  private getConfigModule() {
    const unifiedStore = useUnifiedStore()
    // 使用 computed 创建 Ref 来满足命令的类型要求
    const videoResolution = computed(() => unifiedStore.videoResolution)

    return {
      videoResolution,
    }
  }

  /**
   * 时间码转帧数
   * 格式: HH:MM:SS.FF → frames
   * 假设帧率为 30fps
   */
  private timecodeToFrames(timecode: string): number {
    const parts = timecode.split(':')
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    const secondsParts = (parts[2] || '0').split('.')
    const seconds = parseInt(secondsParts[0]) || 0
    const frames = parseInt(secondsParts[1]) || 0

    const frameRate = 30 // TODO: 从项目配置获取
    return (hours * 3600 + minutes * 60 + seconds) * frameRate + frames
  }

  /**
   * 从参数构建时间轴项目
   * 基于 useTimelineItemOperations.ts 中的逻辑
   *
   * @param params 操作参数
   */
  private buildTimelineItemFromParams(params: any): UnifiedTimelineItemData<MediaType> {
    const unifiedStore = useUnifiedStore()

    // 获取素材
    const mediaItem = unifiedStore.getMediaItem(params.mediaItemId)
    if (!mediaItem) {
      throw new Error(`素材不存在: ${params.mediaItemId}`)
    }

    // 检查素材状态
    const hasError = MediaItemQueries.hasError(mediaItem)
    if (hasError) {
      throw new Error('素材解析失败，无法添加到时间轴')
    }

    if (mediaItem.mediaType === 'unknown') {
      throw new Error('素材类型未确定，请等待检测完成')
    }

    if (mediaItem.mediaType === 'text') {
      throw new Error('不支持文本类型')
    }

    // 检查时长信息
    const availableDuration = mediaItem.duration
    if (!availableDuration || availableDuration <= 0) {
      throw new Error('素材时长信息不可用，请等待解析完成')
    }

    // 获取原始分辨率
    let originalResolution: { width: number; height: number } | null = null
    if (MediaItemQueries.isVideo(mediaItem)) {
      originalResolution = unifiedStore.getVideoOriginalResolution(mediaItem.id) || null
    } else if (MediaItemQueries.isImage(mediaItem)) {
      originalResolution = unifiedStore.getImageOriginalResolution(mediaItem.id) || null
    }

    // 创建默认配置
    const config = this.createDefaultTimelineItemConfig(mediaItem.mediaType, originalResolution)

    // 时间码转帧
    const positionFrames = this.timecodeToFrames(params.position)

    // 创建时间轴项目数据
    const timelineItemData: UnifiedTimelineItemData = {
      id: generateTimelineItemId(),
      mediaItemId: mediaItem.id,
      trackId: params.trackId,
      mediaType: mediaItem.mediaType,
      timeRange: {
        timelineStartTime: positionFrames,
        timelineEndTime: positionFrames + availableDuration,
        clipStartTime: 0,
        clipEndTime: availableDuration,
      },
      config: config,
      animation: undefined,
      timelineStatus: 'loading', // 新项目为 loading 状态
      runtime: {
        isInitialized: false, // 新创建的项目，未初始化
      },
    }

    return timelineItemData
  }

  /**
   * 创建默认时间轴项目配置
   * 基于 useTimelineItemOperations.ts 中的逻辑
   */
  private createDefaultTimelineItemConfig(
    mediaType: Exclude<MediaType, 'text'>,
    originalResolution: { width: number; height: number } | null,
  ): any {
    switch (mediaType) {
      case 'video': {
        const defaultWidth = originalResolution?.width || 1920
        const defaultHeight = originalResolution?.height || 1080

        return {
          // 视觉属性
          x: 0, // 居中位置
          y: 0, // 居中位置
          width: defaultWidth,
          height: defaultHeight,
          rotation: 0,
          opacity: 1,
          // 等比缩放状态（默认开启）
          proportionalScale: true,
          // 音频属性
          volume: 1,
          isMuted: false,
        }
      }

      case 'image': {
        const defaultWidth = originalResolution?.width || 1920
        const defaultHeight = originalResolution?.height || 1080

        return {
          // 视觉属性
          x: 0,
          y: 0,
          width: defaultWidth,
          height: defaultHeight,
          rotation: 0,
          opacity: 1,
          // 等比缩放状态（默认开启）
          proportionalScale: true,
        }
      }

      case 'audio': {
        return {
          // 音频属性
          volume: 1,
          isMuted: false,
        }
      }

      default:
        throw new Error(`不支持的媒体类型: ${mediaType}`)
    }
  }

  // === 轨道操作命令创建方法 ===

  /**
   * 创建添加轨道命令
   */
  private createAddTrackCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证轨道类型
    const validTypes = ['video', 'audio', 'image']
    if (!validTypes.includes(params.trackType)) {
      throw new Error(`无效的轨道类型: ${params.trackType}`)
    }

    // 获取模块引用
    const trackModule = {
      addTrack: unifiedStore.addTrack.bind(unifiedStore),
      removeTrack: unifiedStore.removeTrack.bind(unifiedStore),
      getTrack: (trackId: string) => unifiedStore.tracks.find(track => track.id === trackId),
    }

    // 创建命令
    return new AddTrackCommand(params.trackType as any, params.position, trackModule)
  }

  /**
   * 创建删除轨道命令
   */
  private createRemoveTrackCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证轨道存在
    const track = unifiedStore.tracks.find(t => t.id === params.trackId)
    if (!track) {
      throw new Error(`轨道不存在: ${params.trackId}`)
    }

    // 验证不是最后一个轨道
    if (unifiedStore.tracks.length <= 1) {
      throw new Error('不能删除最后一个轨道')
    }

    // 获取模块引用
    const trackModule = {
      addTrack: unifiedStore.addTrack.bind(unifiedStore),
      removeTrack: unifiedStore.removeTrack.bind(unifiedStore),
      getTrack: (trackId: string) => unifiedStore.tracks.find(track => track.id === trackId),
      tracks: { value: unifiedStore.tracks },
    }

    const timelineModule = {
      addTimelineItem: unifiedStore.addTimelineItem.bind(unifiedStore),
      removeTimelineItem: unifiedStore.removeTimelineItem.bind(unifiedStore),
      getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
      timelineItems: computed(() => unifiedStore.timelineItems),
    }

    const mediaModule = this.getMediaModule()

    // 创建命令
    return new RemoveTrackCommand(params.trackId, trackModule, timelineModule, mediaModule)
  }

  /**
   * 创建重命名轨道命令
   */
  private createRenameTrackCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证轨道存在
    const track = unifiedStore.tracks.find(t => t.id === params.trackId)
    if (!track) {
      throw new Error(`轨道不存在: ${params.trackId}`)
    }

    // 验证新名称不为空
    if (!params.newName || !params.newName.trim()) {
      throw new Error('轨道名称不能为空')
    }

    // 获取模块引用
    const trackModule = {
      renameTrack: unifiedStore.renameTrack.bind(unifiedStore),
      getTrack: (trackId: string) => unifiedStore.tracks.find(track => track.id === trackId),
    }

    // 创建命令
    return new RenameTrackCommand(params.trackId, params.newName, trackModule)
  }

  /**
   * 创建切换轨道静音状态命令
   */
  private createToggleTrackMuteCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证轨道存在
    const track = unifiedStore.tracks.find(t => t.id === params.trackId)
    if (!track) {
      throw new Error(`轨道不存在: ${params.trackId}`)
    }

    // 获取模块引用
    const trackModule = {
      getTrack: (trackId: string) => unifiedStore.tracks.find(track => track.id === trackId),
      toggleTrackMute: unifiedStore.toggleTrackMute.bind(unifiedStore),
    }

    // 创建命令
    return new ToggleTrackMuteCommand(
      params.trackId,
      trackModule,
      params.targetMuteState,
    )
  }

  /**
   * 创建切换轨道可见性命令
   */
  private createToggleTrackVisibilityCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证轨道存在
    const track = unifiedStore.tracks.find(t => t.id === params.trackId)
    if (!track) {
      throw new Error(`轨道不存在: ${params.trackId}`)
    }

    // 获取模块引用
    const trackModule = {
      getTrack: (trackId: string) => unifiedStore.tracks.find(track => track.id === trackId),
      toggleTrackVisibility: unifiedStore.toggleTrackVisibility.bind(unifiedStore),
    }

    // 创建命令
    return new ToggleTrackVisibilityCommand(
      params.trackId,
      trackModule,
      params.targetVisible,
    )
  }

  /**
   * 创建更新时间轴项目属性命令
   */
  private createUpdateTimelineItemCommand(params: any): SimpleCommand {
    const unifiedStore = useUnifiedStore()

    // 验证片段存在
    const timelineItem = unifiedStore.getTimelineItem(params.itemId)
    if (!timelineItem) {
      throw new Error(`时间轴项目不存在: ${params.itemId}`)
    }

    // 保存原始值
    const oldValues: any = {}

    // 构建新值对象，只包含提供的参数
    const newValues: any = {}

    // 视觉属性（仅对 video、image、text 类型有效）
    if (timelineItem.mediaType !== 'audio') {
      const config = timelineItem.config as any

      if (params.x !== undefined) {
        oldValues.x = config.x
        newValues.x = params.x
      }
      if (params.y !== undefined) {
        oldValues.y = config.y
        newValues.y = params.y
      }
      if (params.width !== undefined) {
        oldValues.width = config.width
        newValues.width = params.width
      }
      if (params.height !== undefined) {
        oldValues.height = config.height
        newValues.height = params.height
      }
      if (params.rotation !== undefined) {
        oldValues.rotation = config.rotation
        newValues.rotation = params.rotation
      }
      if (params.opacity !== undefined) {
        oldValues.opacity = config.opacity
        newValues.opacity = params.opacity
      }
      if (params.proportionalScale !== undefined) {
        oldValues.proportionalScale = config.proportionalScale
        newValues.proportionalScale = params.proportionalScale
      }
    }

    // 音频属性（仅对 video 和 audio 类型有效）
    if (timelineItem.mediaType === 'video' || timelineItem.mediaType === 'audio') {
      const config = timelineItem.config as any

      if (params.volume !== undefined) {
        oldValues.volume = config.volume
        newValues.volume = params.volume
      }
      if (params.isMuted !== undefined) {
        oldValues.isMuted = config.isMuted
        newValues.isMuted = params.isMuted
      }
    }

    // 扩展属性
    if (params.duration !== undefined) {
      const currentDuration =
        timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime
      oldValues.duration = currentDuration
      newValues.duration = params.duration
    }

    if (params.playbackRate !== undefined) {
      oldValues.playbackRate = 1 // 默认倍速为 1
      newValues.playbackRate = params.playbackRate
    }

    // 获取模块引用
    const timelineModule: any = {
      updateTimelineItemTransform: unifiedStore.updateTimelineItemTransform.bind(unifiedStore),
      getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
    }

    // 只有当需要更新 playbackRate 且该方法存在时才添加
    if (
      params.playbackRate !== undefined &&
      'updateTimelineItemPlaybackRate' in unifiedStore &&
      typeof (unifiedStore as any).updateTimelineItemPlaybackRate === 'function'
    ) {
      timelineModule.updateTimelineItemPlaybackRate = (unifiedStore as any).updateTimelineItemPlaybackRate.bind(
        unifiedStore,
      )
    }

    const mediaModule = this.getMediaModule()

    // 创建命令
    return new UpdateTransformCommand(params.itemId, oldValues, newValues, timelineModule, mediaModule)
  }
}
