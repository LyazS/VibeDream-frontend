/**
 * 统一时间轴项目数据类型定义（混合类型系统重构版）
 * 基于"类型安全 + 动态类型支持"的改进方案
 *
 * 设计理念：
 * - 使用泛型确保编译时类型安全
 * - 支持媒体类型动态变化（unknown -> 具体类型）
 * - 保持与旧架构相同的精确性
 * - 通过联合类型和类型守卫处理运行时类型检查
 */

import type { Raw } from 'vue'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type { BunnyClip } from '@/core/mediabunny/bunny-clip'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import type { ClipFilterConfig } from '@/core/filter/types'
import type { GetAnimation, TimelineBaseRenderConfig } from './render'
import type { ClipTransitionRuntime } from '../features/transition'
import type { MaskConfig } from '../features/mask'

export type {
  AnimationChannelKey,
  GetAnimation,
  TimelineBaseRenderConfig,
  VisualProps,
  AudioProps,
  TextProps,
  VideoMediaConfig,
  ImageMediaConfig,
  AudioMediaConfig,
  TextMediaConfig,
} from './render'
export type { BlendMode } from './blendMode'
export type { MaskConfig, MaskType } from '../features/mask'

import type { VisualProps, AudioProps } from './render'

// ==================== 基础类型定义 ====================

/**
 * 时间轴项目状态类型 - 3状态简化版
 */
export type TimelineItemStatus = 'ready' | 'loading' | 'error'

// ==================== 配置类型映射 ====================

/**
 * 视觉属性 patch。
 *
 * 视觉坐标语义：
 * - x/y 以画布中心为原点
 * - y > 0 表示向上
 */
export type VisualPropPatch = Partial<VisualProps>

/**
 * 音频属性 patch。
 */
export type AudioPropPatch = Partial<AudioProps>

export interface TimelineExtraRenderConfig {
  filter?: ClipFilterConfig
  transition?: ClipTransitionOutConfig
  mask?: MaskConfig
}

export function createDefaultTimelineExtraRenderConfig(): TimelineExtraRenderConfig {
  return {}
}

// ==================== 统一时间轴项目运行时数据接口 ====================
/**
 * 设计理念：
 * - 包含所有运行时生成的、不可持久化的数据
 * - 支持扩展，未来可以添加更多运行时字段
 * - 与持久化数据完全分离
 */
export interface UnifiedTimelineItemRuntime<T extends MediaType = MediaType> {
  /** 与时间轴项目生命周期一致 */
  bunnyClip?: Raw<BunnyClip>
  textBitmap?: ImageBitmap
  textBitmapVersion?: number
  /** 动画插值后的临时配置（运行时数据，不持久化） */
  renderConfig?: TimelineBaseRenderConfig<T>
  /** 扩展渲染配置的运行时结果（运行时数据，不持久化） */
  exRenderConfig: TimelineExtraRenderConfig
  /** 片段出场转场的运行时绑定与边界帧缓存 */
  transition?: ClipTransitionRuntime
  /**
   * 标识时间轴项目是否已经从 mediaItem 初始化过（必选字段）
   * - true: 已经初始化，不应该再从 mediaItem 同步数据
   * - false: 未初始化，需要等待 mediaItem ready 后同步数据
   */
  isInitialized: boolean
}

// ==================== 核心接口设计 ====================

/**
 * 条件类型：根据 MediaType 确定 mediaItemId 的类型
 * - video/image/audio: mediaItemId 必须是 string
 * - text: mediaItemId 可以是 string | null
 */
export type MediaItemIdType<T extends MediaType> = T extends 'text' ? string | null : string

export type AIMarkMode = 'none' | 'beat1' | 'beat1234'

export type TimelineAnchorSource = 'none' | 'music-structure' | 'beat-this'

export interface TimelineMarker {
  /** 原始媒体中的绝对帧位置，不随片段编辑而改变。 */
  sourceFrame: number
}

export interface AIMark {
  /** 原始媒体中的绝对帧位置，不随片段编辑而改变。 */
  sourceFrame: number
  /** 完整节拍中的拍号。 */
  beat: 1 | 2 | 3 | 4
}

export interface AIMarksGeneratedFor {
  /** 识别时关联的原始媒体。 */
  mediaItemId: string
  /** 已分析素材区间，采用 [start, end) 语义。 */
  sourceStartFrame: number
  sourceEndFrame: number
}

export interface AIMarks {
  /** 仅影响 UI 显示方式。 */
  mode: AIMarkMode
  /** 模型生成的完整四拍结果，使用原始媒体坐标。 */
  marks: AIMark[]
  /** 这份结果实际分析过的素材范围。 */
  generatedFor: AIMarksGeneratedFor
}

/**
 * Per-clip presentation state for music structure metadata stored on the source media.
 * The analysis itself remains shared by every timeline use of that media item.
 */
export interface MusicStructureOverlay {
  visible: boolean
}

/**
 * 统一时间轴项目数据接口（泛型版本）
 *
 * 设计特点：
 * 1. 使用泛型确保类型安全
 * 2. 支持媒体类型动态变化
 * 3. 保持与旧架构相同的精确性
 * 4. 纯数据对象，使用 reactive() 包装
 * 5. 除sprite之外都可以持久化保存
 * 6. 使用条件类型确保不同 MediaType 下 mediaItemId 的类型正确
 */
export interface UnifiedTimelineItemData<T extends MediaType = MediaType> {
  // ==================== 核心属性 ====================
  readonly id: string
  mediaItemId: MediaItemIdType<T>
  trackId: string
  // ==================== 状态管理 ====================
  timelineStatus: TimelineItemStatus
  // ==================== 媒体信息 ====================
  mediaType: T
  // ==================== 时间范围 ====================
  timeRange: UnifiedTimeRange
  /** 手工标记，使用原始媒体坐标。 */
  markers?: TimelineMarker[]
  /** AI 生成的完整节拍标记；未识别时为 undefined。 */
  aiMarks?: AIMarks
  /** Which automatic anchor family is currently shown alongside manual markers. */
  anchorSource?: TimelineAnchorSource
  /** 是否在当前音频片段的波形上绘制音乐结构色带。 */
  musicStructureOverlay?: MusicStructureOverlay
  // ==================== 配置（类型安全） ====================
  baseRenderConfig: TimelineBaseRenderConfig<T>
  /** schema v2 迁移期扩展渲染配置 */
  exRenderConfig: TimelineExtraRenderConfig
  // ==================== 动画配置（类型安全） ====================
  animation?: GetAnimation<T>
  // ==================== 片段滤镜配置（持久化） ====================
  runtime: UnifiedTimelineItemRuntime<T>
}
