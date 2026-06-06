import { ref } from 'vue'
import { cleanupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import type {
  UnifiedTimelineItemData,
  VisualPropPatch,
  AudioPropPatch,
} from '@/core/timelineitem/type'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { ModuleRegistry, MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedSelectionModule } from './UnifiedSelectionModule'

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
          ...(transitionOut.packagePayload ? { packagePayload: transitionOut.packagePayload } : {}),
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

  function setTimelineItemVisualPropsForCmd(
    timelineItemId: string,
    patch: VisualPropPatch,
  ) {
    const item = getReadyTimelineItem(timelineItemId)
    if (!item) return

    if (!TimelineItemQueries.hasVisualProperties(item)) {
      return
    }

    const config = item.config

    if (patch.x !== undefined) {
      config.x = patch.x
    }
    if (patch.y !== undefined) {
      config.y = patch.y
    }
    if (patch.width !== undefined) {
      config.width = patch.width
    }
    if (patch.height !== undefined) {
      config.height = patch.height
    }
    if (patch.rotation !== undefined) {
      config.rotation = patch.rotation
    }
    if (patch.opacity !== undefined) {
      config.opacity = patch.opacity
    }
    if (patch.blendMode !== undefined) {
      config.blendMode = patch.blendMode
    }
    if (patch.proportionalScale !== undefined) {
      config.proportionalScale = patch.proportionalScale
    }
    if (patch.mask !== undefined) {
      config.mask = patch.mask
    }
  }

  function setTimelineItemAudioPropsForCmd(
    timelineItemId: string,
    patch: AudioPropPatch,
  ) {
    const item = getReadyTimelineItem(timelineItemId)
    if (!item) return

    if (!TimelineItemQueries.hasAudioProperties(item)) {
      return
    }

    const config = item.config

    if (patch.volume !== undefined) {
      config.volume = patch.volume
    }
    if (patch.isMuted !== undefined) {
      config.isMuted = patch.isMuted
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
    setTimelineItemVisualPropsForCmd,
    setTimelineItemAudioPropsForCmd,
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
