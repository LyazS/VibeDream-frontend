/**
 * 统一时间轴项目模块入口。
 */

export type {
  UnifiedTimelineItemData,
  UnifiedTimelineItemRuntime,
  TimelineItemStatus,
  TimelinePlaceholder,
  TimelinePlaceholderState,
  TimelineProvenance,
  VisualPropPatch,
  AudioPropPatch,
  BlendMode,
  VideoMediaConfig,
  AudioMediaConfig,
} from './model/timelineItem'

export type { KeyframeButtonState, KeyframeUIState } from './model/keyframeUi'

export * as TimelineItemModel from './model/timelineItem'
export * as TimelineItemRenderModel from './model/render'
export * as TimelineItemAnimationModel from './model/keyframeUi'
export * as TimelineItemRuntimeFactory from './runtime/factory'
export * as TimelineItemUiStatus from './ui/statusDisplay'

export { TimelineItemFactory } from './runtime/factory'
export {
  TimelineStatusDisplayUtils,
  createStatusDisplayComputeds,
} from './ui/statusDisplay'
export type { StatusDisplayInfo } from './ui/statusDisplay'
export { TimelineItemQueries } from './queries'

export {
  BLEND_MODE_VALUES,
  DEFAULT_BLEND_MODE,
  BLEND_MODE_UNIFORM_VALUES,
  BLEND_MODE_HISTORY_LABELS,
  isBlendMode,
} from './model/blendMode'
