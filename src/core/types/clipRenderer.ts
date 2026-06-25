/**
 * 统一Clip架构 - 内容渲染类型定义
 *
 * 模板组件架构：使用Vue SFC模板组件替代类渲染器
 * 注意：模板组件直接定义props接口，不再使用这里的类型
 */

import type { VNode, Component } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem/types'
import type { UnifiedTimeRange } from '@/core/types/timeRange'

export interface ClipRenderFrame {
  timeRange: UnifiedTimeRange
  widthPixels: number
  durationFrames: number
  sourceDurationFrames: number
  frameToLocalPixel(frame: number): number
  relativeFrameToLocalPixel(relativeFrame: number): number
  sourceFrameToLocalPixel(sourceFrame: number): number
}

export function createClipRenderFrame(
  timeRange: UnifiedTimeRange,
  widthPixels: number,
): ClipRenderFrame {
  const durationFrames = Math.max(1, timeRange.timelineEndTime - timeRange.timelineStartTime)
  const sourceDurationFrames = Math.max(1, timeRange.clipEndTime - timeRange.clipStartTime)
  const safeWidthPixels = Math.max(0, widthPixels)

  return {
    timeRange,
    widthPixels: safeWidthPixels,
    durationFrames,
    sourceDurationFrames,
    frameToLocalPixel(frame: number): number {
      return ((frame - timeRange.timelineStartTime) / durationFrames) * safeWidthPixels
    },
    relativeFrameToLocalPixel(relativeFrame: number): number {
      return (relativeFrame / durationFrames) * safeWidthPixels
    },
    sourceFrameToLocalPixel(sourceFrame: number): number {
      return ((sourceFrame - timeRange.clipStartTime) / sourceDurationFrames) * safeWidthPixels
    },
  }
}

// ==================== 渲染器类型定义 ====================

/**
 * 状态渲染器类型（优先级最高）
 */
export type StatusRendererType = 'loading' | 'error'

/**
 * 媒体类型渲染器类型（仅用于ready状态）
 */
export type MediaTypeRendererType = 'video' | 'image' | 'audio' | 'text'

/**
 * 所有渲染器类型的联合
 */
export type RendererType = StatusRendererType | MediaTypeRendererType

// ==================== 工厂接口 ====================

/**
 * 渲染器工厂接口（模板组件架构）
 */
export interface ContentRendererFactory {
  /**
   * 获取指定数据的模板组件
   * 优先基于状态选择，然后基于媒体类型选择
   */
  getTemplateComponent<T extends MediaType>(data: UnifiedTimelineItemData<T>): Component

  /**
   * 注册状态模板组件
   */
  registerStatusTemplate(status: StatusRendererType, component: Component): void

  /**
   * 注册媒体类型模板组件
   */
  registerMediaTypeTemplate<T extends MediaType>(type: T, component: Component): void
}

// ==================== 组件属性接口 ====================

/**
 * 时间轴项目公共属性接口
 * 用于所有需要基本时间轴项目信息的组件
 */
interface TimelineItemProps<T extends MediaType = MediaType> {
  /** 时间轴项目数据 - 必选 */
  data: UnifiedTimelineItemData<T>

  /** 是否被选中 - 必选 */
  isSelected: boolean

  /** 是否多选状态 - 必选 */
  isMultiSelected: boolean

  /** 轨道高度 - 必选 */
  trackHeight: number

  /** 时间轴宽度（用于坐标转换） - 必选 */
  timelineWidth: number

  /** 视口帧范围 - 必选 */
  viewportFrameRange: {
    startFrames: number
    endFrames: number
  }

  /** 当前渲染基准。拖动左边界时可传入 preview frame，避免内部内容被左边界带着平移。 */
  renderFrame?: ClipRenderFrame
}

/**
 * UnifiedTimelineClip组件属性 - 继承公共接口
 */
export type UnifiedTimelineClipProps<T extends MediaType = MediaType> = TimelineItemProps<T>

/**
 * 模板组件属性 - 继承公共接口
 */
export type ContentTemplateProps<T extends MediaType = MediaType> = TimelineItemProps<T>

// ==================== 组件事件接口 ====================

/**
 * UnifiedTimelineClip组件事件
 */
export interface UnifiedTimelineClipEvents {
  /** 选中事件 */
  select: (id: string) => void

  /** 双击事件 */
  doubleClick: (id: string) => void

  /** 右键菜单事件 */
  contextMenu: (event: MouseEvent, id: string) => void

  /** 拖拽开始事件 */
  dragStart: (event: DragEvent, id: string) => void

  /** 调整大小开始事件 */
  resizeStart: (event: MouseEvent, id: string, direction: 'left' | 'right') => void
}
