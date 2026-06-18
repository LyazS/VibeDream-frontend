/**
 * 统一时间轴项目模块入口
 * 基于“核心数据 + 行为分离”的响应式重构版本
 *
 * 目录约定：
 * - model: 纯类型、常量
 * - features: transition/filter/mask 等能力域
 * - runtime: 创建、重建、恢复逻辑
 * - ui: 仅面向展示层的派生逻辑
 *
 * 顶层文件当前保留兼容导出，避免一次性修改全部调用方。
 */

// ==================== 类型定义导出 ====================
export type {
  // 核心数据类型
  UnifiedTimelineItemData,
  TimelineItemStatus,
  TimelineExtraRenderConfig,
  VisualPropPatch,
  AudioPropPatch,
  BlendMode,
  VideoMediaConfig,
  AudioMediaConfig,
} from './model/timelineItem'
export { createDefaultTimelineExtraRenderConfig } from './model/timelineItem'
export type {
  ClipTransitionRuntime,
  ClipTransitionBindingState,
  ClipTransitionPlaybackState,
  ClipTransitionVisualTimelineItem,
} from './features/transition'
export type { ClipFilterVisualTimelineItem } from './features/filter'
export type { ClipTransitionOutConfig } from '@/core/transition/types'
export type { ClipFilterConfig } from '@/core/filter/types'
export {
  createDefaultClipTransitionOutConfig,
  normalizeClipTransitionOutConfig,
  supportsClipTransitionOut,
  supportsClipTransitionOutMediaType,
  hasEnabledClipTransitionOut,
  ensureClipTransitionRuntime,
  closeClipTransitionEdgeFrames,
  resetClipTransitionRuntime,
  resolveTransitionBoundaryFrames,
  resolveClipTransitionBinding,
  resolveClipTransitionPlaybackState,
  doClipTransitionWindowsOverlap,
} from './features/transition'
export {
  createDefaultClipFilterConfig,
  normalizeClipFilterConfig,
  areClipFilterConfigsEqual,
  supportsClipFilter,
  supportsClipFilterMediaType,
  hasEnabledClipFilter,
} from './features/filter'
export { DEFAULT_CLIP_TRANSITION_DURATION_FRAMES } from '@/core/transition/types'
export { DEFAULT_CLIP_FILTER_INTENSITY } from '@/core/filter/types'

// 文本相关类型导出
export type { TextStyleConfig } from './model/textStyle'
export { DEFAULT_TEXT_STYLE } from './model/textStyle'

// 动画类型导出
export type { KeyframeButtonState, KeyframeUIState } from './model/keyframeUi'

// 新结构导出
export * as TimelineItemModel from './model/timelineItem'
export * as TimelineItemRenderModel from './model/render'
export * as TimelineItemTextModel from './model/textStyle'
export * as TimelineItemAnimationModel from './model/keyframeUi'
export * as TimelineItemFeatureFilter from './features/filter'
export * as TimelineItemFeatureMask from './features/mask'
export * as TimelineItemFeatureTransition from './features/transition'
export * as TimelineItemRuntimeFactory from './runtime/factory'
export * as TimelineItemRuntimeText from './runtime/textRuntime'
export * as TimelineItemUiStatus from './ui/statusDisplay'
export * as TimelineItemUiTransitionOverlay from './ui/transitionOverlay'

// ==================== 工厂函数导出 ====================
export { TimelineItemFactory } from './runtime/factory'

// ==================== 状态显示工具导出 ====================
export {
  // 状态显示工具类
  TimelineStatusDisplayUtils,
  createStatusDisplayComputeds,
} from './ui/statusDisplay'

// 状态显示类型导出
export type { StatusDisplayInfo } from './ui/statusDisplay'

// ==================== 查询工具导出 ====================
export { TimelineItemQueries } from './queries'

export {
  BLEND_MODE_VALUES,
  DEFAULT_BLEND_MODE,
  BLEND_MODE_UNIFORM_VALUES,
  BLEND_MODE_HISTORY_LABELS,
  isBlendMode,
} from './model/blendMode'
