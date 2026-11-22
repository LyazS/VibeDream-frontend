/**
 * 统一Clip架构相关工具函数
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem'

// ==================== 媒体项目信息工具 ====================

/**
 * 获取时间轴项目的显示名称（优先使用媒体项目名称）
 */
export function getTimelineItemDisplayName(_data: UnifiedTimelineItemData<MediaType>): string {
  // 注意：由于类型约束，不再有 unknown 类型，移除相关逻辑

  // 其他情况尝试获取媒体项目名称
  return 'Unknown'
}
