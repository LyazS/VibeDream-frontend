import { ref } from 'vue'
import { cleanupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import type { UnifiedTimelineItemData, TransformData } from '@/core/timelineitem/type'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { ModuleRegistry, MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedSelectionModule } from './UnifiedSelectionModule'

import { isVideoTimelineItem } from '@/core/timelineitem/queries'
import { adjustKeyframesForDurationChange } from '@/core/utils/unifiedKeyframeUtils'
import { hasAnimation } from '@/core/utils/unifiedKeyframeUtils'
import { TimelineItemFactory } from '../timelineitem'
import {
  normalizeClipTransitionOutConfig,
  refreshClipTransitionsForItems,
} from '@/core/timelineitem/transition'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { ClipFilterConfig } from '@/core/filter/types'
import {
  createTimelineTransitionOverlay,
  type TimelineTransitionOverlayViewModel,
} from '@/core/timelineitem/transitionOverlay'

/**
 * 统一时间轴核心管理模块
 * 基于新架构的统一类型系统重构的时间轴管理功能
 *
 * 主要变化：
 * 1. 使用 UnifiedTimelineItemData 替代原有的 LocalTimelineItem 和 AsyncProcessingTimelineItem
 * 2. 使用统一的状态管理系统（3状态：ready|loading|error）
 * 3. 保持与原有模块相同的API接口，便于迁移
 * 4. 支持更丰富的时间轴项目状态和属性管理
 */
export function createUnifiedTimelineModule(registry: ModuleRegistry) {
  // ==================== 状态定义 ====================

  const timelineItems = ref<UnifiedTimelineItemData<MediaType>[]>([])

  function refreshTransitionItems() {
    refreshClipTransitionsForItems(timelineItems.value)
  }

  // ==================== 时间轴管理方法 ====================

  /**
   * 添加时间轴项目
   * @param timelineItem 要添加的时间轴项目
   */
  async function addTimelineItem(timelineItem: UnifiedTimelineItemData<MediaType>) {
    timelineItems.value.push(timelineItem)
    refreshTransitionItems()
  }

  /**
   * 移除时间轴项目
   * @param timelineItemId 要移除的时间轴项目ID
   */
  async function removeTimelineItem(timelineItemId: string) {
    const index = timelineItems.value.findIndex(
      (item: UnifiedTimelineItemData<MediaType>) => item.id === timelineItemId,
    )
    if (index > -1) {
      // 直接使用registry.get获取所需模块
      const selectionModule = registry.get<UnifiedSelectionModule>(MODULE_NAMES.SELECTION)

      const item = timelineItems.value[index]

      // 🆕 同步清理选择集合中的对应ID
      selectionModule.clearSelectionsForTimelineItem(timelineItemId)
      console.log(`🗑️ 已从选择集合中移除已删除的项目: ${timelineItemId}`)

      // 🆕 清理 Bunny 相关资源
      await cleanupTimelineItemBunny(item)

      // 从数组中移除
      timelineItems.value.splice(index, 1)
      refreshTransitionItems()
    }
  }

  /**
   * 获取时间轴项目
   * @param timelineItemId 时间轴项目ID
   * @returns 时间轴项目或undefined
   */
  function getTimelineItem(timelineItemId: string): UnifiedTimelineItemData<MediaType> | undefined {
    return timelineItems.value.find(
      (item: UnifiedTimelineItemData<MediaType>) => item.id === timelineItemId,
    )
  }

  /**
   * 获取就绪状态的时间轴项目（过滤掉加载中和错误状态的项目）
   * @param timelineItemId 时间轴项目ID
   * @returns 就绪状态的时间轴项目或undefined
   */
  function getReadyTimelineItem(
    timelineItemId: string,
  ): UnifiedTimelineItemData<MediaType> | undefined {
    const item = getTimelineItem(timelineItemId)
    return item && item.timelineStatus === 'ready' ? item : undefined
  }

  /**
   * 更新时间轴项目位置
   * @param timelineItemId 时间轴项目ID
   * @param newPositionFrames 新位置（帧数）
   * @param newTrackId 新轨道ID（可选）
   */
  function updateTimelineItemPosition(
    timelineItemId: string,
    newPositionFrames: number,
    newTrackId?: string,
  ) {
    const item = getTimelineItem(timelineItemId)
    if (item) {
      // 确保新位置不为负数
      const clampedNewPositionFrames = Math.max(0, newPositionFrames)

      // 更新时间轴位置
      const durationFrames = item.timeRange.timelineEndTime - item.timeRange.timelineStartTime // 帧数
      TimelineItemFactory.setTimeRange(item, {
        timelineStartTime: clampedNewPositionFrames, // 帧数
        timelineEndTime: clampedNewPositionFrames + durationFrames, // 帧数
      })

      // 如果指定了新轨道，更新轨道ID
      if (newTrackId !== undefined) {
        item.trackId = newTrackId
      }

      refreshTransitionItems()
    }
  }

  function setTimelineItemTimeRangeForCmd(
    timelineItemId: string,
    timeRange: Partial<UnifiedTimeRange>,
  ) {
    const item = getTimelineItem(timelineItemId)
    if (!item) return

    TimelineItemFactory.setTimeRange(item, timeRange)
    refreshTransitionItems()
  }

  function setTimelineItemTransitionOutForCmd(
    timelineItemId: string,
    transitionOut?: ClipTransitionOutConfig,
  ) {
    const item = getTimelineItem(timelineItemId)
    if (!item) return

    item.transitionOut = transitionOut
      ? normalizeClipTransitionOutConfig({
          effectPackageId: transitionOut.effectPackageId,
          templateId: transitionOut.templateId,
          packageVersion: transitionOut.packageVersion,
          catalogVersion: transitionOut.catalogVersion,
          durationFrames: transitionOut.durationFrames,
          params: transitionOut.params,
          packagePayload: transitionOut.packagePayload,
        })
      : undefined

    refreshTransitionItems()
  }

  function setTimelineItemFilterEffectForCmd(
    timelineItemId: string,
    filterEffect?: ClipFilterConfig,
  ) {
    const item = getTimelineItem(timelineItemId)
    if (!item) return

    item.filterEffect = filterEffect
      ? normalizeClipFilterConfig({
          effectPackageId: filterEffect.effectPackageId,
          templateId: filterEffect.templateId,
          packageVersion: filterEffect.packageVersion,
          catalogVersion: filterEffect.catalogVersion,
          intensity: filterEffect.intensity,
          params: filterEffect.params,
          packagePayload: filterEffect.packagePayload,
        })
      : undefined
    item.runtime.renderFilterEffect = item.filterEffect
      ? normalizeClipFilterConfig(item.filterEffect)
      : undefined
  }

  function getTransitionOverlay(sourceItemId: string): TimelineTransitionOverlayViewModel | null {
    const item = getTimelineItem(sourceItemId)
    if (!item) {
      return null
    }

    return createTimelineTransitionOverlay(item)
  }

  function getTransitionOverlaysByTrack(trackId: string): TimelineTransitionOverlayViewModel[] {
    return timelineItems.value
      .filter((item) => item.trackId === trackId)
      .map((item) => createTimelineTransitionOverlay(item))
      .filter((overlay): overlay is TimelineTransitionOverlayViewModel => overlay !== null)
  }

  /**
   * 更新UnifiedTimelineItem的变换属性
   * 直接设置到 item.config 中，不设置到 sprite
   */
  function updateTimelineItemTransform(timelineItemId: string, transform: TransformData) {
    const item = getReadyTimelineItem(timelineItemId)
    if (!item) return

    // hasVisualProperties 类型守卫确保了 config 具有视觉属性
    if (TimelineItemQueries.hasVisualProperties(item)) {
      const config = item.config

      // 直接更新 config 中的属性
      if (transform.x !== undefined) {
        config.x = transform.x
      }
      if (transform.y !== undefined) {
        config.y = transform.y
      }
      if (transform.width !== undefined) {
        config.width = transform.width
      }
      if (transform.height !== undefined) {
        config.height = transform.height
      }
      if (transform.rotation !== undefined) {
        config.rotation = transform.rotation
      }
      if (transform.opacity !== undefined) {
        config.opacity = transform.opacity
      }
      if (transform.blendMode !== undefined) {
        config.blendMode = transform.blendMode
      }
    }

    // 处理音频属性（对视频和音频有效）
    if (TimelineItemQueries.hasAudioProperties(item)) {
      const config = item.config

      if (transform.volume !== undefined) {
        config.volume = transform.volume
      }
      if (transform.isMuted !== undefined) {
        config.isMuted = transform.isMuted
      }
    }
  }

  /**
   * 更新时间轴项目播放速度
   * @param timelineItemId 时间轴项目ID
   * @param newRate 新的播放速度
   */
  function updateTimelineItemPlaybackRate(timelineItemId: string, newRate: number) {
    const item = getTimelineItem(timelineItemId)
    if (item) {
      // 确保播放速度在合理范围内（扩展到0.1-100倍）
      const clampedRate = Math.max(0.1, Math.min(100, newRate))

      // 🎯 关键帧位置调整：在更新播放速度之前计算时长变化
      let oldDurationFrames = 0
      let newDurationFrames = 0

      if (isVideoTimelineItem(item)) {
        const clipDurationFrames = item.timeRange.clipEndTime - item.timeRange.clipStartTime
        oldDurationFrames = item.timeRange.timelineEndTime - item.timeRange.timelineStartTime
        newDurationFrames = Math.round(clipDurationFrames / clampedRate)

        // 如果有关键帧，先调整位置
        if (hasAnimation(item)) {
          adjustKeyframesForDurationChange(item, oldDurationFrames, newDurationFrames)
          console.log('🎬 [Playback Rate] Keyframes adjusted for speed change:', {
            oldRate: clampedRate,
            newRate: clampedRate,
            oldDuration: oldDurationFrames,
            newDuration: newDurationFrames,
          })
        }
      }

      // 🎯 直接计算新的时间范围并使用 TimelineItemFactory.setTimeRange 设置
      const clipDurationFrames = item.timeRange.clipEndTime - item.timeRange.clipStartTime
      const newTimelineDurationFrames = Math.round(clipDurationFrames / clampedRate)
      const newTimelineEndTime = item.timeRange.timelineStartTime + newTimelineDurationFrames

      TimelineItemFactory.setTimeRange(item, {
        timelineEndTime: newTimelineEndTime,
      })

      refreshTransitionItems()
    }
  }

  // ==================== 导出接口 ====================

  return {
    // 状态
    timelineItems,

    // 方法
    addTimelineItem,
    removeTimelineItem,
    getTimelineItem,
    getReadyTimelineItem,
    updateTimelineItemPosition,
    updateTimelineItemTransform,
    updateTimelineItemPlaybackRate,
    setTimelineItemTimeRangeForCmd,
    setTimelineItemTransitionOutForCmd,
    setTimelineItemFilterEffectForCmd,
    refreshTransitionItems,
    getTransitionOverlay,
    getTransitionOverlaysByTrack,
  }
}

// 导出类型定义
export type UnifiedTimelineModule = ReturnType<typeof createUnifiedTimelineModule>
