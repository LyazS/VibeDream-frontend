<template>
  <div
    :class="clipClasses"
    :style="combinedStyles"
    :data-media-type="data.mediaType"
    :data-timeline-item-id="data.id"
    :data-timeline-status="data.timelineStatus"
    draggable="true"
    @click="handleSelect"
    @dblclick="handleDoubleClick"
    @contextmenu="handleContextMenu"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <div v-if="hasEffectWarning" class="clip-effect-warning">
      <component :is="IconComponents.WARNING" size="12px" />
    </div>

    <!-- 左侧调整把手 -->
    <div
      v-if="data.timelineStatus === 'ready' && isSelected && !isMultiSelected"
      class="resize-handle resize-handle-left"
      @mousedown.stop="handleResizeStart('left', $event)"
    ></div>

    <!-- 素材名称显示 -->
    <div class="clip-name-overlay" v-if="mediaItemName">
      {{ mediaItemName }}
    </div>

    <!-- 动态渲染的内容区域（使用模板组件） -->
    <div class="clip-content">
      <component :is="templateComponent" v-bind="templateProps" />
    </div>

    <!-- 右侧调整把手 -->
    <div
      v-if="data.timelineStatus === 'ready' && isSelected && !isMultiSelected"
      class="resize-handle resize-handle-right"
      @mousedown.stop="handleResizeStart('right', $event)"
    ></div>

    <!-- 关键帧标记容器 -->
    <div v-if="hasKeyframes" class="keyframes-container">
      <div
        v-for="keyframe in visibleKeyframes"
        :key="keyframe.cachedFrame"
        class="keyframe-marker"
        :style="getKeyframeMarkerStyles(keyframe.pixelPosition)"
        :title="t('timeline.clip.keyframeTooltip', { frame: keyframe.absoluteFrame })"
        @click.stop="jumpToKeyframe(keyframe.absoluteFrame)"
      >
        <div class="keyframe-diamond"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import {
  createClipRenderFrame,
  type ContentTemplateProps,
  type UnifiedTimelineClipProps,
} from '@/core/types/clipRenderer'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type { TrimTimelineItemSide } from '@/core/modules/commands/timelineCommands'
import { ContentRendererFactory } from '@/components/cliprenderers/ContentRendererFactory'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { SnapResultState } from '@/core/composables/useTimelineSnap'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { alignFramesToFrame } from '@/core/utils/timeUtils'
import {
  getVisibleKeyframesForTimeline,
  relativeFrameToAbsoluteFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import { DEFAULT_TRACK_PADDING } from '@/constants/TrackConstants'
import { IconComponents } from '@/constants/iconComponents'
import { getDefaultTrackHeight, mapMediaTypeToTrackType } from '@/core/track/TrackUtils'
import { DragSourceType, type TimelineItemDragParams } from '@/core/types/drag'
import { buildClipSelectionId } from '@/core/types/timelineSelection'

// ==================== 组件定义 ====================

// 定义组件属性
const props = defineProps<UnifiedTimelineClipProps>()

// 获取统一store实例
const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 获取素材名称
const mediaItemName = computed(() => {
  const mediaItem = unifiedStore.getMediaItem(props.data.mediaItemId)
  return mediaItem?.name || ''
})

// Resize状态管理变量
const isResizing = ref(false)
const resizeDirection = ref<'left' | 'right' | null>(null)
const resizeStartX = ref(0)
const resizeStartDurationFrames = ref(0)
const resizeStartPositionFrames = ref(0)
const tempDurationFrames = ref(0)
const tempResizePositionFrames = ref(0)

// 拖拽状态
const isDragging = ref(false)

const timelineEdgeEditMode = computed(() => unifiedStore.timelineEdgeEditMode)

const hasEffectWarning = computed(() => {
  const transitionPackageId = TimelineItemQueries.getBaseTransition(props.data)?.effectPackageId
  if (transitionPackageId && effectTemplateRegistry.getPackageState(transitionPackageId)?.status !== 'ready') {
    return true
  }

  const filterPackageId = props.data.exRenderConfig?.filter?.effectPackageId
  return Boolean(
    filterPackageId && effectTemplateRegistry.getPackageState(filterPackageId)?.status !== 'ready',
  )
})

// 定义组件事件
const emit = defineEmits<{
  select: [event: MouseEvent, id: string]
  doubleClick: [id: string]
  contextMenu: [event: MouseEvent, id: string]
  resizeStart: [event: MouseEvent, id: string, direction: 'left' | 'right']
  updateSnapResult: [snapResult: SnapResultState | null]
}>()

// ==================== 计算属性 ====================

/**
 * 构建模板组件的props
 */
const templateProps = computed<ContentTemplateProps>(() => ({
  data: props.data,
  isSelected: props.isSelected,
  isMultiSelected: props.isMultiSelected,
  trackHeight: props.trackHeight,
  timelineWidth: props.timelineWidth,
  viewportFrameRange: props.viewportFrameRange,
  renderFrame: isResizing.value ? clipRenderFrame.value : undefined,
}))

/**
 * 动态选择模板组件
 */
const templateComponent = computed(() => {
  return ContentRendererFactory.getTemplateComponent(props.data)
})

/**
 * 动态样式类
 */
const clipClasses = computed(() => {
  const baseClasses = [
    'unified-timeline-clip',
    `media-type-${props.data.mediaType}`,
    `status-${props.data.timelineStatus}`,
    {
      selected: props.isSelected,
      dragging: isDragging.value, // 新增：拖拽状态
      resizing: isResizing.value,
    },
  ]

  return baseClasses
})

/**
 * 合并样式（包含位置尺寸和剪辑样式）
 */
const combinedStyles = computed(() => {
  // 计算clip的高度和上边距
  const trackType = mapMediaTypeToTrackType(props.data.mediaType)
  const clipHeight = getDefaultTrackHeight(trackType) - DEFAULT_TRACK_PADDING * 2
  const clipTopOffset = DEFAULT_TRACK_PADDING

  // 计算clip的位置和尺寸
  const timeRange = props.data.timeRange

  // 在调整大小时使用临时值，否则使用实际值（帧数）
  const positionFrames = isResizing.value
    ? tempResizePositionFrames.value
    : timeRange.timelineStartTime
  const durationFrames = isResizing.value
    ? tempDurationFrames.value
    : timeRange.timelineEndTime - timeRange.timelineStartTime

  // 使用统一store的坐标转换方法
  const left = unifiedStore.frameToPixel(positionFrames, props.timelineWidth)
  const endFrames = positionFrames + durationFrames
  const right = unifiedStore.frameToPixel(endFrames, props.timelineWidth)
  const width = Math.max(right - left, 20) // 最小宽度20px

  return {
    height: `${clipHeight}px`,
    top: `${clipTopOffset}px`,
    left: `${left}px`,
    width: `${width}px`,
  }
})

const previewTimeRange = computed<UnifiedTimeRange>(() => {
  const timeRange = props.data.timeRange
  if (!isResizing.value) {
    return timeRange
  }

  const preview: UnifiedTimeRange = {
    ...timeRange,
    timelineStartTime: tempResizePositionFrames.value,
    timelineEndTime: tempResizePositionFrames.value + tempDurationFrames.value,
  }

  const timelineDuration = timeRange.timelineEndTime - timeRange.timelineStartTime
  const sourceDuration = timeRange.clipEndTime - timeRange.clipStartTime
  if (
    timelineEdgeEditMode.value === 'trim' &&
    (props.data.mediaType === 'video' || props.data.mediaType === 'audio') &&
    timelineDuration > 0
  ) {
    const playbackRate = sourceDuration / timelineDuration
    if (resizeDirection.value === 'left') {
      preview.clipStartTime =
        timeRange.clipStartTime +
        Math.round((preview.timelineStartTime - timeRange.timelineStartTime) * playbackRate)
    } else if (resizeDirection.value === 'right') {
      preview.clipEndTime =
        timeRange.clipEndTime +
        Math.round((preview.timelineEndTime - timeRange.timelineEndTime) * playbackRate)
    }
  }

  return preview
})

const clipRenderWidthPixels = computed(() => {
  const timeRange = previewTimeRange.value
  const left = unifiedStore.frameToPixel(timeRange.timelineStartTime, props.timelineWidth)
  const right = unifiedStore.frameToPixel(timeRange.timelineEndTime, props.timelineWidth)
  return Math.max(right - left, 20)
})

const clipRenderFrame = computed(() =>
  createClipRenderFrame(previewTimeRange.value, clipRenderWidthPixels.value),
)

// ==================== 关键帧标记相关计算属性 ====================

/**
 * 检查是否有关键帧
 */
const hasKeyframes = computed(() => {
  return getVisibleKeyframesForTimeline(props.data).length > 0
})

/**
 * 计算可见的关键帧
 */
const visibleKeyframes = computed(() => {
  if (!hasKeyframes.value) return []

  const keyframes = getVisibleKeyframesForTimeline(props.data)
  const renderFrame = clipRenderFrame.value
  const timeRange = renderFrame.timeRange
  const clipWidth = renderFrame.widthPixels

  return keyframes
    .map((keyframe) => {
      // ✅ 直接使用 cachedFrame
      const absoluteFrame = relativeFrameToAbsoluteFrame(keyframe.cachedFrame, props.data.timeRange)

      // 关键帧标记应该使用原绝对帧到当前 renderFrame 的局部坐标。
      const relativePixelPosition = renderFrame.frameToLocalPixel(absoluteFrame)

      return {
        cachedFrame: keyframe.cachedFrame,
        absoluteFrame,
        pixelPosition: relativePixelPosition,
        percentage: keyframe.position,  // 可用于显示百分比信息
        isVisible: relativePixelPosition >= 0 && relativePixelPosition <= clipWidth,
      }
    })
    .filter((kf) => kf.isVisible)
})

/**
 * 获取关键帧标记样式
 */
function getKeyframeMarkerStyles(pixelPosition: number): Record<string, string> {
  // 根据媒体类型使用不同的偏移量
  let offset = -6.5 // 视频/图片/音频的默认偏移
  if (props.data.mediaType === 'text') {
    offset = -6.5 // 文本的偏移量与旧架构保持一致
  }

  return {
    left: `${pixelPosition + offset}px`,
  }
}

// ==================== 事件处理 ====================

/**
 * 处理选中事件
 */
function handleSelect(event: MouseEvent) {
  event.stopPropagation()
  emit('select', event, props.data.id)
}

/**
 * 处理双击事件
 */
function handleDoubleClick(event: MouseEvent) {
  event.stopPropagation()
  emit('doubleClick', props.data.id)
}

/**
 * 处理右键菜单事件
 */
function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextMenu', event, props.data.id)
}

/**
 * 处理拖拽开始事件（新架构）
 */
function handleDragStart(event: DragEvent) {
  console.log('🎯 [CleanTimelineClip] dragstart事件触发:', props.data.id)

  // 1. 检查是否应该启动拖拽
  if (event.ctrlKey) {
    console.log('🚫 [CleanTimelineClip] Ctrl+拖拽被禁用')
    event.preventDefault()
    return
  }

  // 2. 检查是否有多个项目被选中，如果是则禁止拖拽
  if (unifiedStore.selectedTimelineSelectionIds.size > 1) {
    console.log('🚫 [CleanTimelineClip] 多选状态下禁止拖拽')
    unifiedStore.messageWarning(t('timeline.clip.multiSelectDragWarning'))
    event.preventDefault()
    return
  }

  // 3. 暂停播放
  unifiedStore.pause()

  // 4. 确保项目被选中
  const selectionId = buildClipSelectionId(props.data.id)
  if (!unifiedStore.selectedTimelineSelectionIds.has(selectionId)) {
    unifiedStore.selectTimelineSelection(selectionId)
  }

  // 5. 获取 TimelineItemSourceHandler（新架构）
  const sourceHandler = unifiedStore.getSourceHandler(DragSourceType.TIMELINE_ITEM)
  if (!sourceHandler) {
    console.error('❌ [CleanTimelineClip] 未找到 TimelineItemSourceHandler')
    event.preventDefault()
    return
  }

  // 6. 创建拖拽参数（新架构）
  const params: TimelineItemDragParams = {
    timelineItemId: props.data.id,
  }

  // 7. 获取当前元素
  const element = event.currentTarget as HTMLElement

  // 8. 调用处理器创建拖拽数据（新架构）
  try {
    const dragData = sourceHandler.createDragData(element, event, params)
    console.log('📦 [CleanTimelineClip] 创建拖拽数据:', dragData)

    // 9. 通过 unifiedStore 开始拖拽（新架构）
    unifiedStore.startDrag(event, dragData)

    // 10. 设置拖拽状态
    isDragging.value = true
  } catch (error) {
    console.error('❌ [CleanTimelineClip] 创建拖拽数据失败:', error)
    event.preventDefault()
  }
}

/**
 * 处理拖拽结束事件（新架构）
 */
function handleDragEnd(_event: DragEvent) {
  console.log('🏁 [CleanTimelineClip] 拖拽结束:', props.data.id)

  // 清理拖拽状态
  isDragging.value = false

  // 通过 unifiedStore 结束拖拽（新架构）
  unifiedStore.endDrag()
}

/**
 * 处理调整大小开始事件
 */
function handleResizeStart(direction: 'left' | 'right', event: MouseEvent) {
  console.log('🔧 [CleanTimelineClip] 开始调整大小:', direction, props.data.id)

  // 暂停播放以便进行编辑
  unifiedStore.pause()

  isResizing.value = true
  resizeDirection.value = direction
  resizeStartX.value = event.clientX

  const timeRange = props.data.timeRange

  // 使用帧数进行精确计算
  resizeStartDurationFrames.value = timeRange.timelineEndTime - timeRange.timelineStartTime
  resizeStartPositionFrames.value = timeRange.timelineStartTime

  // 初始化临时值
  tempDurationFrames.value = resizeStartDurationFrames.value
  tempResizePositionFrames.value = resizeStartPositionFrames.value

  // 开始拖拽阶段，收集候选目标（用于调整大小时的吸附）
  if (unifiedStore.snapConfig.enabled) {
    unifiedStore.startSnapDrag([props.data.id])
  }

  // 添加全局事件监听器
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)

  emit('resizeStart', event, props.data.id, direction)
  event.preventDefault()
}

/**
 * 处理调整大小过程中的鼠标移动事件
 */
function handleResize(event: MouseEvent) {
  if (!isResizing.value || !resizeDirection.value) return

  const deltaX = event.clientX - resizeStartX.value

  // 使用帧数进行精确计算
  let newDurationFrames = resizeStartDurationFrames.value
  let newTimelinePositionFrames = resizeStartPositionFrames.value

  if (resizeDirection.value === 'left') {
    // 拖拽左边把柄：调整开始时间和时长
    const currentLeftPixel = unifiedStore.frameToPixel(
      resizeStartPositionFrames.value,
      props.timelineWidth,
    )
    const newLeftPixel = currentLeftPixel + deltaX
    let newLeftFrames = unifiedStore.pixelToFrame(newLeftPixel, props.timelineWidth)
    newLeftFrames = Math.max(0, alignFramesToFrame(newLeftFrames))

    // 启用左边把柄吸附功能
    if (unifiedStore.snapConfig.enabled) {
      // 计算吸附位置
      const snapOptions = {
        excludeClipIds: [props.data.id],
        customThreshold: unifiedStore.snapConfig.threshold,
      }

      const snapResult = unifiedStore.calculateSnapPosition(newLeftFrames, snapOptions)
      if (snapResult) {
        newLeftFrames = snapResult.frame
        // 触发吸附指示器显示
        emit('updateSnapResult', {
          snapped: true,
          frame: snapResult.frame,
          snapPoint: snapResult.snapPoint,
          distance: snapResult.distance,
        })
      } else {
        // 清除吸附指示器
        emit('updateSnapResult', null)
      }
    } else {
      // 清除吸附指示器
      emit('updateSnapResult', null)
    }

    newTimelinePositionFrames = newLeftFrames
    newDurationFrames =
      resizeStartDurationFrames.value +
      (resizeStartPositionFrames.value - newTimelinePositionFrames)
  } else if (resizeDirection.value === 'right') {
    // 拖拽右边把柄：只调整时长
    const endFrames = resizeStartPositionFrames.value + resizeStartDurationFrames.value
    const currentRightPixel = unifiedStore.frameToPixel(endFrames, props.timelineWidth)
    const newRightPixel = currentRightPixel + deltaX
    let newRightFrames = unifiedStore.pixelToFrame(newRightPixel, props.timelineWidth)
    newRightFrames = alignFramesToFrame(newRightFrames)

    // 启用右边把柄吸附功能
    if (unifiedStore.snapConfig.enabled) {
      // 计算吸附位置
      const snapOptions = {
        excludeClipIds: [props.data.id],
        customThreshold: unifiedStore.snapConfig.threshold,
      }

      const snapResult = unifiedStore.calculateSnapPosition(newRightFrames, snapOptions)
      if (snapResult) {
        newRightFrames = snapResult.frame
        // 触发吸附指示器显示
        emit('updateSnapResult', {
          snapped: true,
          frame: snapResult.frame,
          snapPoint: snapResult.snapPoint,
          distance: snapResult.distance,
        })
      } else {
        // 清除吸附指示器
        emit('updateSnapResult', null)
      }
    } else {
      // 清除吸附指示器
      emit('updateSnapResult', null)
    }

    newDurationFrames = newRightFrames - resizeStartPositionFrames.value
  }

  if (timelineEdgeEditMode.value === 'trim') {
    const timeRange = props.data.timeRange
    const timelineDuration = timeRange.timelineEndTime - timeRange.timelineStartTime
    const sourceDuration = timeRange.clipEndTime - timeRange.clipStartTime

    if ((props.data.mediaType === 'video' || props.data.mediaType === 'audio') && timelineDuration > 0) {
      const playbackRate = sourceDuration / timelineDuration
      if (resizeDirection.value === 'left') {
        const minStartBySource = timeRange.timelineStartTime - timeRange.clipStartTime / playbackRate
        newTimelinePositionFrames = Math.max(newTimelinePositionFrames, Math.ceil(minStartBySource), 0)
        newTimelinePositionFrames = Math.min(
          newTimelinePositionFrames,
          timeRange.timelineEndTime - 1,
        )
        newDurationFrames = timeRange.timelineEndTime - newTimelinePositionFrames
      } else {
        const mediaItem = unifiedStore.getMediaItem(props.data.mediaItemId)
        if (typeof mediaItem?.duration === 'number' && Number.isFinite(mediaItem.duration)) {
          const maxEndBySource =
            timeRange.timelineEndTime + (mediaItem.duration - timeRange.clipEndTime) / playbackRate
          const nextEndFrames = Math.min(
            resizeStartPositionFrames.value + newDurationFrames,
            Math.floor(maxEndBySource),
          )
          newDurationFrames = nextEndFrames - resizeStartPositionFrames.value
        }
      }
    }
  }

  // 设置时长限制：最小1帧，用户可以自由调整时长
  const minDurationFrames = 1
  newDurationFrames = Math.max(minDurationFrames, newDurationFrames)

  // 更新临时值（帧数）
  tempDurationFrames.value = newDurationFrames
  tempResizePositionFrames.value = newTimelinePositionFrames
}

/**
 * 处理调整大小结束事件
 */
async function stopResize() {
  if (!isResizing.value) return

  console.log('🛑 [CleanTimelineClip] 停止调整大小')

  // 计算最终的时间范围
  const newTimelineStartTimeFrames = tempResizePositionFrames.value
  const newTimelineEndTimeFrames = tempResizePositionFrames.value + tempDurationFrames.value

  // 验证时间范围的有效性
  if (newTimelineStartTimeFrames < 0 || tempDurationFrames.value <= 0) {
    console.warn('⚠️ [CleanTimelineClip] 无效的时间范围，取消调整')
    cleanupResize()
    return
  }

  // 检查是否有实际的变化
  if (
    tempDurationFrames.value !== resizeStartDurationFrames.value ||
    tempResizePositionFrames.value !== resizeStartPositionFrames.value
  ) {
    console.log('🔧 [CleanTimelineClip] 调整大小 - 应用新的时间范围:', {
      itemId: props.data.id,
      newStartTime: newTimelineStartTimeFrames,
      newEndTime: newTimelineEndTimeFrames,
      direction: resizeDirection.value,
    })

    // 使用统一架构的resize命令来更新时间范围
    try {
      let success = false
      if (timelineEdgeEditMode.value === 'trim') {
        const side: TrimTimelineItemSide = resizeDirection.value === 'left' ? 'start' : 'end'
        const targetBoundaryFrame =
          side === 'start' ? newTimelineStartTimeFrames : newTimelineEndTimeFrames
        success = await unifiedStore.trimTimelineItemWithHistory(
          props.data.id,
          side,
          targetBoundaryFrame,
        )
      } else {
        const currentTimeRange = props.data.timeRange
        const newTimeRange: UnifiedTimeRange = {
          timelineStartTime: newTimelineStartTimeFrames,
          timelineEndTime: newTimelineEndTimeFrames,
          clipStartTime: currentTimeRange.clipStartTime,
          clipEndTime: currentTimeRange.clipEndTime,
        }

        success = await unifiedStore.resizeTimelineItemWithHistory(props.data.id, newTimeRange)
      }

      if (success) {
        console.log('✅ [CleanTimelineClip]', t('timeline.clip.resizeSuccess'))
      } else {
        console.error('❌ [CleanTimelineClip]', t('timeline.clip.resizeFailed'))
      }
    } catch (error) {
      console.error('❌ [CleanTimelineClip] 调整大小失败:', error)
    }
  }

  cleanupResize()
}

/**
 * 清理resize状态
 */
function cleanupResize() {
  // 清理resize状态
  isResizing.value = false
  const direction = resizeDirection.value
  resizeDirection.value = null
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)

  // 结束拖拽阶段，清理缓存
  if (unifiedStore.snapConfig.enabled) {
    unifiedStore.endSnapDrag()
    emit('updateSnapResult', null) // 清除吸附指示器
  }

  if (direction) {
    console.log('🏁 [CleanTimelineClip] resize结束:', direction)
  }
}

/**
 * 跳转到指定关键帧
 */
function jumpToKeyframe(absoluteFrame: number) {
  console.log('🎯 [CleanTimelineClip] 关键帧跳转:', {
    itemId: props.data.id,
    targetFrame: absoluteFrame,
  })

  // 暂停播放以便进行时间跳转
  unifiedStore.pause()

  // 使用统一接口进行时间跳转
  try {
    unifiedStore.seekToFrame(absoluteFrame)
  } catch (error) {
    console.error('❌ [CleanTimelineClip] 关键帧跳转失败:', error)
  }
}

// ==================== 生命周期 ====================

onUnmounted(() => {
  // 清理工作
})
</script>

<style scoped>
.clip-effect-warning {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 184, 77, 0.95);
  color: #2f1900;
}
</style>
