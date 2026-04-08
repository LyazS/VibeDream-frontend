/**
 * 时间轴吸附功能类型定义
 */

/**
 * 吸附点基础接口
 */
export interface BaseSnapPoint {
  frame: number
  priority: number
}

/**
 * 片段边界吸附点
 */
export interface ClipBoundarySnapPoint extends BaseSnapPoint {
  type: 'clip-start' | 'clip-end'
  clipId: string
  clipName: string
  priority: 1 // 高优先级
  snappedPart?: 'start' | 'end' // 新增：标识是clip的哪个部分被吸附
}

/**
 * 转场边界吸附点
 */
export interface TransitionBoundarySnapPoint extends BaseSnapPoint {
  type: 'transition-start' | 'transition-end'
  clipId: string
  clipName: string
  priority: 1
}

/**
 * 关键帧吸附点
 */
export interface KeyframeSnapPoint extends BaseSnapPoint {
  type: 'keyframe'
  clipId: string
  keyframeId: string
  priority: 2 // 中优先级
}

/**
 * 播放头位置吸附点
 */
export interface PlayheadSnapPoint extends BaseSnapPoint {
  type: 'playhead'
  priority: 1 // 高优先级
}

/**
 * 时间轴起始点吸附点
 */
export interface TimelineStartSnapPoint extends BaseSnapPoint {
  type: 'timeline-start'
  frame: 0
  priority: 3 // 低优先级
}

/**
 * 所有吸附点类型的联合类型
 */
export type SnapPoint =
  | ClipBoundarySnapPoint
  | TransitionBoundarySnapPoint
  | KeyframeSnapPoint
  | PlayheadSnapPoint
  | TimelineStartSnapPoint

/**
 * 吸附配置接口
 */
export interface SnapConfig {
  // 全局吸附开关
  enabled: boolean

  // 分类型开关
  clipBoundaries: boolean // 片段边界吸附
  keyframes: boolean // 关键帧吸附
  playhead: boolean // 播放头吸附
  timelineStart: boolean // 时间轴起始位置吸附

  // 吸附参数
  threshold: number // 吸附阈值（像素，不受zoom level影响）
  visualFeedback: boolean // 可视化反馈开关
}

/**
 * 吸附计算结果
 */
export interface SnapResult {
  // 吸附后的帧数
  frame: number

  // 吸附点信息
  snapPoint: SnapPoint

  // 吸附距离（帧数）
  distance: number
}

/**
 * 吸附计算选项
 */
export interface SnapCalculationOptions {
  // 排除的片段ID列表（避免自己吸附到自己）
  excludeClipIds?: string[]

  // 是否启用临时禁用（如按住Alt键）
  temporaryDisabled?: boolean

  // 自定义吸附阈值（覆盖配置中的阈值）
  customThreshold?: number
}

/**
 * 吸附点收集选项
 */
export interface SnapPointCollectionOptions {
  // 是否包含片段边界点
  includeClipBoundaries?: boolean

  // 是否包含关键帧点
  includeKeyframes?: boolean

  // 是否包含播放头位置
  includePlayhead?: boolean

  // 是否包含时间轴起始位置
  includeTimelineStart?: boolean

  // 排除的片段ID列表
  excludeClipIds?: string[]

  // 帧数范围限制（只收集此范围内的吸附点）
  frameRange?: {
    start: number
    end: number
  }
}

/**
 * 默认吸附配置
 */
export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  clipBoundaries: true,
  keyframes: true,
  playhead: true, // 启用播放头吸附
  timelineStart: true,
  threshold: 20, // 20像素
  visualFeedback: true,
}
