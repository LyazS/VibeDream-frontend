<template>
  <div class="playhead-container" ref="playheadContainer" @wheel="handleWheel">
    <!-- 播放头手柄 -->
    <div
      class="playhead-handle"
      :style="{ left: playheadPosition + 'px' }"
      @mousedown="handleMouseDown"
      @wheel="handleWheel"
    >
      <!-- 白色倒三角 -->
      <div class="playhead-triangle"></div>
    </div>

    <!-- 播放竖线 - 覆盖整个时间轴 -->
    <div class="playhead-line" :style="{ left: playheadLinePosition + 'px' }"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'

interface PlayheadProps {
  /** 时间轴容器宽度 */
  timelineWidth: number
  /** 轨道控制区域宽度（左侧偏移） */
  trackControlWidth?: number
  /** 滚轮事件处理容器引用 */
  wheelContainer?: HTMLElement
}

const props = withDefaults(defineProps<PlayheadProps>(), {
  trackControlWidth: 150,
  wheelContainer: undefined,
})

const unifiedStore = useUnifiedStore()
const isDragging = ref(false)
const playheadContainer = ref<HTMLElement>()

// 播放头手柄位置（相对于时间刻度区域）
const playheadPosition = computed(() => {
  const currentFrame = unifiedStore.currentFrame
  const pixelPosition = unifiedStore.frameToPixel(currentFrame, props.timelineWidth)
  // 如果是在 TimeScale 中使用（trackControlWidth = 0），直接返回像素位置
  // 如果是在 Timeline 中使用，需要加上偏移
  return props.trackControlWidth + pixelPosition
})

// 播放竖线位置（与播放头手柄位置保持一致）
const playheadLinePosition = computed(() => {
  return playheadPosition.value
})

// 处理鼠标按下事件
const handleMouseDown = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()

  unifiedStore.pause()

  isDragging.value = true
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  // 设置拖拽光标样式
  if (playheadContainer.value) {
    playheadContainer.value.style.cursor = 'grabbing'
  }
}

// 处理鼠标移动事件
const handleMouseMove = (event: MouseEvent) => {
  if (!isDragging.value) return

  const timelineRect = playheadContainer.value?.getBoundingClientRect()
  if (!timelineRect) return

  // 计算鼠标相对于时间轴容器的位置
  const mouseX = event.clientX - timelineRect.left
  const trackControlAreaWidth = props.trackControlWidth

  // 确保鼠标位置在时间轴内容区域内
  if (mouseX >= trackControlAreaWidth && mouseX <= timelineRect.width) {
    const contentX = mouseX - trackControlAreaWidth
    let frame = unifiedStore.pixelToFrame(contentX, props.timelineWidth)

    // 应用吸附功能
    if (unifiedStore.snapConfig.enabled && unifiedStore.snapConfig.playhead) {
      // 开始拖拽阶段，收集候选目标
      if (!unifiedStore.isSnapCalculating) {
        // 开始拖拽时收集吸附目标（排除播放头自身位置）
        unifiedStore.startSnapDrag([])
      }

      // 计算吸附位置
      const snapOptions = {
        excludeClipIds: [],
        customThreshold: unifiedStore.snapConfig.threshold,
      }
      const calculatedSnapResult = unifiedStore.calculateSnapPosition(frame, snapOptions)
      if (calculatedSnapResult) {
        // 避免吸附到播放头自身位置
        const isSnappingToCurrentPlayhead = calculatedSnapResult.snapPoint?.type === 'playhead'
        if (!isSnappingToCurrentPlayhead) {
          frame = calculatedSnapResult.frame
        }
      }
    }

    // 更新当前帧（使用四舍五入而不是向下取整）
    unifiedStore.setCurrentFrame(Math.max(0, Math.round(frame)))
  }
}

// 处理鼠标释放事件
const handleMouseUp = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)

  // 恢复光标样式
  if (playheadContainer.value) {
    playheadContainer.value.style.cursor = 'grab'
  }

  // 结束拖拽阶段，清理缓存
  if (unifiedStore.snapConfig.enabled && unifiedStore.snapConfig.playhead) {
    unifiedStore.endSnapDrag()
  }
}

/**
 * 处理滚轮事件
 * 将滚轮事件传递给指定的容器，确保播放头不拦截滚轮操作
 */
const handleWheel = (event: WheelEvent) => {
  // 阻止事件冒泡，避免重复处理
  event.stopPropagation()

  // 如果指定了滚轮处理容器，将事件传递给该容器
  if (props.wheelContainer) {
    // 创建一个新的事件对象，确保所有属性都被复制
    const newEvent = new WheelEvent('wheel', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      bubbles: true,
      cancelable: true,
    })

    props.wheelContainer.dispatchEvent(newEvent)
  }
}

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped>
.playhead-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none; /* 容器本身不接收事件 */
}

.playhead-handle {
  position: absolute;
  top: 0;
  height: 100%;
  width: 20px; /* 增加点击区域 */
  margin-left: -10px; /* 居中对齐 */
  z-index: 25; /* 确保在播放竖线之上，但在clip tooltip之下 */
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 0; /* 移除顶部间距，让三角形紧贴顶端 */
  cursor: grab;
  pointer-events: auto; /* 允许手柄区域接收事件 */
}

.playhead-handle:hover .playhead-triangle {
  border-top-color: #ff6b6b; /* 悬停时变为红色 */
}

.playhead-triangle {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 10px solid white; /* 白色倒三角，稍微大一些 */
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.playhead-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: white; /* 白色竖线 */
  z-index: 20; /* 确保在所有内容之上，但在clip tooltip之下 */
  margin-left: -0.5px; /* 居中对齐 */
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
}
</style>
