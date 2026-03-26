<template>
  <div class="bunny-renderer" ref="rendererContainer">
    <!-- Canvas 容器包装器 -->
    <div
      ref="canvasContainerWrapper"
      class="canvas-container-wrapper"
      :style="canvasContainerStyle"
    >
      <!-- 模版定义的 Canvas 元素 -->
      <canvas ref="canvasRef" :width="canvasWidth" :height="canvasHeight" class="bunny-canvas" />
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'

/**
 * 视频分辨率接口
 */
interface VideoResolution {
  name: string
  width: number
  height: number
  aspectRatio: string
  category?: string
}

// 扩展HTMLElement类型以包含自定义属性
interface ExtendedHTMLElement extends HTMLElement {
  _resizeObserver?: ResizeObserver
}

const unifiedStore = useUnifiedStore()

// 组件引用
const canvasRef = ref<HTMLCanvasElement>()
const rendererContainer = ref<HTMLElement>()

// 计算属性
const error = computed(() => unifiedStore.mediaBunnyError)

// 画布原始尺寸（基于视频分辨率）
const canvasWidth = computed(() => unifiedStore.videoResolution.width)
const canvasHeight = computed(() => unifiedStore.videoResolution.height)

// 容器尺寸
const containerWidth = ref(800)
const containerHeight = ref(600)

// 计算画布显示尺寸（保持比例，适应容器）
const canvasDisplaySize = computed(() => {
  const aspectRatio = canvasWidth.value / canvasHeight.value
  const containerAspectRatio = containerWidth.value / containerHeight.value

  let displayWidth: number
  let displayHeight: number

  if (aspectRatio > containerAspectRatio) {
    // 画布更宽，以宽度为准
    displayWidth = Math.min(containerWidth.value, canvasWidth.value)
    displayHeight = displayWidth / aspectRatio
  } else {
    // 画布更高，以高度为准
    displayHeight = Math.min(containerHeight.value, canvasHeight.value)
    displayWidth = displayHeight * aspectRatio
  }

  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  }
})

// 画布容器样式
const canvasContainerStyle = computed(() => ({
  width: canvasDisplaySize.value.width + 'px',
  height: canvasDisplaySize.value.height + 'px',
}))

/**
 * 更新容器尺寸
 */
const updateContainerSize = (): void => {
  if (!rendererContainer.value) return

  const rect = rendererContainer.value.getBoundingClientRect()
  containerWidth.value = rect.width
  containerHeight.value = rect.height

  console.log('Container size updated:', {
    width: containerWidth.value,
    height: containerHeight.value,
    canvasDisplay: canvasDisplaySize.value,
  })
}

/**
 * 设置ResizeObserver监听容器尺寸变化
 */
const setupResizeObserver = (): void => {
  if (!rendererContainer.value) return

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      containerWidth.value = width
      containerHeight.value = height
    }
  })

  resizeObserver.observe(rendererContainer.value)

  // 保存observer引用以便清理
  ;(rendererContainer.value as ExtendedHTMLElement)._resizeObserver = resizeObserver
}

/**
 * 清理ResizeObserver
 */
const cleanupResizeObserver = (): void => {
  const container = rendererContainer.value as ExtendedHTMLElement | null
  if (container && container._resizeObserver) {
    container._resizeObserver.disconnect()
    delete container._resizeObserver
  }
}

/**
 * 初始化 MediaBunny Canvas
 */
async function initializeMediaBunnyCanvas(): Promise<void> {
  if (!canvasRef.value) {
    console.error('❌ Canvas 元素未找到')
    return
  }

  try {
    // 设置 Canvas 元素
    await unifiedStore.setMediaBunnyCanvas(canvasRef.value)

    console.log('✅ MediaBunny Canvas 初始化成功')
  } catch (error) {
    console.error('❌ MediaBunny Canvas 初始化失败:', error)
  }
}

// 生命周期
onMounted(async () => {
  await nextTick()
  updateContainerSize()
  setupResizeObserver()
  await initializeMediaBunnyCanvas()
})

onUnmounted(async () => {
  cleanupResizeObserver()
  await unifiedStore.destroyMediaBunny()
})

// 暴露方法和属性
defineExpose({
  getCanvas: () => canvasRef.value,
  initializeMediaBunnyCanvas,
  canvasDisplaySize,
})
</script>

<style scoped>
.bunny-renderer {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}

.canvas-container-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

.bunny-canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background-color: #000;
  border-radius: var(--border-radius-medium);
  box-shadow: var(--shadow-lg);
  /* 禁用所有鼠标事件，防止Canvas响应用户交互 */
  pointer-events: none;
}

.error-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(244, 67, 54, 0.9);
  color: var(--color-text-primary);
  padding: var(--spacing-xl) var(--spacing-xxl);
  border-radius: var(--border-radius-xlarge);
  font-size: var(--font-size-lg);
  text-align: center;
  max-width: 80%;
  word-wrap: break-word;
  z-index: 10;
}

.loading-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(0, 0, 0, 0.8);
  color: var(--color-text-primary);
  padding: var(--spacing-xl) var(--spacing-xxl);
  border-radius: var(--border-radius-xlarge);
  font-size: var(--font-size-lg);
  text-align: center;
  z-index: 10;
}

.success-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: rgba(76, 175, 80, 0.9);
  color: var(--color-text-primary);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--border-radius-medium);
  font-size: var(--font-size-base);
  z-index: 10;
  animation: fadeInOut 3s ease-in-out;
}

@keyframes fadeInOut {
  0% {
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .bunny-canvas {
    max-width: 100%;
    max-height: 100%;
  }
}
</style>
