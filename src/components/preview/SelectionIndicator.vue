<template>
  <div v-if="shouldShowIndicator" class="selection-indicator-container">
    <div
      class="selection-indicator"
      :style="indicatorStyle"
      :class="{ 'is-dragging': isDragging || isScaling || isRotating }"
      @mousedown="handleMouseDown"
    >
      <!-- 四角控制点 -->
      <div 
        class="control-point corner top-left" 
        :class="{ active: activeHandle === 'corner-top-left' }"
        @mousedown.stop="handleScaleMouseDown($event, 'corner', 'top-left')"
      />
      <div 
        class="control-point corner top-right" 
        :class="{ active: activeHandle === 'corner-top-right' }"
        @mousedown.stop="handleScaleMouseDown($event, 'corner', 'top-right')"
      />
      <div 
        class="control-point corner bottom-left" 
        :class="{ active: activeHandle === 'corner-bottom-left' }"
        @mousedown.stop="handleScaleMouseDown($event, 'corner', 'bottom-left')"
      />
      <div 
        class="control-point corner bottom-right" 
        :class="{ active: activeHandle === 'corner-bottom-right' }"
        @mousedown.stop="handleScaleMouseDown($event, 'corner', 'bottom-right')"
      />
      
      <!-- 四边中点控制点（等比缩放时隐藏） -->
      <div
        v-if="!isProportionalScale"
        class="control-point edge top"
        :class="{ active: activeHandle === 'edge-top' }"
        @mousedown.stop="handleScaleMouseDown($event, 'edge', 'top')"
      />
      <div
        v-if="!isProportionalScale"
        class="control-point edge bottom"
        :class="{ active: activeHandle === 'edge-bottom' }"
        @mousedown.stop="handleScaleMouseDown($event, 'edge', 'bottom')"
      />
      <div
        v-if="!isProportionalScale"
        class="control-point edge left"
        :class="{ active: activeHandle === 'edge-left' }"
        @mousedown.stop="handleScaleMouseDown($event, 'edge', 'left')"
      />
      <div
        v-if="!isProportionalScale"
        class="control-point edge right"
        :class="{ active: activeHandle === 'edge-right' }"
        @mousedown.stop="handleScaleMouseDown($event, 'edge', 'right')"
      />
      
      <!-- 旋转柄 -->
      <div class="rotation-handle-line" />
      <div 
        class="rotation-handle" 
        :class="{ active: activeHandle === 'rotation' }"
        @mousedown.stop="handleRotateMouseDown($event)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { VisualProps } from '@/core/timelineitem/model/render'
import type { MediaType } from '@/core/mediaitem'
import { degreesToRadians } from '@/core/utils/rotationTransform'

interface Props {
  selectedTimelineItemId: string | null
  isMultiSelectMode: boolean
  canvasResolution: { width: number; height: number }
  canvasDisplaySize: { width: number; height: number }
  containerSize: { width: number; height: number }
  currentFrame: number
}

interface ScaleStartEvent {
  handleType: 'corner' | 'edge'
  handlePosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'left' | 'right'
  isProportional: boolean
  clientX: number
  clientY: number
}

interface RotateStartEvent {
  centerPoint: { x: number; y: number }
  clientX: number
  clientY: number
}

interface Emits {
  (e: 'dragStart', event: MouseEvent): void
  (e: 'dragMove', event: MouseEvent): void
  (e: 'dragEnd', event: MouseEvent): void
  (e: 'scaleStart', event: ScaleStartEvent): void
  (e: 'rotateStart', event: RotateStartEvent): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const unifiedStore = useUnifiedStore()

// 拖拽状态
const isDragging = ref(false)
const isScaling = ref(false)
const isRotating = ref(false)
const activeHandle = ref<string | null>(null)

// 是否显示指示器 (单选时显示，但音频类型不显示)
const shouldShowIndicator = computed(() => {
  if (!props.selectedTimelineItemId) return false
  if (props.isMultiSelectMode) return false
  
  // 音频类型不显示指示器
  if (selectedItem.value && TimelineItemQueries.isAudioTimelineItem(selectedItem.value)) {
    return false
  }
  
  return true
})

// 获取选中的时间轴项目
const selectedItem = computed(() => {
  if (!props.selectedTimelineItemId) return null
  return unifiedStore.getTimelineItem(props.selectedTimelineItemId)
})

// 获取元素的渲染配置
const visualConfig = computed<VisualProps | null>(() => {
  if (!selectedItem.value) return null
  if (!TimelineItemQueries.hasVisualProperties(selectedItem.value)) return null
  return TimelineItemQueries.getResolvedRenderConfig(selectedItem.value).visual
})

// 是否等比缩放
const isProportionalScale = computed(() => {
  if (!selectedItem.value) return false
  if (!TimelineItemQueries.hasVisualProperties(selectedItem.value)) return false
  return TimelineItemQueries.getResolvedRenderConfig(selectedItem.value).visual.proportionalScale ?? false
})

// 计算指示器样式
const indicatorStyle = computed((): CSSProperties => {
  if (!visualConfig.value) return {}

  const domPosition = convertCanvasToDOM(
    visualConfig.value,
    props.canvasResolution,
    props.canvasDisplaySize,
    props.containerSize,
  )

  return {
    left: `${domPosition.left}px`,
    top: `${domPosition.top}px`,
    width: `${domPosition.width}px`,
    height: `${domPosition.height}px`,
    transform: `rotate(${domPosition.rotation}rad)`,
  }
})

// 坐标转换: Canvas 中心坐标系 → DOM 左上角坐标系
function convertCanvasToDOM(
  config: VisualProps,
  canvasResolution: { width: number; height: number },
  canvasDisplaySize: { width: number; height: number },
  containerSize: { width: number; height: number },
) {
  // 边界检查
  if (canvasResolution.width === 0 || canvasResolution.height === 0) {
    return { left: 0, top: 0, width: 0, height: 0, rotation: 0 }
  }
  if (config.width === 0 || config.height === 0) {
    return { left: 0, top: 0, width: 0, height: 0, rotation: 0 }
  }

  // 计算缩放比例
  const scaleX = canvasDisplaySize.width / canvasResolution.width
  const scaleY = canvasDisplaySize.height / canvasResolution.height

  // 转换位置（项目坐标 Y 向上为正；DOM/Canvas 内部 Y 向下为正）
  const canvasX = (config.x + canvasResolution.width / 2) * scaleX
  const canvasY = (canvasResolution.height / 2 - config.y) * scaleY

  // 计算 Canvas 在容器中的居中偏移
  const offsetX = (containerSize.width - canvasDisplaySize.width) / 2
  const offsetY = (containerSize.height - canvasDisplaySize.height) / 2

  // 加上居中偏移
  const domX = canvasX + offsetX
  const domY = canvasY + offsetY

  // 转换尺寸
  const domWidth = config.width * scaleX
  const domHeight = config.height * scaleY

  // 计算左上角位置
  const left = domX - domWidth / 2
  const top = domY - domHeight / 2

  // 转换旋转角度：角度 → 弧度（用于 CSS transform）
  const rotationRadians = degreesToRadians(config.rotation)

  return { left, top, width: domWidth, height: domHeight, rotation: rotationRadians }
}

/**
 * 处理鼠标按下事件，开始拖拽
 */
function handleMouseDown(event: MouseEvent) {
  // 阻止默认行为和事件冒泡
  event.preventDefault()
  event.stopPropagation()

  // 只响应左键
  if (event.button !== 0) return

  isDragging.value = true
  emit('dragStart', event)
}

/**
 * 处理缩放控制点鼠标按下
 */
function handleScaleMouseDown(
  event: MouseEvent,
  handleType: 'corner' | 'edge',
  handlePosition: ScaleStartEvent['handlePosition']
) {
  event.preventDefault()
  event.stopPropagation()

  if (event.button !== 0) return

  // 如果是等比缩放模式且点击的是边中点，则禁用
  if (isProportionalScale.value && handleType === 'edge') {
    return
  }

  isScaling.value = true
  activeHandle.value = `${handleType}-${handlePosition}`

  emit('scaleStart', {
    handleType,
    handlePosition,
    isProportional: isProportionalScale.value,
    clientX: event.clientX,
    clientY: event.clientY,
  })
}

/**
 * 处理旋转柄鼠标按下
 */
function handleRotateMouseDown(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()

  if (event.button !== 0) return

  isRotating.value = true
  activeHandle.value = 'rotation'

  // 计算旋转中心点（Canvas坐标）
  const centerPoint = {
    x: visualConfig.value?.x ?? 0,
    y: visualConfig.value?.y ?? 0,
  }

  emit('rotateStart', {
    centerPoint,
    clientX: event.clientX,
    clientY: event.clientY,
  })
}

/**
 * 处理全局鼠标松开事件，重置所有操作状态
 */
function handleGlobalMouseUp() {
  if (isDragging.value) {
    isDragging.value = false
  }
  if (isScaling.value) {
    isScaling.value = false
    activeHandle.value = null
  }
  if (isRotating.value) {
    isRotating.value = false
    activeHandle.value = null
  }
}

// 组件挂载时添加全局鼠标松开监听器
onMounted(() => {
  window.addEventListener('mouseup', handleGlobalMouseUp)
})

// 组件卸载时移除全局鼠标松开监听器
onUnmounted(() => {
  window.removeEventListener('mouseup', handleGlobalMouseUp)
})
</script>

<style scoped>
.selection-indicator-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.selection-indicator {
  position: absolute;
  border: 2px solid #ffffff;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: move;
  transition: border-color 0.15s ease;
}

.selection-indicator.is-dragging {
  border-color: #3b82f6;
  cursor: grabbing;
}

/* 控制点基础样式 */
.control-point {
  position: absolute;
  background-color: #ffffff;
  border: 1px solid #ffffff;
  box-sizing: border-box;
  transition: all 0.15s ease;
}

.control-point:hover {
  border-color: #3b82f6;
  border-width: 2px;
}

.control-point.active {
  background: #3b82f6;
  border-color: #ffffff;
}

/* 角点样式 */
.control-point.corner {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.control-point.corner.top-left {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.control-point.corner.top-right {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.control-point.corner.bottom-left {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.control-point.corner.bottom-right {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}

/* 边中点样式 */
.control-point.edge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.control-point.edge.top {
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}

.control-point.edge.bottom {
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}

.control-point.edge.left {
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  cursor: ew-resize;
}

.control-point.edge.right {
  right: -4px;
  top: 50%;
  transform: translateY(-50%);
  cursor: ew-resize;
}

/* 旋转柄样式 */
.rotation-handle-line {
  position: absolute;
  top: -30px;
  left: 50%;
  width: 1px;
  height: 30px;
  background: #ffffff;
  transform: translateX(-50%);
  pointer-events: none;
}

.rotation-handle {
  position: absolute;
  top: -40px;
  left: 50%;
  width: 20px;
  height: 20px;
  background: #ffffff;
  border: 1px solid #ffffff;
  border-radius: 50%;
  transform: translateX(-50%);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.rotation-handle.active {
  background: #3b82f6;
  cursor: grabbing;
}

.rotation-handle.active svg {
  color: #ffffff;
}

.rotation-handle svg {
  color: #6b7280;
}
</style>
