import { useUnifiedStore } from '@/core/unifiedStore'
import { MediaItemQueries } from '@/core/mediaitem'
import { generateTimelineItemId } from '@/core/utils/idGenerator'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData, TimelineItemStatus } from '@/core/timelineitem/model/timelineItem'
import type {
  VideoMediaConfig,
  ImageMediaConfig,
  AudioMediaConfig,
} from '@/core/timelineitem/model/timelineItem'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { TimelineItemMutations } from '@/core/timelineitem/mutations'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { buildClipSelectionId } from '@/core/types/timelineSelection'
import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/model/timelineItem'

/**
 * 时间轴项目操作模块
 * 提供时间轴项目相关的操作功能，包括创建、移动、删除等
 */
export function useTimelineItemOperations() {
  const unifiedStore = useUnifiedStore()

  /**
   * 从素材库项创建时间轴项目
   * @param mediaItemId 素材项目ID
   * @param startTimeFrames 开始时间（帧数）
   * @param trackId 轨道ID
   */
  async function createTimelineItemFromMediaItem(
    mediaItemId: string,
    startTimeFrames: number, // 帧数
    trackId: string,
  ): Promise<void> {
    console.log('🔧 [UnifiedTimeline] 创建时间轴项目从素材库:', mediaItemId)

    try {
      // 获取对应的MediaItem
      const storeMediaItem = unifiedStore.getMediaItem(mediaItemId)
      if (!storeMediaItem) {
        throw new Error('找不到对应的素材项目')
      }

      // 检查素材状态和拖拽条件
      const hasError = MediaItemQueries.hasError(storeMediaItem)

      // 只阻止错误状态的素材
      if (hasError) {
        throw new Error('素材解析失败，无法添加到时间轴')
      }

      // 检查媒体类型是否已知 - 阻止未知类型素材创建时间轴项目
      if (storeMediaItem.mediaType === 'unknown') {
        throw new Error('素材类型未确定，请等待检测完成')
      }
      if (storeMediaItem.mediaType === 'text') {
        throw new Error('不支持文本类型')
      }

      // 检查是否有可用的时长信息
      const availableDuration = storeMediaItem.duration
      if (!availableDuration || availableDuration <= 0) {
        throw new Error('素材时长信息不可用，请等待解析完成')
      }

      // 根据素材状态确定时间轴项目状态
      const timelineStatus: TimelineItemStatus = 'loading'

      // 获取媒体的原始分辨率（仅对视觉媒体有效）
      let originalResolution: { width: number; height: number } | null = null
      if (MediaItemQueries.isVideo(storeMediaItem)) {
        originalResolution = unifiedStore.getVideoOriginalResolution(storeMediaItem.id) || null
        console.log('📐 [UnifiedTimeline] 视频原始分辨率:', originalResolution)
      } else if (MediaItemQueries.isImage(storeMediaItem)) {
        originalResolution = unifiedStore.getImageOriginalResolution(storeMediaItem.id) || null
        console.log('📐 [UnifiedTimeline] 图片原始分辨率:', originalResolution)
      } else if (MediaItemQueries.isAudio(storeMediaItem)) {
        console.log('🎵 [UnifiedTimeline] 音频类型，无需设置分辨率')
      } else if (MediaItemQueries.isText(storeMediaItem)) {
        console.log('🎵 [UnifiedTimeline] 文本类型，不应该出现在这里')
        throw new Error('文本类型不应该出现在这里')
      }

      // 创建增强的默认配置
      const baseRenderConfig = createDefaultTimelineItemConfig(
        storeMediaItem.mediaType,
        originalResolution,
      )
      const exRenderConfig = createDefaultTimelineExtraRenderConfig()

      // 创建时间轴项目数据
      const timelineItemData: UnifiedTimelineItemData = {
        id: generateTimelineItemId(),
        mediaItemId: storeMediaItem.id,
        trackId: trackId,
        mediaType: storeMediaItem.mediaType,
        timeRange: {
          timelineStartTime: startTimeFrames,
          timelineEndTime: startTimeFrames + availableDuration,
          clipStartTime: 0,
          clipEndTime: availableDuration,
        },
        baseRenderConfig,
        exRenderConfig,
        animation: undefined, // 新创建的项目默认没有动画
        timelineStatus: timelineStatus, // 根据素材状态设置时间轴项目状态
        runtime: {
          exRenderConfig: createDefaultTimelineExtraRenderConfig(),
          // ✅ 新创建的项目，未初始化，需要从 mediaItem 同步数据
          isInitialized: false,
        },
      }

      await unifiedStore.addTimelineItemWithHistory(timelineItemData)

      console.log(`✅ [UnifiedTimeline] 时间轴项目创建完成: ${timelineItemData.id}`)
    } catch (error) {
      console.error('❌ [UnifiedTimeline] 创建时间轴项目失败:', error)
      unifiedStore.messageError(`创建时间轴项目失败：${(error as Error).message}`)
    }
  }

  /**
   * 创建增强的默认配置 - 考虑原始分辨率
   * @param mediaType 媒体类型
   * @param originalResolution 原始分辨率
   * @returns 增强的默认配置
   */
  function createDefaultTimelineItemConfig(
    mediaType: Exclude<MediaType, 'text'>,
    originalResolution: { width: number; height: number } | null,
  ): VideoMediaConfig | ImageMediaConfig | AudioMediaConfig {
    // 根据媒体类型创建对应的默认配置
    switch (mediaType) {
      case 'video': {
        const defaultWidth = originalResolution?.width || 1920
        const defaultHeight = originalResolution?.height || 1080

        return {
          visual: {
            x: 0,
            y: 0,
            width: defaultWidth,
            height: defaultHeight,
            rotation: 0,
            blendIntensity: 1,
            blendMode: DEFAULT_BLEND_MODE,
            proportionalScale: true,
          },
          audio: {
            volume: 1,
            isMuted: false,
          },
        } as VideoMediaConfig
      }

      case 'image': {
        const defaultWidth = originalResolution?.width || 1920
        const defaultHeight = originalResolution?.height || 1080

        return {
          visual: {
            x: 0,
            y: 0,
            width: defaultWidth,
            height: defaultHeight,
            rotation: 0,
            blendIntensity: 1,
            blendMode: DEFAULT_BLEND_MODE,
            proportionalScale: true,
          },
        } as ImageMediaConfig
      }

      case 'audio':
        return {
          audio: {
            volume: 1,
            isMuted: false,
          },
        } as AudioMediaConfig

      default:
        // 由于类型系统已经约束为 MediaType，不应该到达这里
        throw new Error(`不支持的媒体类型: ${mediaType}`)
    }
  }

  /**
   * 移动单个项目
   * @param itemId 项目ID
   * @param newTimeFrames 新时间位置（帧数）
   * @param newTrackId 新轨道ID
   */
  async function moveSingleItem(itemId: string, newTimeFrames: number, newTrackId: string) {
    // newTimeFrames 是帧数，直接传给 handleTimelineItemPositionUpdate
    await handleTimelineItemPositionUpdate(itemId, newTimeFrames, newTrackId)
  }

  /**
   * 移动多个项目（保持相对位置）
   * @param itemIds 项目ID数组
   * @param newTimeFrames 新时间位置（帧数）
   * @param newTrackId 新轨道ID
   * @param originalStartTimeFrames 原始开始时间（帧数）
   */
  async function moveMultipleItems(
    itemIds: string[],
    newTimeFrames: number,
    newTrackId: string,
    originalStartTimeFrames: number,
  ) {
    console.log('🔄 [UnifiedTimeline] 开始批量移动项目:', {
      itemIds,
      newTimeFrames,
      newTrackId,
      originalStartTimeFrames,
    })

    // 计算时间偏移量（帧数）
    const timeOffsetFrames = newTimeFrames - originalStartTimeFrames

    // 批量移动所有选中的项目
    for (const itemId of itemIds) {
      const item = unifiedStore.getTimelineItem(itemId)
      if (item) {
        const currentStartTimeFrames = item.timeRange.timelineStartTime // 帧数
        const newStartTimeFrames = currentStartTimeFrames + timeOffsetFrames

        // 确保新位置不为负数（防止多选拖拽时某些项目被拖到负数时间轴）
        const clampedNewStartTimeFrames = Math.max(0, newStartTimeFrames)

        // 对于第一个项目，使用目标轨道；其他项目保持相对轨道关系
        const targetTrack = itemId === itemIds[0] ? newTrackId : item.trackId

        // 直接传递帧数给 handleTimelineItemPositionUpdate
        await handleTimelineItemPositionUpdate(itemId, clampedNewStartTimeFrames, targetTrack)
      }
    }
  }

  /**
   * 处理时间轴项目位置更新
   * @param timelineItemId 时间轴项目ID
   * @param newPositionFrames 新位置（帧数）
   * @param newTrackId 新轨道ID
   */
  async function handleTimelineItemPositionUpdate(
    timelineItemId: string,
    newPositionFrames: number,
    newTrackId?: string,
  ) {
    // 使用带历史记录的移动方法
    await unifiedStore.moveTimelineItemWithHistory(timelineItemId, newPositionFrames, newTrackId)
  }

  /**
   * 处理时间轴项目删除
   * @param timelineItemId 时间轴项目ID
   */
  async function handleTimelineItemRemove(timelineItemId: string) {
    const item = unifiedStore.getTimelineItem(timelineItemId)
    if (item) {
      const mediaItem = unifiedStore.getMediaItem(item.mediaItemId)
      console.log(`🗑️ 准备从时间轴删除项目: ${mediaItem?.name || '未知'} (ID: ${timelineItemId})`)

      // 使用统一架构的删除方法
      await unifiedStore.removeTimelineItemWithHistory(timelineItemId)
      console.log(`✅ 时间轴项目删除完成: ${timelineItemId}`)
    }
  }

  /**
   * 在指定位置创建文本项目
   * @param trackId 轨道ID
   * @param timePosition 时间位置（帧数）
   */
  async function createTextAtPosition(trackId: string, timePosition: number) {
    try {
      console.log('🔄 [UnifiedTimeline] 开始创建文本项目:', { trackId })

      // 创建文本时间轴项目（使用工具函数，对齐旧架构）
      const textItem = await createTextTimelineItem(
        '默认文本', // 默认文本内容
        { fontSize: 64, color: '#ffffff' }, // 默认样式
        timePosition, // 开始时间（帧数）
        trackId, // 轨道ID
        150, // 默认时长（5秒@30fps）
      )

      // ✅ 为文本项目设置 bunny 对象（创建 textBitmap）
      await setupTimelineItemBunny(textItem)

      // ✅ 从 textBitmap 获取实际宽高并设置到 config
      if (textItem.runtime.textBitmap) {
        TimelineItemMutations.patchBaseVisualConfig(textItem, {
          width: textItem.runtime.textBitmap.width,
          height: textItem.runtime.textBitmap.height,
        })
      }

      // 设置状态为 ready（文本项目不依赖外部媒体，可直接就绪）
      textItem.timelineStatus = 'ready'
      textItem.runtime.isInitialized = true

      // 添加到时间轴（带历史记录）
      await unifiedStore.addTimelineItemWithHistory(textItem)

      console.log('✅ [UnifiedTimeline] 文本项目创建成功:', {
        id: textItem.id,
        text: TimelineItemQueries.getBaseTextConfig(textItem)?.text,
        position: timePosition,
      })

      // 选中新创建的文本项目
      unifiedStore.selectTimelineSelection(buildClipSelectionId(textItem.id))
    } catch (error) {
      console.error('❌ [UnifiedTimeline] 创建文本项目失败:', error)
      unifiedStore.messageError(`创建文本项目失败：${(error as Error).message}`)
    }
  }

  return {
    // 方法
    createTimelineItemFromMediaItem,
    createDefaultTimelineItemConfig,
    moveSingleItem,
    moveMultipleItems,
    handleTimelineItemPositionUpdate,
    handleTimelineItemRemove,
    createTextAtPosition,
  }
}
