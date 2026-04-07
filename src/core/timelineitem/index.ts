/**
 * 统一时间轴项目模块入口
 * 基于"核心数据 + 行为分离"的响应式重构版本
 */

// ==================== 类型定义导出 ====================
export type {
  // 核心数据类型
  UnifiedTimelineItemData,
  TimelineItemStatus,
  TransformData,
  TransformDataEx,
  BlendMode,
  VideoMediaConfig,
  AudioMediaConfig,
} from './type'
export type {
  ClipTransitionRuntime,
  ClipTransitionBindingState,
  ClipTransitionPlaybackState,
  ClipTransitionVisualTimelineItem,
} from './transition'
export type { ClipTransitionOutConfig } from '@/core/transition/types'
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
} from './transition'
export { DEFAULT_CLIP_TRANSITION_DURATION_FRAMES } from '@/core/transition/types'

// 从 texttype.ts 导出文本相关类型
export type { TextStyleConfig } from './texttype'
export { DEFAULT_TEXT_STYLE } from './texttype'

// 动画类型导出
export type { KeyframeButtonState, KeyframeUIState } from './animationtypes'

// ==================== 工厂函数导出 ====================
export { TimelineItemFactory } from './factory'

// ==================== 状态显示工具导出 ====================
export {
  // 状态显示工具类
  TimelineStatusDisplayUtils,
  createStatusDisplayComputeds,
} from './statusdisplayutils'

// 状态显示类型导出
export type { StatusDisplayInfo } from './statusdisplayutils'

// ==================== 查询工具导出 ====================
export { TimelineItemQueries } from './queries'

export {
  BLEND_MODE_VALUES,
  DEFAULT_BLEND_MODE,
  BLEND_MODE_UNIFORM_VALUES,
  BLEND_MODE_HISTORY_LABELS,
  isBlendMode,
} from './blendMode'
