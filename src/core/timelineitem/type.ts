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
import type { GetConfigs, GetAnimation } from './bunnytype'

// 重新导出 bunnytype 中的类型供其他模块使用
export type {
  AnimationChannelKey,
  GetConfigs,
  GetAnimation,
  VisualProps,
  AudioProps,
  TextProps,
  VideoMediaConfig,
  ImageMediaConfig,
  AudioMediaConfig,
  TextMediaConfig,
} from './bunnytype'
export type { MaskConfig, MaskType } from './mask'
import type {
  AnimationChannelKey,
  VisualProps,
  AudioProps,
  TextProps,
  VideoMediaConfig,
  ImageMediaConfig,
  AudioMediaConfig,
  TextMediaConfig,
} from './bunnytype'

// ==================== 基础类型定义 ====================

/**
 * 时间轴项目状态类型 - 3状态简化版
 */
export type TimelineItemStatus =
  | 'ready' // 完全就绪，可用于时间轴
  | 'loading' // 正在处理中，包含下载、解析、等待
  | 'error' // 不可用状态，包含错误、缺失、取消

// ==================== 配置类型映射 ====================

/**
 * 变换数据接口。
 *
 * 视觉坐标语义：
 * - x/y 以画布中心为原点
 * - y > 0 表示向上
 */
export type TransformData = Partial<VisualProps> & Partial<AudioProps>
export type TransformDataEx = TransformData & {
  duration?: number // 时长（帧数）- 用于时间轴项目时长调整
  playbackRate?: number
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
  bunnyClip?: Raw<BunnyClip> // mediabunny的clip对象
  textBitmap?: ImageBitmap // 专门用于文本渲染的ImageBitmap
  textBitmapVersion?: number // 文本位图重建版本，用于驱动 WebGL 纹理重新上传
  /** 动画插值后的临时配置（运行时数据，不持久化） */
  renderConfig?: GetConfigs<T>

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
  mediaItemId: MediaItemIdType<T> // 关联的统一媒体项目ID，类型根据 MediaType 自动推断
  trackId: string

  // ==================== 状态管理 ====================
  timelineStatus: TimelineItemStatus // 仅3状态：ready|loading|error

  // ==================== 媒体信息 ====================
  mediaType: T

  // ==================== 时间范围 ====================
  timeRange: UnifiedTimeRange

  // ==================== 配置（类型安全） ====================
  config: GetConfigs<T>

  // ==================== 动画配置（类型安全） ====================
  animation?: GetAnimation<T>

  // ==================== 运行时数据（不可持久化） ====================
  runtime: UnifiedTimelineItemRuntime<T>

  // ==================== 占位符标识（可选） ====================
  /**
   * 是否为占位符项目
   * - true: ASR占位符，只在时间轴上占位，不需要渲染
   * - false/undefined: 正常项目，需要正常的创建/恢复流程
   *
   * 占位符项目特点：
   * 1. 不需要调用 rebuildForCmd（因为没有关联的媒体项目）
   * 2. 不需要调用 setupTimelineItemBunny（因为不需要渲染）
   * 3. 只需要克隆后直接添加到时间轴
   */
  isPlaceholder?: boolean
}
