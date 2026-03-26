/**
 * 延迟属性更新工具
 * 用于滑块拖动优化：拖动过程中直接修改属性（不记录历史），拖动结束时统一记录历史
 */

import { ref, type Ref } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  createChannelKeyframe,
  findKeyframeAtFrame,
  sortKeyframes,
  getKeyframeButtonState,
} from '@/core/utils/unifiedKeyframeUtils'
import type { AnimateKeyframe, AnimationChannelKey } from '@/core/timelineitem/bunnytype'
import type { MediaType } from '@/core/mediaitem'
import type { KeyframeButtonState } from '@/core/timelineitem/animationtypes'
import { getAnimationChannelForProperty } from '@/core/timelineitem/bunnytype'

type DeferredChannelEntry = {
  keyframes: AnimateKeyframe<MediaType, AnimationChannelKey>[]
}
type DeferredChannelMap = Partial<Record<AnimationChannelKey, DeferredChannelEntry>>
type DeferredMutableConfig = Record<string, unknown>
type DeferredMutableProperties = Record<string, unknown>

interface DragState {
  isDragging: boolean
  initialValues: Map<string, unknown> // property -> initial value
  pendingUpdates: Map<string, unknown> // property -> current value
  createdKeyframe: AnimateKeyframe<MediaType, AnimationChannelKey> | null // 关键帧之间拖动时创建的关键帧
  initialButtonState: KeyframeButtonState | null // 拖动开始时的动画状态（用于判断是否需要删除临时关键帧）
  channel: AnimationChannelKey | null
}

interface DeferredUpdateOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

/**
 * 延迟属性更新 Composable
 *
 * 使用场景：滑块拖动优化
 * - 拖动开始（第一次 @input）：记录初始值，必要时创建关键帧
 * - 拖动中（后续 @input）：直接修改属性，不记录历史
 * - 拖动结束（@change）：创建历史记录
 */
export function useDeferredPropertyUpdate(options: DeferredUpdateOptions) {
  const { selectedTimelineItem, currentFrame } = options

  const dragState = ref<DragState>({
    isDragging: false,
    initialValues: new Map(),
    pendingUpdates: new Map(),
    createdKeyframe: null,
    initialButtonState: null,
    channel: null,
  })

  const setConfigProperty = (
    item: UnifiedTimelineItemData,
    property: string,
    value: unknown,
  ) => {
    const config = (item.config as unknown) as DeferredMutableConfig
    if (!(property in config)) return
    config[property] = value
  }

  const setKeyframeProperty = (
    keyframe: AnimateKeyframe<MediaType, AnimationChannelKey>,
    property: string,
    value: unknown,
  ) => {
    const properties = (keyframe.properties as unknown) as DeferredMutableProperties
    if (!(property in properties)) return
    properties[property] = value
  }

  /**
   * 开始拖拽 - 由第一次 @input 触发
   * @param properties 属性-初始值对象（如 { width: 100, height: 200 } 或 { rotation: 45 }）
   *
   * 使用示例：
   * - 单个属性：startDrag({ rotation: config.rotation })
   * - 多个属性：startDrag({ width: config.width, height: config.height })
   */
  const startDrag = (properties: Record<string, unknown>) => {
    const item = selectedTimelineItem.value
    if (!item) return

    const propertyNames = Object.keys(properties)
    const channel = getAnimationChannelForProperty(propertyNames[0] || '')
    if (!channel) return

    const buttonState = getKeyframeButtonState(item, currentFrame.value, channel)
    dragState.value.isDragging = true
    dragState.value.initialButtonState = buttonState
    dragState.value.channel = channel

    // 记录所有属性的初始值
    for (const [prop, value] of Object.entries(properties)) {
      dragState.value.initialValues.set(prop, value)
    }

    console.log('🎯 [Deferred Update] 拖拽开始:', {
      properties: Object.keys(properties),
      buttonState,
    })

    // 如果在关键帧之间，立即创建新关键帧（使用传入的初始值）
    if (buttonState === 'between-keyframes') {
      item.animation ??= { channels: {} } as UnifiedTimelineItemData['animation']
      const channels = item.animation!.channels as DeferredChannelMap
      if (!channels[channel]) {
        channels[channel] = { keyframes: [] }
      }
      const keyframe = createChannelKeyframe(item, currentFrame.value, channel)
      channels[channel].keyframes.push(keyframe)
      sortKeyframes(item, channel)
      dragState.value.createdKeyframe = keyframe

      console.log('🎯 [Deferred Update] 创建临时关键帧:', {
        keyframePosition: keyframe.cachedFrame,
        propertiesCount: dragState.value.initialValues.size,
      })
    }
  }

  /**
   * 拖拽中更新 - 由后续 @input 触发
   * 直接修改关键帧或 config（无历史记录）
   * @param property 属性名
   * @param value 新值
   */
  const updateDuringDrag = (property: string, value: unknown) => {
    const item = selectedTimelineItem.value
    if (!item || !dragState.value.isDragging) return

    const channel = dragState.value.channel
    if (!channel) return

    const buttonState = getKeyframeButtonState(item, currentFrame.value, channel)

    if (buttonState === 'none') {
      // 无动画：直接修改 config
      setConfigProperty(item, property, value)
    } else if (buttonState === 'on-keyframe') {
      // 在关键帧上：修改关键帧的值
      const keyframe = findKeyframeAtFrame(item, currentFrame.value, channel)
      if (keyframe && property in keyframe.properties) {
        setKeyframeProperty(keyframe, property, value)
      }
    } else if (buttonState === 'between-keyframes' && dragState.value.createdKeyframe) {
      // 关键帧之间：修改新创建的关键帧
      if (property in dragState.value.createdKeyframe.properties) {
        setKeyframeProperty(dragState.value.createdKeyframe, property, value)
      }
    }

    // 记录当前值用于提交
    dragState.value.pendingUpdates.set(property, value)

    console.log('🎯 [Deferred Update] 拖拽中更新:', {
      property,
      value,
      buttonState,
    })
  }

  /**
   * 拖拽结束 - 由 @change 触发
   * 提交历史记录并清理状态
   * @param onCommit 提交回调，接收所有属性的更新对象
   */
  const commitDrag = async (onCommit: (updates: Record<string, unknown>) => Promise<void>) => {
    console.log('🔍 [Deferred Update] commitDrag 被调用')
    console.log('  - isDragging:', dragState.value.isDragging)
    console.log('  - createdKeyframe:', dragState.value.createdKeyframe)
    console.log('  - initialButtonState:', dragState.value.initialButtonState)
    console.log('  - pendingUpdates:', dragState.value.pendingUpdates)

    if (!dragState.value.isDragging) return

    const item = selectedTimelineItem.value
    if (!item) return

    // 使用保存的初始动画状态（而不是重新获取）
    const buttonState = dragState.value.initialButtonState
    console.log('📊 [Deferred Update] 使用初始动画状态:', buttonState)

    // 保存最终值
    const updates: Record<string, unknown> = {}
    for (const [property, value] of dragState.value.pendingUpdates) {
      updates[property] = value
    }

    // 🔧 关键修复：在创建历史记录之前，先恢复 config/关键帧 到初始值
    // 这样 UpdatePropertyCommand 创建的 before 快照才会是正确的初始值
    if (buttonState === 'none') {
      // 无动画：恢复 config 到初始值
      for (const [property, initialValue] of dragState.value.initialValues) {
        setConfigProperty(item, property, initialValue)
      }
    } else if (buttonState === 'on-keyframe') {
      // 在关键帧上：恢复关键帧属性到初始值
      const channel = dragState.value.channel
      if (!channel) return
      const keyframe = findKeyframeAtFrame(item, currentFrame.value, channel)
      if (keyframe) {
        for (const [property, initialValue] of dragState.value.initialValues) {
          if (property in keyframe.properties) {
            setKeyframeProperty(keyframe, property, initialValue)
          }
        }
      }
    } else if (buttonState === 'between-keyframes' && dragState.value.createdKeyframe) {
      console.log('🎯 [Deferred Update] 准备删除临时关键帧...')
      // 🔧 关键帧之间：删除临时创建的关键帧，恢复到拖动前的状态
      const channel = dragState.value.channel
      if (!channel) return
      const keyframes = (item.animation?.channels as DeferredChannelMap)?.[channel]?.keyframes ?? []
      const index = keyframes.indexOf(dragState.value.createdKeyframe)
      console.log('  - 关键帧索引:', index)
      console.log('  - 删除前关键帧数:', keyframes.length)
      if (index !== -1) {
        keyframes.splice(index, 1)
        console.log('🗑️ [Deferred Update] 删除临时关键帧，剩余关键帧数:', keyframes.length)
      } else {
        console.log('❌ [Deferred Update] 未找到临时关键帧！')
      }

      // 验证删除后的状态
      const stateAfterDelete = getKeyframeButtonState(item, currentFrame.value, channel)
      console.log('📊 [Deferred Update] 删除后状态:', stateAfterDelete)
    } else {
      console.log('⚠️ [Deferred Update] 未知状态，createdKeyframe:', dragState.value.createdKeyframe)
    }

    // 重置拖拽状态
    dragState.value.isDragging = false
    dragState.value.createdKeyframe = null
    dragState.value.initialButtonState = null
    dragState.value.channel = null
    dragState.value.initialValues.clear()
    dragState.value.pendingUpdates.clear()

    // 提交历史记录（一次性提交所有更新，创建一条历史记录）
    await onCommit(updates)

    console.log('✅ [Deferred Update] 拖拽结束，已提交历史记录:', updates)
  }

  return {
    dragState,
    startDrag,
    updateDuringDrag,
    commitDrag,
  }
}
