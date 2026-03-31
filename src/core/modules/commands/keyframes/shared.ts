/**
 * 关键帧命令共享工具函数和类型定义
 * 适配新架构的统一类型系统
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { AnimateKeyframe, GetAnimation } from '@/core/timelineitem/bunnytype'
import type { GetConfigs } from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import { isPlayheadInTimelineItem as checkPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import { cloneDeep } from 'lodash'
import { useUnifiedStore } from '@/core/unifiedStore'

// ==================== 关键帧数据快照接口 ====================

/**
 * 类型安全的关键帧状态快照
 * 用于保存和恢复关键帧的完整状态
 */
export interface KeyframeSnapshot {
  /** 动画配置的完整快照 */
  animationConfig: GetAnimation<MediaType> | undefined
  /** 时间轴项目的属性快照 */
  itemProperties: GetConfigs<MediaType>
}

// ==================== 通用接口定义 ====================

/**
 * 时间轴模块接口
 */
export interface TimelineModule {
  getTimelineItem: (id: string) => UnifiedTimelineItemData | undefined
}

/**
 * 播放控制接口
 */
export interface PlaybackControls {
  seekTo: (frame: number) => void
}

// ==================== 通用工具函数 ====================

/**
 * 创建状态快照
 */
export function createSnapshot(item: UnifiedTimelineItemData): KeyframeSnapshot {
  return {
    animationConfig: item.animation ? cloneDeep(item.animation) : undefined,
    itemProperties: cloneDeep(item.config),
  }
}

/**
 * 通用的状态快照应用函数
 * 适配新架构的数据流向：UI → TimelineItem
 * 基于旧架构的完整实现进行改进
 */
export async function applyKeyframeSnapshot(
  item: UnifiedTimelineItemData,
  snapshot: KeyframeSnapshot,
): Promise<void> {
  if (snapshot.animationConfig) {
    item.animation = {
      groups: Object.fromEntries(
        Object.entries(snapshot.animationConfig.groups || {}).map(([groupId, track]) => [
          groupId,
          {
            groupId,
            strategyKey: track.groupId,
            keyframes: track.keyframes.map((kf: AnimateKeyframe<MediaType>) => {
              const value = { ...kf.value }
              return {
                position: kf.position,
                frame: kf.frame,
                cachedFrame: kf.cachedFrame,
                value,
                properties: value,
                easing: kf.easing,
              }
            }),
          },
        ]),
      ),
    } as GetAnimation<MediaType>
  } else {
    item.animation = undefined
  }

  if (snapshot.itemProperties) {
    Object.assign(item.config, snapshot.itemProperties)
  }
}

/**
 * 检查播放头是否在时间轴项目范围内
 */
export function isPlayheadInTimelineItem(item: UnifiedTimelineItemData, frame: number): boolean {
  return checkPlayheadInTimelineItem(item, frame)
}

/**
 * 显示用户警告
 */
export function showUserWarning(title: string, message: string): void {
  const unifiedStore = useUnifiedStore()
  // 假设新架构有类似的警告方法
  if (typeof unifiedStore.messageWarning === 'function') {
    unifiedStore.messageWarning(`${title}：${message}`)
  } else {
    console.warn(`${title}: ${message}`)
  }
}
