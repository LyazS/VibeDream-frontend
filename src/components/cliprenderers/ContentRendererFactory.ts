/**
 * 内容渲染器工厂
 * 基于状态优先的渲染策略选择合适的渲染器
 *
 * 设计理念：
 * - 状态优先：优先基于状态选择渲染器，确保状态显示的一致性
 * - 媒体类型次之：ready状态下基于媒体类型选择渲染器
 * - 可扩展：支持注册自定义渲染器
 * - 兜底机制：提供默认渲染器确保系统稳定性
 *
 * 激进重构版：支持模板组件模式
 */

import type { Component } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem/types'
import type { TimelineItemStatus } from '@/core/timelineitem/model/timelineItem'

// 导入模板组件
import VideoContent from '@/components/cliprenderers/VideoContent.vue'
import AudioContent from '@/components/cliprenderers/AudioContent.vue'
import TextContent from '@/components/cliprenderers/TextContent.vue'
import LoadingContent from '@/components/cliprenderers/LoadingContent.vue'
import ErrorContent from '@/components/cliprenderers/ErrorContent.vue'
import DefaultContent from '@/components/cliprenderers/DefaultContent.vue'

// ==================== 渲染器工厂类 ====================

/**
 * 内容渲染器工厂类
 */
export class ContentRendererFactory {
  // 状态模板组件映射（新架构）
  private static statusTemplates = new Map<TimelineItemStatus, Component>()

  // 媒体类型模板组件映射（新架构，仅用于ready状态）
  private static mediaTypeTemplates = new Map<MediaType, Component>()

  // 默认模板组件（新架构）
  private static defaultTemplate = DefaultContent

  // 静态初始化标志
  private static templatesInitialized = false

  // ==================== 模板组件方法 ====================

  /**
   * 获取指定数据的模板组件
   * 优先基于状态选择，然后基于媒体类型选择
   */
  static getTemplateComponent<T extends MediaType>(data: UnifiedTimelineItemData<T>): Component {
    // 确保模板组件已初始化
    this.ensureTemplatesInitialized()

    // 第一优先级：状态模板
    if (data.timelineStatus !== 'ready') {
      const statusComponent = this.statusTemplates.get(data.timelineStatus)
      if (statusComponent) return statusComponent
    }

    // 第二优先级：媒体类型模板
    if (data.timelineStatus === 'ready') {
      const mediaTypeComponent = this.mediaTypeTemplates.get(data.mediaType)
      if (mediaTypeComponent) return mediaTypeComponent
    }

    // 兜底：默认模板
    return this.defaultTemplate
  }

  // ==================== 注册方法 ====================

  /**
   * 注册状态模板组件（新架构）
   * @param status 状态类型
   * @param component 模板组件
   */
  static registerStatusTemplate(status: TimelineItemStatus, component: Component): void {
    this.statusTemplates.set(status, component)
  }

  /**
   * 注册媒体类型模板组件（新架构）
   * @param type 媒体类型
   * @param component 模板组件
   */
  static registerMediaTypeTemplate(type: MediaType, component: Component): void {
    this.mediaTypeTemplates.set(type, component)
  }

  // ==================== 初始化方法 ====================

  /**
   * 确保模板组件已初始化
   */
  private static ensureTemplatesInitialized(): void {
    if (!this.templatesInitialized) {
      this.initializeDefaultTemplates()
      this.templatesInitialized = true
    }
  }

  /**
   * 初始化默认模板组件（新架构）
   */
  private static initializeDefaultTemplates(): void {
    // 注册状态模板组件
    this.statusTemplates.set('loading', LoadingContent)
    this.statusTemplates.set('error', ErrorContent)

    // 注册媒体类型模板组件
    this.mediaTypeTemplates.set('video', VideoContent)
    this.mediaTypeTemplates.set('image', VideoContent) // 视频和图片使用同一个模板
    this.mediaTypeTemplates.set('audio', AudioContent)
    this.mediaTypeTemplates.set('text', TextContent)

    console.log('🎨 ContentRendererFactory: 默认模板组件已初始化')
  }
}
