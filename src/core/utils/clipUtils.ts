/**
 * 统一Clip架构相关工具函数
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem'

// ==================== 媒体项目信息工具 ====================

/**
 * 获取时间轴项目的显示名称（优先使用媒体项目名称）
 */
export function getTimelineItemDisplayName(data: UnifiedTimelineItemData<MediaType>): string {
  // 对于文本类型，优先显示文本内容
  if (data.mediaType === 'text') {
    const textContent = (data as UnifiedTimelineItemData<'text'>).baseRenderConfig.text.text
    if (textContent && typeof textContent === 'string') {
      return textContent.length > 20 ? textContent.substring(0, 20) + '...' : textContent
    }
  }

  // 注意：由于类型约束，不再有 unknown 类型，移除相关逻辑

  // 其他情况尝试获取媒体项目名称
  return 'Unknown'
}
