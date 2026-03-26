/**
 * 分割时间轴项目命令
 * 支持分割已知时间轴项目的撤销/重做操作
 * 遵循"从源头重建"原则：保存完整的重建元数据，撤销时从原始素材重新创建
 */

import { generateCommandId, generateTimelineItemId } from '@/core/utils/idGenerator'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { SimpleCommand } from '@/core/modules/commands/types'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'

// ==================== 新架构类型导入 ====================
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'

import type { UnifiedTimeRange } from '@/core/types/timeRange'

import type { AnimateKeyframe, AnimationChannelKey, GetAnimation } from '@/core/timelineitem/bunnytype'
import { splitKeyframesAtPosition } from '@/core/utils/keyframePositionUtils'

// ==================== 新架构工具导入 ====================

import { TimelineItemFactory } from '@/core/timelineitem'

type SplitKeyframe = AnimateKeyframe<any, AnimationChannelKey>
type SplitChannelEntry = { keyframes: SplitKeyframe[] }
type SplitChannelMap = Partial<Record<AnimationChannelKey, SplitChannelEntry>>

const splitChannelKeyframes = splitKeyframesAtPosition as <T extends SplitKeyframe>(
  keyframes: T[],
  splitPosition: number,
  originalDuration: number,
  firstDuration: number,
  secondDuration: number,
) => {
  firstKeyframes: T[]
  secondKeyframes: T[]
  splitKeyframe: T | null
}

/**
 * 分割时间轴项目命令
 * 支持分割已知时间轴项目的撤销/重做操作
 * 遵循"从源头重建"原则：保存完整的重建元数据，撤销时从原始素材重新创建
 */
export class SplitTimelineItemCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private originalTimelineItemData: UnifiedTimelineItemData<MediaType> // 保存原始项目的重建数据
  private splitItemIds: string[] // 分割后所有项目的ID（n个分割点产生n+1个片段）
  private _isDisposed = false

  constructor(
    private originalTimelineItemId: string,
    originalTimelineItem: UnifiedTimelineItemData<MediaType>, // 要分割的原始时间轴项目
    private splitTimeFrames: number[], // 分割时间点数组（帧数），按时间顺序排列
    private timelineModule: {
      addTimelineItem: (item: UnifiedTimelineItemData<MediaType>) => Promise<void>
      removeTimelineItem: (id: string) => void
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ) {
    this.id = generateCommandId()

    // 已知项目处理逻辑
    const mediaItem = this.mediaModule.getMediaItem(originalTimelineItem.mediaItemId)
    const splitPointsDesc = splitTimeFrames.map(t => framesToTimecode(t)).join(', ')
    this.description = `分割时间轴项目: ${mediaItem?.name || '未知素材'} (在 ${splitPointsDesc})`

    // 保存原始项目的完整重建元数据
    this.originalTimelineItemData = TimelineItemFactory.clone(originalTimelineItem)

    // 生成分割后项目的ID（n个分割点产生n+1个片段）
    const fragmentCount = splitTimeFrames.length + 1
    this.splitItemIds = Array.from({ length: fragmentCount }, () => generateTimelineItemId())

    console.log('💾 保存分割项目的重建数据:', {
      originalId: this.originalTimelineItemData.id,
      mediaItemId: this.originalTimelineItemData.mediaItemId,
      mediaType: this.originalTimelineItemData.mediaType,
      splitTimeFrames: this.splitTimeFrames,
      timeRange: this.originalTimelineItemData.timeRange,
      splitItemIds: this.splitItemIds,
      fragmentCount,
    })
  }

  /**
   * 从原始素材重建分割后的多个sprite和timelineItem
   * 遵循"从源头重建"原则，每次都完全重新创建
   * n个分割点产生n+1个片段
   */
  private async rebuildSplitItems(): Promise<UnifiedTimelineItemData<MediaType>[]> {
    console.log('🔄 开始从源头重建分割后的时间轴项目...')

    const originalTimeRange = this.originalTimelineItemData.timeRange
    const timelineStartTimeFrames = originalTimeRange.timelineStartTime
    const timelineEndTimeFrames = originalTimeRange.timelineEndTime
    const timelineDurationFrames = timelineEndTimeFrames - timelineStartTimeFrames

    const clipStartTimeFrames = originalTimeRange.clipStartTime || 0
    const clipEndTimeFrames = originalTimeRange.clipEndTime || 0
    const clipDurationFrames = clipEndTimeFrames - clipStartTimeFrames

    // 确保分割点按时间顺序排列
    const sortedSplitPoints = [...this.splitTimeFrames].sort((a, b) => a - b)

    // 构建所有分割点（包括起点和终点）
    const allSplitPoints = [timelineStartTimeFrames, ...sortedSplitPoints, timelineEndTimeFrames]

    console.log('🔄 分割点信息:', {
      originalTimeRange,
      sortedSplitPoints,
      allSplitPoints,
      fragmentCount: this.splitItemIds.length,
    })

    const splitItems: UnifiedTimelineItemData<MediaType>[] = []

    // 处理关键帧动画
    let animations: Array<GetAnimation<MediaType> | undefined> = []
    if (
      this.originalTimelineItemData.animation?.channels &&
      Object.keys(this.originalTimelineItemData.animation.channels).length > 0
    ) {
      console.log('🎬 [Split] 检测到关键帧动画，开始处理...')

      // 为每个片段计算关键帧
      for (let i = 0; i < allSplitPoints.length - 1; i++) {
        const fragmentStartTime = allSplitPoints[i]
        const fragmentEndTime = allSplitPoints[i + 1]

        // 计算片段在原始时间轴中的相对位置
        const relativeTimelineFrames = fragmentStartTime - timelineStartTimeFrames
        const relativeRatio = relativeTimelineFrames / timelineDurationFrames

        // 计算片段时长
        const fragmentDurationFrames = fragmentEndTime - fragmentStartTime

        // 计算片段在素材中的起始和结束时间
        const fragmentClipStartTime = clipStartTimeFrames + Math.round(clipDurationFrames * relativeRatio)
        const fragmentClipEndTime = clipStartTimeFrames + Math.round(
          clipDurationFrames * ((fragmentEndTime - timelineStartTimeFrames) / timelineDurationFrames)
        )

        console.log(`🎬 [Split] 片段 ${i + 1} 关键帧切割参数:`, {
          fragmentStartTime,
          fragmentEndTime,
          fragmentDurationFrames,
          fragmentClipStartTime,
          fragmentClipEndTime,
          relativeRatio,
        })

        const nextChannels: SplitChannelMap = {}
        const originalChannels = this.originalTimelineItemData.animation.channels as Partial<
          Record<AnimationChannelKey, SplitChannelEntry>
        >

        for (const [channel, channelConfig] of Object.entries(originalChannels) as Array<
          [AnimationChannelKey, SplitChannelEntry]
        >) {
          const { firstKeyframes } = splitChannelKeyframes(
            channelConfig.keyframes,
            relativeRatio,
            clipDurationFrames,
            fragmentDurationFrames,
            fragmentClipEndTime - fragmentClipStartTime,
          )

          if (firstKeyframes.length > 0) {
            nextChannels[channel] = { keyframes: firstKeyframes }
          }
        }

        console.log(`🎬 [Split] 片段 ${i + 1} 关键帧切割结果:`, {
          channelCount: Object.keys(nextChannels).length,
        })

        animations.push(
          Object.keys(nextChannels).length > 0
            ? ({ channels: nextChannels } as GetAnimation<MediaType>)
            : undefined,
        )
      }
    }

    // 为每个片段创建时间轴项目
    for (let i = 0; i < allSplitPoints.length - 1; i++) {
      const fragmentStartTime = allSplitPoints[i]
      const fragmentEndTime = allSplitPoints[i + 1]

      // 计算片段在原始时间轴中的相对位置
      const relativeTimelineFrames = fragmentStartTime - timelineStartTimeFrames
      const relativeRatio = relativeTimelineFrames / timelineDurationFrames

      // 计算片段在素材中的起始和结束时间
      const fragmentClipStartTime = clipStartTimeFrames + Math.round(clipDurationFrames * relativeRatio)
      const fragmentClipEndTime = clipStartTimeFrames + Math.round(
        clipDurationFrames * ((fragmentEndTime - timelineStartTimeFrames) / timelineDurationFrames)
      )

      // 创建片段的时间范围
      const fragmentTimeRange: UnifiedTimeRange = {
        clipStartTime: fragmentClipStartTime,
        clipEndTime: fragmentClipEndTime,
        timelineStartTime: fragmentStartTime,
        timelineEndTime: fragmentEndTime,
      }

      console.log(`🔄 创建片段 ${i + 1}/${this.splitItemIds.length}:`, {
        id: this.splitItemIds[i],
        timeRange: fragmentTimeRange,
      })

      // 使用 TimelineItemFactory.rebuildForCmd 创建片段
      const rebuildResult = await TimelineItemFactory.rebuildForCmd({
        originalTimelineItemData: {
          ...this.originalTimelineItemData,
          id: this.splitItemIds[i],
          timeRange: fragmentTimeRange,
          animation: animations[i] || undefined,
        },
        getMediaItem: this.mediaModule.getMediaItem,
        logIdentifier: `SplitTimelineItemCommand rebuildSplitItems fragment ${i + 1}`,
      })

      if (!rebuildResult.success) {
        throw new Error(`重建片段 ${i + 1} 失败: ${rebuildResult.error}`)
      }

      const fragmentItem = rebuildResult.timelineItem

      // 获取关联的媒体项目
      const mediaItem = this.mediaModule.getMediaItem(fragmentItem.mediaItemId)
      if (!mediaItem) {
        throw new Error(`找不到关联的媒体项目: ${fragmentItem.mediaItemId}`)
      }

      // 使用 setupTimelineItemBunny 创建 bunny 对象
      await setupTimelineItemBunny(fragmentItem, mediaItem)

      // 修改状态为 ready
      fragmentItem.timelineStatus = 'ready'
      
      // ✅ 分割命令：新创建的片段，已完成初始化
      fragmentItem.runtime.isInitialized = true

      console.log(
        `✅ [SplitTimelineItemCommand] 片段 ${i + 1} bunny 对象创建完成，状态已设置为 ready`,
      )

      splitItems.push(fragmentItem)
    }

    console.log('🔄 重建分割项目完成:', {
      fragmentCount: splitItems.length,
      splitTimeFrames: this.splitTimeFrames,
      splitItemIds: this.splitItemIds,
    })

    return splitItems
  }

  /**
   * 从原始素材重建原始项目
   * 用于撤销分割操作
   */
  private async rebuildOriginalItem(): Promise<UnifiedTimelineItemData<MediaType>> {
    console.log('🔄 开始从源头重建原始时间轴项目...')

    // 使用 TimelineItemFactory.rebuildForCmd 重建原始项目
    const rebuildResult = await TimelineItemFactory.rebuildForCmd({
      originalTimelineItemData: this.originalTimelineItemData,
      getMediaItem: this.mediaModule.getMediaItem,
      logIdentifier: 'SplitTimelineItemCommand rebuildOriginalItem',
    })

    if (!rebuildResult.success) {
      throw new Error(`重建原始项目失败: ${rebuildResult.error}`)
    }

    const newTimelineItem = rebuildResult.timelineItem

    console.log('🔄 重建原始项目完成:', {
      id: newTimelineItem.id,
      mediaType: this.originalTimelineItemData.mediaType,
      timeRange: this.originalTimelineItemData.timeRange,
    })

    return newTimelineItem
  }

  /**
   * 执行命令：分割时间轴项目
   */
  async execute(): Promise<void> {
    try {
      // 检查原始项目是否存在
      const originalItem = this.timelineModule.getTimelineItem(this.originalTimelineItemId)
      if (!originalItem) {
        console.warn(`⚠️ 原始时间轴项目不存在，无法分割: ${this.originalTimelineItemId}`)
        return
      }

      // 从原始素材重新创建分割后的多个项目
      const splitItems = await this.rebuildSplitItems()

      // 1. 删除原始项目
      await this.timelineModule.removeTimelineItem(this.originalTimelineItemId)

      // 2. 添加分割后的所有项目（已经是 ready 状态，不需要 MediaSync）
      for (const item of splitItems) {
        await this.timelineModule.addTimelineItem(item)
      }

      const mediaItem = this.mediaModule.getMediaItem(this.originalTimelineItemData.mediaItemId)
      const splitPointsDesc = this.splitTimeFrames.map(t => framesToTimecode(t)).join(', ')
      console.log(
        `🔪 已分割时间轴项目: ${mediaItem?.name || '未知素材'} 在 ${splitPointsDesc}，产生 ${splitItems.length} 个片段`,
      )
    } catch (error) {
      const mediaItem = this.mediaModule.getMediaItem(this.originalTimelineItemData.mediaItemId)
      console.error(`❌ 分割时间轴项目失败: ${mediaItem?.name || '未知素材'}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：从原始素材重建原始项目，删除分割后的项目
   * 遵循"从源头重建"原则，从原始素材完全重新创建
   */
  async undo(): Promise<void> {
    try {
      console.log(`🔄 撤销分割操作：重建原始时间轴项目...`)

      // 1. 从原始素材重新创建原始项目
      const originalItem = await this.rebuildOriginalItem()

      // 获取关联的媒体项目
      const originalMediaItem = this.mediaModule.getMediaItem(originalItem.mediaItemId)
      if (!originalMediaItem) {
        throw new Error(`找不到关联的媒体项目: ${originalItem.mediaItemId}`)
      }

      // 使用 setupTimelineItemBunny 创建 bunny 对象
      await setupTimelineItemBunny(originalItem, originalMediaItem)

      // 修改状态为 ready
      originalItem.timelineStatus = 'ready'
      
      // ✅ 分割命令的 undo：恢复原有的 isInitialized 标记
      // 注意：isInitialized 是必选字段，originalTimelineItemData 中一定有值
      originalItem.runtime.isInitialized = this.originalTimelineItemData.runtime.isInitialized

      console.log(`✅ [SplitTimelineItemCommand] 原始项目 bunny 对象创建完成，状态已设置为 ready`)

      // 2. 删除分割后的所有项目
      for (const itemId of this.splitItemIds) {
        await this.timelineModule.removeTimelineItem(itemId)
      }

      // 3. 添加原始项目到时间轴（已经是 ready 状态，不需要 MediaSync）
      await this.timelineModule.addTimelineItem(originalItem)

      const mediaItem = this.mediaModule.getMediaItem(this.originalTimelineItemData.mediaItemId)
      console.log(`↩️ 已撤销分割时间轴项目: ${mediaItem?.name || '未知素材'}`)
    } catch (error) {
      const mediaItem = this.mediaModule.getMediaItem(this.originalTimelineItemData.mediaItemId)
      console.error(`❌ 撤销分割时间轴项目失败: ${mediaItem?.name || '未知素材'}`, error)
      throw error
    }
  }

  /**
   * 检查命令是否已被清理
   */
  get isDisposed(): boolean {
    return this._isDisposed
  }

  /**
   * 清理命令持有的资源
   */
  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    // 注意：SplitTimelineItemCommand 不使用 MediaSync，因为分割操作总是产生 ready 状态的项目
    console.log(`🗑️ [SplitTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
