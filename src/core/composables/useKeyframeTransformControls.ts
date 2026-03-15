/**
 * 关键帧动画和位置大小变换统一控制器（新架构适配版）
 * 提供关键帧动画、位置、大小、旋转、透明度等变换属性的统一管理
 */

import { computed, readonly, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { normalizeAngle } from '@/core/utils/rotationTransform'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type {
  KeyframeUIState,
  KeyframeButtonState,
} from '@/core/timelineitem/animationtypes'
import {
  getKeyframeButtonState,
  getKeyframeUIState,
  getPreviousKeyframeFrame,
  getNextKeyframeFrame,
  findKeyframeAtFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import { debugKeyframes } from '@/core/utils/unifiedKeyframeUtils'
import { UpdatePropertyCommand } from '@/core/modules/commands/keyframes'
import { BatchUpdatePropertiesCommand } from '@/core/modules/commands/batchCommands'
import { useDeferredPropertyUpdate } from './useDeferredPropertyUpdate'

interface UnifiedKeyframeTransformControlsOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

/**
 * 关键帧动画和变换控制器（新架构版本）
 */
export function useUnifiedKeyframeTransformControls(
  options: UnifiedKeyframeTransformControlsOptions,
) {
  const { selectedTimelineItem, currentFrame } = options
  const unifiedStore = useUnifiedStore()

  // ==================== 延迟更新工具（滑块拖动优化）====================
  const deferredUpdate = useDeferredPropertyUpdate({
    selectedTimelineItem,
    currentFrame,
  })

  // ==================== 关键帧UI状态 ====================

  const keyframeUIState = computed<KeyframeUIState>(() => {
    if (!selectedTimelineItem.value) {
      return { hasAnimation: false, isOnKeyframe: false }
    }
    selectedTimelineItem.value.animation?.keyframes.length
    return getKeyframeUIState(selectedTimelineItem.value, currentFrame.value)
  })

  const buttonState = computed<KeyframeButtonState>(() => {
    if (!selectedTimelineItem.value) {
      return 'none'
    }
    selectedTimelineItem.value.animation?.keyframes.length
    return getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)
  })

  const hasPreviousKeyframe = computed(() => {
    if (!selectedTimelineItem.value) return false
    return getPreviousKeyframeFrame(selectedTimelineItem.value, currentFrame.value) !== null
  })

  const hasNextKeyframe = computed(() => {
    if (!selectedTimelineItem.value) return false
    return getNextKeyframeFrame(selectedTimelineItem.value, currentFrame.value) !== null
  })

  const isPlayheadInClip = computed(() => {
    if (!selectedTimelineItem.value) return false
    return isPlayheadInTimelineItem(selectedTimelineItem.value, currentFrame.value)
  })

  const canOperateKeyframes = computed(() => {
    return isPlayheadInClip.value
  })

  // ==================== 变换属性计算 ====================

  // 变换属性 - 基于TimelineItem的响应式计算属性（类型安全版本）
  const transformX = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 0
    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    return config.x
  })

  const transformY = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 0
    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    return config.y
  })

  /**
   * 获取时间轴项目的原始尺寸
   * - 视频/图片：从 mediaItem.runtime.bunny 获取
   * - 文本：从 timelineItem.runtime.textBitmap 获取
   */
  const getOriginalDimensions = (): { width: number; height: number } => {
    if (!selectedTimelineItem.value || !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)) {
      return { width: 0, height: 0 }
    }

    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)

    // 文本类型：从 textBitmap 获取原始尺寸（使用类型守卫）
    if (TimelineItemQueries.isTextTimelineItem(selectedTimelineItem.value)) {
      const textBitmap = selectedTimelineItem.value.runtime.textBitmap
      return {
        width: textBitmap?.width ?? config.width,
        height: textBitmap?.height ?? config.height,
      }
    }

    // 其他类型：从 mediaItem 的 bunny 对象获取原始尺寸
    const mediaItem = unifiedStore.getMediaItem(selectedTimelineItem.value.mediaItemId)
    return {
      width: mediaItem?.runtime.bunny?.originalWidth ?? config.width,
      height: mediaItem?.runtime.bunny?.originalHeight ?? config.height,
    }
  }

  const scaleX = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 1

    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    const { width: originalWidth } = getOriginalDimensions()
    return config.width / originalWidth
  })

  const scaleY = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 1

    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    const { height: originalHeight } = getOriginalDimensions()
    return config.height / originalHeight
  })

  const rotation = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 0
    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    return config.rotation  // ✅ 直接返回角度值
  })

  const opacity = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 1
    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    return config.opacity
  })

  // 音量属性（支持视频和音频，支持关键帧动画）
  const volume = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasAudioProperties(selectedTimelineItem.value)
    )
      return 1
    // ✅ 使用辅助函数获取渲染配置
    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    return config.volume ?? 1
  })

  // 注意：isMuted 不需要添加到这里，保持在组件中独立处理

  // 等比缩放相关（每个clip独立状态）
  const proportionalScale = computed({
    get: () => {
      if (
        !selectedTimelineItem.value ||
        !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
      )
        return true
      // hasVisualProperties 类型守卫确保了 config 具有视觉属性
      return selectedTimelineItem.value.config.proportionalScale
    },
    set: (value) => {
      if (
        !selectedTimelineItem.value ||
        !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
      )
        return
      // hasVisualProperties 类型守卫确保了 config 具有视觉属性
      selectedTimelineItem.value.config.proportionalScale = value
    },
  })

  // 等比缩放相关
  const uniformScale = computed(() => scaleX.value) // 使用X缩放值作为统一缩放值

  // 元素原始尺寸获取
  const elementWidth = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 0
    // 使用统一的获取原始尺寸方法
    const { width } = getOriginalDimensions()
    return width
  })

  const elementHeight = computed(() => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return 0
    // 使用统一的获取原始尺寸方法
    const { height } = getOriginalDimensions()
    return height
  })

  // ==================== 关键帧控制方法 ====================

  /**
   * 批量更新属性（使用现有的命令系统）
   * 🎯 正确方案：利用现有的批量操作架构，而不是重新实现
   */
  const updateUnifiedPropertyBatch = async (properties: Record<string, any>) => {
    if (!selectedTimelineItem.value || currentFrame.value == null) return

    try {
      // 创建多个属性更新命令
      const updateCommands = Object.entries(properties).map(([property, value]) => {
        return new UpdatePropertyCommand(
          selectedTimelineItem.value!.id,
          currentFrame.value!,
          property,
          value,
          {
            getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
          },
          { seekTo: unifiedStore.seekToFrame }, // 播放头控制器
        )
      })

      // 创建批量命令
      const batchCommand = new BatchUpdatePropertiesCommand([selectedTimelineItem.value.id], updateCommands)

      // 通过历史模块执行批量命令
      await unifiedStore.executeBatchCommand(batchCommand)

      console.log('🎬 [Keyframe Transform Controls] Batch property update completed via command system:', {
        itemId: selectedTimelineItem.value.id,
        properties: Object.keys(properties),
        currentFrame: currentFrame.value,
        buttonState: buttonState.value,
        commandCount: updateCommands.length,
      })
    } catch (error) {
      console.error('🎬 [Keyframe Transform Controls] Failed to batch update properties:', error)
    }
  }

  /**
   * 获取统一关键帧按钮的提示文本
   */
  const getUnifiedKeyframeTooltip = () => {
    // 如果播放头不在clip时间范围内，显示相应提示
    if (!canOperateKeyframes.value) {
      return '播放头不在当前clip时间范围内，无法操作关键帧'
    }

    switch (buttonState.value) {
      case 'none':
        return '点击创建关键帧动画'
      case 'on-keyframe':
        return '当前在关键帧位置，点击删除关键帧'
      case 'between-keyframes':
        return '点击在当前位置创建关键帧'
      default:
        return '关键帧控制'
    }
  }

  /**
   * 统一关键帧调试信息
   */
  const debugUnifiedKeyframes = async () => {
    if (!selectedTimelineItem.value) {
      console.log('🎬 [Unified Debug] 没有选中的时间轴项目')
      return
    }

    try {
      debugKeyframes(selectedTimelineItem.value)
    } catch (error) {
      console.error('🎬 [Unified Debug] 调试失败:', error)
    }
  }

  // ==================== 变换更新方法 ====================

  /**
   * 更新变换属性 - 使用带历史记录的方法
   */
  const updateTransform = async (transform?: {
    x?: number
    y?: number
    width?: number
    height?: number
    rotation?: number
    opacity?: number
    volume?: number      // 新增：音量支持关键帧
  }) => {
    if (!selectedTimelineItem.value) return

    // 检查播放头是否在clip时间范围内
    if (!canOperateKeyframes.value) {
      unifiedStore.messageWarning(
        '播放头不在当前视频片段的时间范围内。请将播放头移动到片段内再尝试修改属性。',
      )
      console.warn('🎬 [Keyframe Transform Controls] 播放头不在当前clip时间范围内，无法操作关键帧属性:', {
        itemId: selectedTimelineItem.value.id,
        currentFrame: currentFrame.value,
      })
      return
    }

    // 如果没有提供transform参数，使用当前的响应式值（类型安全版本）
    const finalTransform = transform || {
      x: transformX.value,
      y: transformY.value,
      width: TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
        ? selectedTimelineItem.value.config.width
        : 0,
      height: TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
        ? selectedTimelineItem.value.config.height
        : 0,
      rotation: rotation.value,
      opacity: opacity.value,
      volume: volume.value,      // 新增：音量
    }

    // 🎯 特殊处理：如果同时设置了width和height，使用批量更新避免重复位置计算
    if (finalTransform.width !== undefined && finalTransform.height !== undefined) {
      await updateUnifiedPropertyBatch({
        width: finalTransform.width,
        height: finalTransform.height,
      })
    } else {
      // 单独处理尺寸属性
      if (finalTransform.width !== undefined) {
        await unifiedStore.updatePropertyWithHistory(
          selectedTimelineItem.value.id,
          currentFrame.value,
          'width',
          finalTransform.width,
        )
      }
      if (finalTransform.height !== undefined) {
        await unifiedStore.updatePropertyWithHistory(
          selectedTimelineItem.value.id,
          currentFrame.value,
          'height',
          finalTransform.height,
        )
      }
    }

    // 处理其他属性
    if (finalTransform.x !== undefined) {
      await unifiedStore.updatePropertyWithHistory(
        selectedTimelineItem.value.id,
        currentFrame.value,
        'x',
        finalTransform.x,
      )
    }
    if (finalTransform.y !== undefined) {
      await unifiedStore.updatePropertyWithHistory(
        selectedTimelineItem.value.id,
        currentFrame.value,
        'y',
        finalTransform.y,
      )
    }
    if (finalTransform.rotation !== undefined) {
      await unifiedStore.updatePropertyWithHistory(
        selectedTimelineItem.value.id,
        currentFrame.value,
        'rotation',
        finalTransform.rotation,
      )
    }
    if (finalTransform.opacity !== undefined) {
      await unifiedStore.updatePropertyWithHistory(
        selectedTimelineItem.value.id,
        currentFrame.value,
        'opacity',
        finalTransform.opacity,
      )
    }
    if (finalTransform.volume !== undefined) {
      await unifiedStore.updatePropertyWithHistory(
        selectedTimelineItem.value.id,
        currentFrame.value,
        'volume',
        finalTransform.volume,
      )
    }

    console.log('✅ 统一关键帧变换属性更新完成')
  }

  // ==================== 缩放控制方法 ====================

  /**
   * 切换等比缩放
   */
  const toggleProportionalScale = () => {
    // 先切换状态
    proportionalScale.value = !proportionalScale.value

    // 如果刚刚开启等比缩放，使用当前X缩放值作为统一缩放值，同时更新Y缩放
    if (
      proportionalScale.value &&
      selectedTimelineItem.value &&
      TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    ) {
      // 使用统一的获取原始尺寸方法
      const { width: originalWidth, height: originalHeight } = getOriginalDimensions()
      const newSize = {
        width: originalWidth * scaleX.value,
        height: originalHeight * scaleX.value, // 使用X缩放值保持等比
      }
      updateTransform({ width: newSize.width, height: newSize.height })
    }
  }

  /**
   * 更新统一缩放（延迟更新 - 用于 SliderInput @input）
   */
  const updateUniformScaleDeferred = (newScale: number) => {
    if (
      !proportionalScale.value ||
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config
    // 使用统一的获取原始尺寸方法
    const { width: originalWidth, height: originalHeight } = getOriginalDimensions()
    const newWidth = originalWidth * newScale
    const newHeight = originalHeight * newScale

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      // 记录初始值（width 和 height 同时记录）
      deferredUpdate.startDrag({
        width: config.width,
        height: config.height,
      })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).width = newWidth
      ;(selectedTimelineItem.value.config as any).height = newHeight
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe) {
        ;(keyframe.properties as any).width = newWidth
        ;(keyframe.properties as any).height = newHeight
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      const props = deferredUpdate.dragState.value.createdKeyframe!.properties as any
      if ('width' in props) props.width = newWidth
      if ('height' in props) props.height = newHeight
    }

    // 记录当前值（两个属性）
    deferredUpdate.updateDuringDrag('width', newWidth)
    deferredUpdate.updateDuringDrag('height', newHeight)
  }

  /**
   * 设置X缩放绝对值的方法（延迟更新 - 用于 SliderInput @input）
   */
  const setScaleXDeferred = (value: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config
    // 使用统一的获取原始尺寸方法
    const { width: originalWidth } = getOriginalDimensions()
    const newScaleX = Math.max(0.01, Math.min(5, value))
    const newWidth = originalWidth * newScaleX

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      // 第一次 @input，记录初始值并开始拖动
      deferredUpdate.startDrag({ width: config.width })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      // 无动画：直接修改 config
      ;(selectedTimelineItem.value.config as any).width = newWidth
    } else if (buttonState === 'on-keyframe') {
      // 在关键帧上：修改关键帧的值
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe) {
        ;(keyframe.properties as any).width = newWidth
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      // 关键帧之间：修改新创建的关键帧
      ;(deferredUpdate.dragState.value.createdKeyframe.properties as any).width = newWidth
    }

    // 记录当前值并更新状态
    deferredUpdate.updateDuringDrag('width', newWidth)
  }

  /**
   * 设置Y缩放绝对值的方法（延迟更新 - 用于 SliderInput @input）
   */
  const setScaleYDeferred = (value: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config
    // 使用统一的获取原始尺寸方法
    const { height: originalHeight } = getOriginalDimensions()
    const newScaleY = Math.max(0.01, Math.min(5, value))
    const newHeight = originalHeight * newScaleY

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      deferredUpdate.startDrag({ height: config.height })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).height = newHeight
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe) {
        ;(keyframe.properties as any).height = newHeight
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      ;(deferredUpdate.dragState.value.createdKeyframe.properties as any).height = newHeight
    }

    deferredUpdate.updateDuringDrag('height', newHeight)
  }

  /**
   * 设置旋转绝对值的方法（输入角度）
   */
  const setRotationDeferred = (value: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    const newRotation = normalizeAngle(value)  // ✅ 标准化角度

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      deferredUpdate.startDrag({ rotation: config.rotation })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).rotation = newRotation
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe && 'rotation' in keyframe.properties) {
        ;(keyframe.properties as any).rotation = newRotation
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      if ('rotation' in deferredUpdate.dragState.value.createdKeyframe!.properties) {
        ;(deferredUpdate.dragState.value.createdKeyframe.properties as any).rotation = newRotation
      }
    }

    deferredUpdate.updateDuringDrag('rotation', newRotation)
  }

  /**
   * 设置透明度绝对值的方法
   */
  const setOpacityDeferred = (value: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    const newOpacity = Math.max(0, Math.min(1, value))

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      deferredUpdate.startDrag({ opacity: config.opacity })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).opacity = newOpacity
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe && 'opacity' in keyframe.properties) {
        ;(keyframe.properties as any).opacity = newOpacity
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      if ('opacity' in deferredUpdate.dragState.value.createdKeyframe!.properties) {
        ;(deferredUpdate.dragState.value.createdKeyframe.properties as any).opacity = newOpacity
      }
    }

    deferredUpdate.updateDuringDrag('opacity', newOpacity)
  }

  /**
   * 设置位置坐标的方法（延迟更新 - 用于拖拽操作）
   * 同时更新 x 和 y，类似等比缩放的批量更新模式
   */
  const setTransformPositionDeferred = (x: number, y: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
    const newX = x
    const newY = y

    // 检查是否第一次 @input（拖动开始）
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      // 同时记录 x 和 y 的初始值
      deferredUpdate.startDrag({
        x: config.x,
        y: config.y,
      })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).x = newX
      ;(selectedTimelineItem.value.config as any).y = newY
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe) {
        if ('x' in keyframe.properties) {
          ;(keyframe.properties as any).x = newX
        }
        if ('y' in keyframe.properties) {
          ;(keyframe.properties as any).y = newY
        }
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      const keyframe = deferredUpdate.dragState.value.createdKeyframe!
      if ('x' in keyframe.properties) {
        ;(keyframe.properties as any).x = newX
      }
      if ('y' in keyframe.properties) {
        ;(keyframe.properties as any).y = newY
      }
    }

    // 同时更新 x 和 y 的待提交值
    deferredUpdate.updateDuringDrag('x', newX)
    deferredUpdate.updateDuringDrag('y', newY)
  }

  /**
   * 设置尺寸的延迟更新方法（用于拖拽缩放）
   * 同时更新 width 和 height，支持等比缩放
   */
  const setTransformSizeDeferred = (width: number, height: number, x?: number, y?: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config

    // 应用最小尺寸限制
    const MIN_SIZE = 10
    const newWidth = Math.max(MIN_SIZE, width)
    const newHeight = Math.max(MIN_SIZE, height)

    // 检查是否第一次拖动
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      // 记录初始值
      const initialValues: Record<string, any> = {
        width: config.width,
        height: config.height,
      }
      if (x !== undefined) initialValues.x = config.x
      if (y !== undefined) initialValues.y = config.y
      deferredUpdate.startDrag(initialValues)
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).width = newWidth
      ;(selectedTimelineItem.value.config as any).height = newHeight
      if (x !== undefined) (selectedTimelineItem.value.config as any).x = x
      if (y !== undefined) (selectedTimelineItem.value.config as any).y = y
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe) {
        ;(keyframe.properties as any).width = newWidth
        ;(keyframe.properties as any).height = newHeight
        if (x !== undefined && 'x' in keyframe.properties) {
          ;(keyframe.properties as any).x = x
        }
        if (y !== undefined && 'y' in keyframe.properties) {
          ;(keyframe.properties as any).y = y
        }
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      const props = deferredUpdate.dragState.value.createdKeyframe!.properties as any
      if ('width' in props) props.width = newWidth
      if ('height' in props) props.height = newHeight
      if (x !== undefined && 'x' in props) props.x = x
      if (y !== undefined && 'y' in props) props.y = y
    }

    // 记录当前值并更新状态
    deferredUpdate.updateDuringDrag('width', newWidth)
    deferredUpdate.updateDuringDrag('height', newHeight)
    if (x !== undefined) deferredUpdate.updateDuringDrag('x', x)
    if (y !== undefined) deferredUpdate.updateDuringDrag('y', y)
  }

  /**
   * 设置旋转角度的延迟更新方法（用于拖拽旋转）
   * 输入角度值
   */
  const setTransformRotationDeferred = (rotationDegrees: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)

    // 标准化角度到 -180° 到 180°
    const normalizedRotation = normalizeAngle(rotationDegrees)

    // 检查是否第一次拖动
    const isFirstInput = deferredUpdate.dragState.value.pendingUpdates.size === 0

    if (isFirstInput) {
      deferredUpdate.startDrag({ rotation: config.rotation })
    }

    // 拖动中：直接修改关键帧或 config
    const buttonState = getKeyframeButtonState(selectedTimelineItem.value, currentFrame.value)

    if (buttonState === 'none') {
      ;(selectedTimelineItem.value.config as any).rotation = normalizedRotation
    } else if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(selectedTimelineItem.value, currentFrame.value)
      if (keyframe && 'rotation' in keyframe.properties) {
        ;(keyframe.properties as any).rotation = normalizedRotation
      }
    } else if (buttonState === 'between-keyframes' && deferredUpdate.dragState.value.createdKeyframe) {
      const props = deferredUpdate.dragState.value.createdKeyframe!.properties as any
      if ('rotation' in props) {
        props.rotation = normalizedRotation
      }
    }

    deferredUpdate.updateDuringDrag('rotation', normalizedRotation)
  }

  /**
   * 角度标准化工具函数
   */
  function normalizeAngle(degrees: number): number {
    // 标准化到 -180° 到 180°
    let normalized = degrees % 360
    if (normalized > 180) {
      normalized -= 360
    } else if (normalized < -180) {
      normalized += 360
    }
    return normalized
  }

  /**
   * 提交延迟更新（由 SliderInput @change 触发）
   * 创建历史记录并清理拖动状态
   */
  const commitDeferredUpdates = async () => {
    console.log('🚠️ [useKeyframeTransformControls] commitDeferredUpdates 被调用')
    await deferredUpdate.commitDrag(async (updates) => {
      // 如果只有一个属性，使用单属性更新
      const entries = Object.entries(updates)
      if (entries.length === 1) {
        const [property, value] = entries[0]
        await unifiedStore.updatePropertyWithHistory(
          selectedTimelineItem.value!.id,
          currentFrame.value,
          property,
          value
        )
      } else {
        // 多个属性（如等比缩放的 width + height），使用批量更新
        await updateUnifiedPropertyBatch(updates)
      }
    })
  }

  /**
   * 设置音量绝对值的方法（支持关键帧）
   */
  const setVolume = (value: number) => {
    const newVolume = Math.max(0, Math.min(1, value))
    updateTransform({ volume: newVolume })
  }

  // 注意：toggleMute 不需要添加到这里，保持在组件中独立处理

  // ==================== 对齐控制方法 ====================

  /**
   * 实现对齐功能（基于项目坐标系：中心为原点）
   */
  const alignHorizontal = (alignment: 'left' | 'center' | 'right') => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config
    const canvasWidth = unifiedStore.videoResolution.width
    const elementWidth = config.width

    try {
      let newProjectX = 0
      switch (alignment) {
        case 'left':
          // 左对齐：元素左边缘贴画布左边缘
          newProjectX = -canvasWidth / 2 + elementWidth / 2
          break
        case 'center':
          // 居中：元素中心对齐画布中心
          newProjectX = 0
          break
        case 'right':
          // 右对齐：元素右边缘贴画布右边缘
          newProjectX = canvasWidth / 2 - elementWidth / 2
          break
      }

      updateTransform({ x: Math.round(newProjectX) })

      console.log('✅ 水平对齐完成:', alignment, '项目坐标X:', Math.round(newProjectX))
    } catch (error) {
      console.error('水平对齐失败:', error)
    }
  }

  const alignVertical = (alignment: 'top' | 'middle' | 'bottom') => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const config = selectedTimelineItem.value.config
    const canvasHeight = unifiedStore.videoResolution.height
    const elementHeight = config.height

    try {
      let newProjectY = 0
      switch (alignment) {
        case 'top':
          // 顶对齐：元素上边缘贴画布上边缘
          newProjectY = -canvasHeight / 2 + elementHeight / 2
          break
        case 'middle':
          // 居中：元素中心对齐画布中心
          newProjectY = 0
          break
        case 'bottom':
          // 底对齐：元素下边缘贴画布下边缘
          newProjectY = canvasHeight / 2 - elementHeight / 2
          break
      }

      updateTransform({ y: Math.round(newProjectY) })

      console.log('✅ 垂直对齐完成:', alignment, '项目坐标Y:', Math.round(newProjectY))
    } catch (error) {
      console.error('垂直对齐失败:', error)
    }
  }

  // ==================== 直接更新方法（用于 NumberInput） ====================
  // 这些方法直接记录历史，不使用延迟更新机制

  /**
   * 直接设置宽度（用于 NumberInput）
   * 接收比例值，转换为实际宽度后记录历史
   */
  const setScaleXDirectly = async (scale: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    // 使用统一的获取原始尺寸方法
    const { width: originalWidth } = getOriginalDimensions()
    const clampedScale = Math.max(0.01, Math.min(5, scale))
    const newWidth = originalWidth * clampedScale

    await unifiedStore.updatePropertyWithHistory(
      selectedTimelineItem.value.id,
      currentFrame.value,
      'width',
      newWidth
    )
  }

  /**
   * 直接设置高度（用于 NumberInput）
   * 接收比例值，转换为实际高度后记录历史
   */
  const setScaleYDirectly = async (scale: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    // 使用统一的获取原始尺寸方法
    const { height: originalHeight } = getOriginalDimensions()
    const clampedScale = Math.max(0.01, Math.min(5, scale))
    const newHeight = originalHeight * clampedScale

    await unifiedStore.updatePropertyWithHistory(
      selectedTimelineItem.value.id,
      currentFrame.value,
      'height',
      newHeight
    )
  }

  /**
   * 直接设置旋转（用于 NumberInput）
   * 接收角度值，标准化后记录历史
   */
  const setRotationDirectly = async (degrees: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const newRotation = normalizeAngle(degrees)  // ✅ 标准化角度

    await unifiedStore.updatePropertyWithHistory(
      selectedTimelineItem.value.id,
      currentFrame.value,
      'rotation',
      newRotation
    )
  }

  /**
   * 直接设置透明度（用于 NumberInput）
   */
  const setOpacityDirectly = async (value: number) => {
    if (
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    const newOpacity = Math.max(0, Math.min(1, value))

    await unifiedStore.updatePropertyWithHistory(
      selectedTimelineItem.value.id,
      currentFrame.value,
      'opacity',
      newOpacity
    )
  }

  /**
   * 直接设置等比缩放（用于 NumberInput）
   * 接收比例值，同时设置宽度和高度
   */
  const updateUniformScaleDirectly = async (scale: number) => {
    if (
      !proportionalScale.value ||
      !selectedTimelineItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)
    )
      return

    // 使用统一的获取原始尺寸方法
    const { width: originalWidth, height: originalHeight } = getOriginalDimensions()
    const clampedScale = Math.max(0.01, Math.min(5, scale))
    const newWidth = originalWidth * clampedScale
    const newHeight = originalHeight * clampedScale

    // 使用批量更新，确保 width 和 height 在一个历史记录中
    await updateUnifiedPropertyBatch({
      width: newWidth,
      height: newHeight,
    })
  }

  /**
   * 直接设置 X 坐标（用于 NumberInput）
   */
  const setTransformXDirectly = async (x: number) => {
    await updateTransform({ x })
  }

  /**
   * 直接设置 Y 坐标（用于 NumberInput）
   */
  const setTransformYDirectly = async (y: number) => {
    await updateTransform({ y })
  }

  return {
    // ✅ 保留：关键帧UI状态
    buttonState: readonly(buttonState),
    keyframeUIState: readonly(keyframeUIState),
    hasPreviousKeyframe: readonly(hasPreviousKeyframe),
    hasNextKeyframe: readonly(hasNextKeyframe),
    isPlayheadInClip: readonly(isPlayheadInClip),
    canOperateKeyframes: readonly(canOperateKeyframes),

    // ✅ 保留：变换属性
    transformX,
    transformY,
    scaleX,
    scaleY,
    rotation,
    opacity,
    volume,
    proportionalScale,
    uniformScale,
    elementWidth,
    elementHeight,

    // ✅ 保留：变换操作状态（canOperateTransforms 是 canOperateKeyframes 的别名）
    canOperateTransforms: readonly(canOperateKeyframes),

    // ✅ 保留：内部方法（不导出）
    updateTransform,
    updateUnifiedPropertyBatch,

    toggleProportionalScale,

    // ✨ 延迟更新方法（用于 SliderInput @input + @change）
    updateUniformScaleDeferred,
    setScaleXDeferred,
    setScaleYDeferred,
    setRotationDeferred,
    setOpacityDeferred,
    setTransformPositionDeferred,
    setTransformSizeDeferred,
    setTransformRotationDeferred,
    commitDeferredUpdates,

    // ✨ 直接更新方法（用于 NumberInput @change）
    setTransformXDirectly,
    setTransformYDirectly,
    setScaleXDirectly,
    setScaleYDirectly,
    setRotationDirectly,
    setOpacityDirectly,
    updateUniformScaleDirectly,

    setVolume,
    alignHorizontal,
    alignVertical,

    // ✅ 保留：辅助方法
    getUnifiedKeyframeTooltip,
    debugUnifiedKeyframes,
  }
}
