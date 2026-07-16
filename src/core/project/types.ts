/**
 * 统一项目配置类型定义
 * 基于新架构统一类型系统的项目配置接口，参考旧架构ProjectConfig设计
 */

import type { UnifiedTrackData } from '@/core/track'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

export const PROJECT_FORMAT_VERSION = '1.0.1'

export function isSupportedProjectFormatVersion(version: unknown): boolean {
  return version === PROJECT_FORMAT_VERSION
}

/**
 * 项目内容数据（从UnifiedProjectConfig中拆分出来）
 *
 * 🌟 阶段二彻底重构：移除 mediaItems 字段
 * 媒体项目通过扫描 media/ 目录下的 .meta 文件动态构建
 */
export interface UnifiedProjectTimeline {
  tracks: UnifiedTrackData[]
  timelineItems: UnifiedTimelineItemData[]
}

/**
 * 统一项目配置接口
 */
export interface UnifiedProjectConfig {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  version: string
  thumbnail?: string
  duration: number // 项目总时长（秒）

  // 项目设置
  settings: {
    videoResolution: {
      name: string
      width: number
      height: number
      aspectRatio: string
    }
    timelineDurationFrames: number
  }
}
