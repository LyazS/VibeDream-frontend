/**
 * 统一数据源系统导出文件
 * 基于"核心数据与行为分离"的响应式重构方案
 */

// ==================== 基础类型和接口 ====================
export {
  // 基础类型定义
  type BaseDataSourceData,

  // 基础查询函数
  RuntimeStateQueries,
} from './datasource/core/BaseDataSource'

// ==================== 统一数据源类型系统 ====================
export {
  // 统一类型定义
  type UnifiedDataSourceData,

  // 工厂函数
  DataSourceFactory,

  // 扩展查询函数（包含类型查询功能）
  DataSourceQueries,
} from './datasource/core/DataSourceTypes'

// ==================== 用户选择文件数据源 ====================
export {
  // 类型定义
  type UserSelectedFileSourceData,

  // 工厂函数
  UserSelectedFileSourceFactory,

  // 类型守卫
  UserSelectedFileTypeGuards,
} from './datasource/providers/user-selected/UserSelectedFileSource'

// ==================== 处理器基础类 ====================
export {
  // 接口
  type AcquisitionTask,

  // 基础处理器类
  DataSourceProcessor,
} from './datasource/core/BaseDataSourceProcessor'

// ==================== 具体处理器实现 ====================
export {
  // 用户选择文件处理器
  UserSelectedFileProcessor,
} from './datasource/providers/user-selected/UserSelectedFileProcessor'

// ==================== 数据源注册中心 ====================
export {
  // 注册中心类
  DataSourceRegistry,

  // 便捷函数
  getDataSourceRegistry,
} from './datasource/registry'

// ==================== 统一媒体项目 ====================
export {
  // 基础类型定义
  type UnifiedMediaItemData,
  type UnifiedMediaItemMetadata,
  type MediaStatus,
  type MediaType,
  type MediaTypeOrUnknown,

  // 状态专门类型定义
  type ReadyMediaItem,
  type ProcessingMediaItem,
  type ErrorMediaItem,
  type PendingMediaItem,

  // 媒体类型专门状态定义
  type VideoMediaItem,
  type ImageMediaItem,
  type AudioMediaItem,
  type TextMediaItem,
  type UnknownMediaItem,
  type KnownMediaItem,
  type VisualMediaItem,
  type AudioCapableMediaItem,

  // 工厂函数
  createUnifiedMediaItemData,

  // 查询函数
  MediaItemQueries,

  // 行为函数
  UnifiedMediaItemActions,
} from './mediaitem'

// ==================== 媒体类型检测工具 ====================
export {
  // 类型定义
  type DetectedMediaType,
  type FileValidationResult,

  // 配置常量
  SUPPORTED_MEDIA_TYPES,
  FILE_SIZE_LIMITS,

  // 检测函数
  detectFileMediaType,
  isSupportedMediaType,
  isSupportedMimeType,
  getMediaTypeFromMimeType,
  getMediaTypeDisplayName,
  getMediaTypeIcon,

  // 验证函数
  validateFile,
} from './utils/mediaTypeDetector'

// ==================== 统一轨道系统 ====================
export {
  // 轨道类型定义
  type UnifiedTrackData,
  type UnifiedTrackType,

  // 工厂函数和类型守卫
  createUnifiedTrackData,
  isVideoTrack,
  isAudioTrack,
  isTextTrack,
} from './track'

// ==================== 统一时间轴项目系统 ====================
export {
  // 时间轴项目类型定义
  type UnifiedTimelineItemData,
  type TimelineItemStatus,
  type TransformData,

  // 工厂函数集合
  TimelineItemFactory,

  // 查询工具集合
  TimelineItemQueries,
} from './timelineitem'

// ==================== 统一模块系统 ====================
export {
  // 统一轨道模块
  createUnifiedTrackModule,
  type UnifiedTrackModule,
} from './modules/UnifiedTrackModule'

export {
  // 统一媒体模块
  createUnifiedMediaModule,
  type UnifiedMediaModule,
} from './modules/UnifiedMediaModule'

export {
  // 统一时间轴模块
  createUnifiedTimelineModule,
  type UnifiedTimelineModule,
} from './modules/UnifiedTimelineModule'

export {
  // 统一视口模块
  createUnifiedViewportModule,
  type UnifiedViewportModule,
} from './modules/UnifiedViewportModule'

export {
  // 统一选择模块
  createUnifiedSelectionModule,
  type UnifiedSelectionModule,
} from './modules/UnifiedSelectionModule'

// ==================== 统一用户模块 ====================
export {
  // 统一用户模块
  createUnifiedUserModule,
  type UnifiedUserModule,
} from './modules/UnifiedUserModule'

// ==================== 统一工具函数 ====================
export {
  // 时间范围工具
  calculateDuration,
} from './utils'

// ==================== 统一Composables ====================
export {
  // 拖拽预览管理器
  getDragPreviewManager,

  // 历史记录操作
  useHistoryOperations,
} from './composables'

// ==================== 统一类型定义 ====================
export {
  // 拖拽相关类型
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
} from './types'
