/**
 * 统一架构下的类型定义索引文件
 */

// ==================== 时间重叠检测相关类型 ====================
export {
  // 时间重叠检测接口
  type OverlapTimeRange,
  type OverlapResult,
  type ConflictInfo,
} from './timeOverlap'

// ==================== 拖拽相关类型 ====================
export {
  // 拖拽数据结构
  type TimelineItemDragData,
  type MediaItemDragData,
  type DragPreviewData,
  type BaseDragData,
  type FolderDragData,
  type UnifiedDragData,

  // 拖拽源和目标类型
  DragSourceType,
  DropTargetType,

  // 拖拽参数
  type FolderDragParams,
  type TimelineItemDragParams,
  type DragSourceParams,

  // 拖拽目标信息
  type DropTargetInfo,

  // 拖拽处理器接口
  type DragSourceHandler,
  type DropTargetHandler,
} from './drag'

// ==================== Clip渲染器相关类型 ====================
export {
  // 渲染器工厂接口
  type ContentRendererFactory,

  // 渲染器类型定义
  type StatusRendererType,
  type MediaTypeRendererType,
  type RendererType,

  // 组件接口
  type UnifiedTimelineClipProps,
  type UnifiedTimelineClipEvents,

  // 模板组件接口
  type ContentTemplateProps,
} from './clipRenderer'

/**
 * 视频分辨率接口
 */
export interface VideoResolution {
  name: string
  width: number
  height: number
  aspectRatio: string
  category?: string
}
