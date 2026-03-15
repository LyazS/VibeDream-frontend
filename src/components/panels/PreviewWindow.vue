<template>
  <div class="preview-window">
    <!-- Bunny渲染器 -->
    <div ref="rendererContainerRef" class="renderer-container" @contextmenu="handleContextMenu" @click="handleCanvasClick">
      <BunnyRender ref="bunnyRenderRef" />
      <!-- 选中指示器 -->
      <SelectionIndicator
        :selected-timeline-item-id="selectedTimelineItemId"
        :is-multi-select-mode="isMultiSelectMode"
        :canvas-resolution="canvasResolution"
        :canvas-display-size="canvasDisplaySize"
        :container-size="containerSize"
        :current-frame="currentFrame"
        @drag-start="handleDragStart"
        @drag-move="handleDragMove"
        @drag-end="handleDragEnd"
        @scale-start="handleScaleStart"
        @rotate-start="handleRotateStart"
      />
    </div>

    <!-- 播放控制面板紧贴在预览窗口下方 -->
    <div class="controls-section">
      <!-- 时间显示 -->
      <div class="time-display">
        {{ framesToTimecodeCompact(unifiedStore.currentFrame) }}/{{
          framesToTimecodeCompact(
            unifiedStore.contentEndTimeFrames || unifiedStore.totalDurationFrames,
          )
        }}
      </div>
      <!-- 中间播放控制 -->
      <div class="center-controls">
        <HoverButton
          variant="primary"
          @click="togglePlayPause"
          :title="isPlaying ? t('common.pause') : t('common.play')"
        >
          <template #icon>
            <component :is="getPlaybackIcon(isPlaying)" size="16px" />
          </template>
        </HoverButton>

        <HoverButton @click="stop" :title="t('common.stop')">
          <template #icon>
            <component :is="IconComponents.STOP" size="16px" />
          </template>
        </HoverButton>
      </div>
      <!-- 右侧比例按钮 -->
      <button
        class="aspect-ratio-btn"
        @click="showResolutionModal = true"
        :title="t('editor.setVideoResolution')"
      >
        <span class="aspect-ratio-text">{{ currentResolutionText }}</span>
      </button>
    </div>

    <!-- 分辨率选择弹窗 -->
    <ResolutionModal
      :show="showResolutionModal"
      :current-resolution="currentResolution"
      @close="showResolutionModal = false"
      @confirm="handleResolutionConfirm"
    />

    <!-- 右键菜单 -->
    <ContextMenu v-model:show="showContextMenu" :options="contextMenuOptions">
      <template v-for="(item, index) in contextMenuItems" :key="index">
        <ContextMenuSeparator v-if="'type' in item && item.type === 'separator'" />
        <ContextMenuItem
          v-else-if="'label' in item && 'onClick' in item"
          :label="item.label"
          :disabled="item.disabled"
          @click="item.onClick"
        >
          <template #icon>
            <component :is="item.icon" size="16px" />
          </template>
        </ContextMenuItem>
      </template>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import BunnyRender from '@/components/panels/BunnyRender.vue'
import SelectionIndicator from '@/components/preview/SelectionIndicator.vue'
import ResolutionModal from '@/components/modals/ResolutionModal.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents, getPlaybackIcon } from '@/constants/iconComponents'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecodeCompact } from '@/core/utils/timeUtils'
import { useAppI18n } from '@/core/composables/useI18n'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@imengyu/vue3-context-menu'
import { domToCanvasCoordinates, isPointInRotatedBoundingBox, domDeltaToCanvasDelta } from '@/core/utils/canvasClickUtils'
import { getVisibleTimelineItems, sortTimelineItemsByTrackIndex } from '@/core/utils/timelineVisibilityUtils'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { useUnifiedKeyframeTransformControls } from '@/core/composables/useKeyframeTransformControls'
import { calculateScaledSize, calculateRotationAngle } from '@/core/utils/transformMath'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// renderer-container 引用
const rendererContainerRef = ref<HTMLElement | null>(null)

// 容器尺寸的响应式值（用于强制刷新）
const containerSizeValue = ref({ width: 0, height: 0 })

// BunnyRender 组件引用
const bunnyRenderRef = ref<InstanceType<typeof BunnyRender> | null>(null)

// 选中状态
const selectedTimelineItemId = computed(() => {
  const ids = unifiedStore.selectedTimelineItemIds
  return ids.size === 1 ? Array.from(ids)[0] : null
})

const isMultiSelectMode = computed(() => unifiedStore.selectedTimelineItemIds.size > 1)

// Canvas 分辨率
const canvasResolution = computed(() => unifiedStore.videoResolution)

// Canvas 显示尺寸（从 BunnyRender 组件获取）
const canvasDisplaySize = computed(() => bunnyRenderRef.value?.canvasDisplaySize || { width: 0, height: 0 })

// 容器尺寸（使用 ref 而非 computed，以便通过 ResizeObserver 更新）
const containerSize = computed(() => containerSizeValue.value)

// 更新容器尺寸的函数
const updateContainerSize = () => {
  if (!rendererContainerRef.value) return
  const rect = rendererContainerRef.value.getBoundingClientRect()
  containerSizeValue.value = { width: rect.width, height: rect.height }
}

// 当前播放帧
const currentFrame = computed(() => unifiedStore.currentFrame)

// ==================== 拖拽功能 ====================

// 获取选中的时间轴项目（用于 composable）
const selectedItem = computed(() => {
  if (!selectedTimelineItemId.value) return null
  return unifiedStore.getTimelineItem(selectedTimelineItemId.value) ?? null
})

// 使用关键帧变换控制器
const {
  setTransformPositionDeferred,
  setTransformSizeDeferred,
  setTransformRotationDeferred,
  commitDeferredUpdates,
} = useUnifiedKeyframeTransformControls({
  selectedTimelineItem: selectedItem,
  currentFrame,
})

// 拖拽状态
const dragState = ref({
  isDragging: false,
  startX: 0,
  startY: 0,
  initialCanvasX: 0,
  initialCanvasY: 0,
  hasMoved: false, // 是否真正发生了拖拽移动
})

// 缩放状态
const scaleState = ref({
  isScaling: false,
  handleType: null as 'corner' | 'edge' | null,
  handlePosition: null as string | null,
  isProportional: false,
  startX: 0,
  startY: 0,
  initialWidth: 0,
  initialHeight: 0,
  initialX: 0,
  initialY: 0,
  initialRotation: 0,
  hasMoved: false, // 是否真正发生了缩放移动
})

// 旋转状态
const rotationState = ref({
  isRotating: false,
  startX: 0,
  startY: 0,
  initialRotation: 0,
  centerPoint: null as { x: number; y: number } | null,
  hasMoved: false, // 是否真正发生了旋转移动
})

/**
 * 开始拖拽
 */
function handleDragStart(event: MouseEvent) {
  if (!selectedTimelineItemId.value) return

  // 获取当前项目的位置
  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  dragState.value = {
    isDragging: true,
    startX: event.clientX,
    startY: event.clientY,
    initialCanvasX: config.x,
    initialCanvasY: config.y,
    hasMoved: false, // 重置移动标志
  }

  // 添加全局鼠标事件监听器
  window.addEventListener('mousemove', handleGlobalMouseMove)
  window.addEventListener('mouseup', handleGlobalMouseUp)
}

/**
 * 处理拖拽移动（通过 SelectionIndicator emit 的事件）
 */
function handleDragMove(event: MouseEvent) {
  if (!dragState.value.isDragging) return

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  dragState.value.hasMoved = true // 标记已移动

  // 计算 DOM 移动增量
  const domDeltaX = event.clientX - dragState.value.startX
  const domDeltaY = event.clientY - dragState.value.startY

  // 转换为 Canvas 坐标增量
  const canvasDelta = domDeltaToCanvasDelta(
    domDeltaX,
    domDeltaY,
    canvasDisplaySize.value,
    canvasResolution.value,
  )

  // 计算新的 Canvas 坐标
  const newCanvasX = dragState.value.initialCanvasX + canvasDelta.x
  const newCanvasY = dragState.value.initialCanvasY + canvasDelta.y

  // 使用延迟更新方法同时更新 x 和 y 位置
  setTransformPositionDeferred(newCanvasX, newCanvasY)
}

/**
 * 处理拖拽结束
 */
async function handleDragEnd(_event: MouseEvent) {
  if (!dragState.value.isDragging) return

  // 提交延迟更新（创建历史记录）
  await commitDeferredUpdates()

  // 重置拖拽状态
  dragState.value.isDragging = false

  // 移除全局鼠标事件监听器
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
}

/**
 * 全局鼠标移动事件（用于拖拽到组件外的情况）
 */
function handleGlobalMouseMove(event: MouseEvent) {
  handleDragMove(event)
}

/**
 * 全局鼠标释放事件（用于拖拽到组件外的情况）
 */
async function handleGlobalMouseUp(event: MouseEvent) {
  await handleDragEnd(event)
}

// ==================== 缩放功能 ====================

/**
 * 开始缩放
 */
function handleScaleStart(event: any) {
  if (!selectedTimelineItemId.value) return

  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  scaleState.value = {
    isScaling: true,
    handleType: event.handleType,
    handlePosition: event.handlePosition,
    isProportional: event.isProportional,
    startX: event.clientX,
    startY: event.clientY,
    initialWidth: config.width,
    initialHeight: config.height,
    initialX: config.x,
    initialY: config.y,
    initialRotation: config.rotation,
    hasMoved: false, // 重置移动标志
  }

  window.addEventListener('mousemove', handleGlobalScaleMove)
  window.addEventListener('mouseup', handleGlobalScaleEnd)
}

/**
 * 处理缩放移动
 */
function handleScaleMove(event: MouseEvent) {
  if (!scaleState.value.isScaling) return

  scaleState.value.hasMoved = true // 标记已移动

  const {
    handlePosition,
    isProportional,
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    initialRotation,
  } = scaleState.value

  // 计算DOM增量
  const domDeltaX = event.clientX - scaleState.value.startX
  const domDeltaY = event.clientY - scaleState.value.startY

  // 转换为Canvas增量
  const canvasDelta = domDeltaToCanvasDelta(
    domDeltaX,
    domDeltaY,
    canvasDisplaySize.value,
    canvasResolution.value
  )

  // 计算新的尺寸和位置
  const result = calculateScaledSize({
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    deltaX: canvasDelta.x,
    deltaY: canvasDelta.y,
    handlePosition: handlePosition!,
    isProportional,
    elementRotation: initialRotation,
  })

  // 使用延迟更新方法
  setTransformSizeDeferred(result.width, result.height, result.x, result.y)
}

/**
 * 处理缩放结束
 */
async function handleScaleEnd(_event: MouseEvent) {
  if (!scaleState.value.isScaling) return

  // 提交延迟更新
  await commitDeferredUpdates()

  // 重置缩放状态
  scaleState.value.isScaling = false

  // 移除全局事件监听器
  window.removeEventListener('mousemove', handleGlobalScaleMove)
  window.removeEventListener('mouseup', handleGlobalScaleEnd)
}

/**
 * 全局缩放移动事件
 */
function handleGlobalScaleMove(event: MouseEvent) {
  handleScaleMove(event)
}

/**
 * 全局缩放释放事件
 */
async function handleGlobalScaleEnd(event: MouseEvent) {
  await handleScaleEnd(event)
}

// ==================== 旋转功能 ====================

/**
 * 开始旋转
 */
function handleRotateStart(event: any) {
  if (!selectedTimelineItemId.value) return

  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  rotationState.value = {
    isRotating: true,
    startX: event.clientX,
    startY: event.clientY,
    initialRotation: config.rotation,
    centerPoint: event.centerPoint,
    hasMoved: false, // 重置移动标志
  }

  window.addEventListener('mousemove', handleGlobalRotateMove)
  window.addEventListener('mouseup', handleGlobalRotateEnd)
}

/**
 * 处理旋转移动
 */
function handleRotateMove(event: MouseEvent) {
  if (!rotationState.value.isRotating) return

  rotationState.value.hasMoved = true // 标记已移动

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  // 获取鼠标在DOM中的位置（相对于容器）
  const domX = event.clientX - rect.left
  const domY = event.clientY - rect.top

  // 转换为Canvas坐标
  const canvasPoint = domToCanvasCoordinates(
    domX,
    domY,
    canvasResolution.value,
    canvasDisplaySize.value,
    containerSize.value
  )

  // 计算新的旋转角度
  const newRotation = calculateRotationAngle(
    canvasPoint.x,
    canvasPoint.y,
    rotationState.value.centerPoint!.x,
    rotationState.value.centerPoint!.y
  )

  setTransformRotationDeferred(newRotation)
}

/**
 * 处理旋转结束
 */
async function handleRotateEnd(_event: MouseEvent) {
  if (!rotationState.value.isRotating) return

  // 提交延迟更新
  await commitDeferredUpdates()

  // 重置旋转状态
  rotationState.value.isRotating = false

  // 移除全局事件监听器
  window.removeEventListener('mousemove', handleGlobalRotateMove)
  window.removeEventListener('mouseup', handleGlobalRotateEnd)
}

/**
 * 全局旋转移动事件
 */
function handleGlobalRotateMove(event: MouseEvent) {
  handleRotateMove(event)
}

/**
 * 全局旋转释放事件
 */
async function handleGlobalRotateEnd(event: MouseEvent) {
  await handleRotateEnd(event)
}

// 组件卸载时清理事件监听器
onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  window.removeEventListener('mousemove', handleGlobalScaleMove)
  window.removeEventListener('mouseup', handleGlobalScaleEnd)
  window.removeEventListener('mousemove', handleGlobalRotateMove)
  window.removeEventListener('mouseup', handleGlobalRotateEnd)

  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// ResizeObserver 用于监听容器尺寸变化
let resizeObserver: ResizeObserver | null = null

// 在 onMounted 中设置 ResizeObserver
onMounted(async () => {
  await nextTick()
  updateContainerSize()

  // 设置 ResizeObserver 监听容器尺寸变化
  if (rendererContainerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize()
    })
    resizeObserver.observe(rendererContainerRef.value)
  }
})

// 分辨率弹窗显示状态
const showResolutionModal = ref(false)

// 右键菜单状态
const showContextMenu = ref(false)
const contextMenuOptions = ref({
  x: 0,
  y: 0,
  theme: 'mac dark',
  zIndex: 1000,
})

// 菜单项类型定义
type MenuItem =
  | {
      label: string
      icon: any
      onClick?: () => void
      disabled?: boolean
    }
  | {
      type: 'separator'
    }

// 播放状态
const isPlaying = computed(() => unifiedStore.isPlaying)

// 统一播放控制接口
function togglePlayPause() {
  if (isPlaying.value) {
    unifiedStore.pause()
  } else {
    unifiedStore.play()
  }
}

function stop() {
  unifiedStore.stop()
}

// 从videoStore获取当前分辨率，而不是使用硬编码的默认值
const currentResolution = computed(() => {
  const resolution = unifiedStore.videoResolution
  // 根据分辨率判断类别
  const aspectRatio = resolution.width / resolution.height
  let category = t('editor.landscape')
  if (aspectRatio < 1) {
    category = t('editor.portrait')
  } else if (Math.abs(aspectRatio - 1) < 0.1) {
    category = t('editor.square')
  }

  return {
    name: resolution.name,
    width: resolution.width,
    height: resolution.height,
    aspectRatio: resolution.aspectRatio,
    category: category,
  }
})

const currentResolutionText = computed(() => {
  return `${currentResolution.value.aspectRatio}`
})

function handleResolutionConfirm(resolution: {
  name: string
  width: number
  height: number
  aspectRatio: string
}) {
  // 更新videoStore中的分辨率
  unifiedStore.setVideoResolution(resolution)
  console.log('确认选择分辨率:', resolution)
}

// ==================== 右键菜单 ====================

// 右键菜单项配置
const contextMenuItems = computed((): MenuItem[] => {
  return [
    {
      label: t('editor.preview.downloadCurrentFrame'),
      icon: IconComponents.IMAGE_SMALL,
      onClick: captureCanvasFrame,
    },
  ]
})

// ==================== 画布点击处理 ====================

/**
 * 处理画布点击事件，实现点击选择功能
 */
function handleCanvasClick(event: MouseEvent): void {
  // 如果刚刚发生过拖拽移动、缩放或旋转，忽略点击
  if (dragState.value.hasMoved) {
    dragState.value.hasMoved = false
    return
  }
  if (scaleState.value.hasMoved) {
    scaleState.value.hasMoved = false
    return
  }
  if (rotationState.value.hasMoved) {
    rotationState.value.hasMoved = false
    return
  }

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  // 获取点击位置（相对于容器左上角）
  const domX = event.clientX - rect.left
  const domY = event.clientY - rect.top

  // 查找被点击的时间轴项
  const clickedItemId = findTimelineItemAtPosition(
    domX,
    domY,
    {
      width: canvasResolution.value.width,
      height: canvasResolution.value.height,
    },
    canvasDisplaySize.value,
    containerSize.value,
    currentFrame.value,
  )

  // 执行选择操作
  if (clickedItemId) {
    unifiedStore.selectTimelineItem(clickedItemId)
  } else {
    // 如果没有点中任何项目，且当前只有一个时间轴项目被选中，则取消选中
    if (unifiedStore.selectedTimelineItemIds.size === 1) {
      unifiedStore.clearTimelineSelection()
    }
  }
}

/**
 * 查找指定位置的时间轴项
 *
 * @param domX DOM 坐标 X（相对于容器左上角）
 * @param domY DOM 坐标 Y（相对于容器左上角）
 * @param canvasResolution Canvas 分辨率
 * @param canvasDisplaySize Canvas 显示尺寸
 * @param containerSize 容器尺寸
 * @param currentFrame 当前播放帧
 * @returns 被点击的时间轴项 ID，如果没有则返回 null
 */
function findTimelineItemAtPosition(
  domX: number,
  domY: number,
  canvasResolution: { width: number; height: number },
  canvasDisplaySize: { width: number; height: number },
  containerSize: { width: number; height: number },
  currentFrame: number,
): string | null {
  // 1. 坐标转换：DOM → Canvas 中心坐标
  const canvasPoint = domToCanvasCoordinates(
    domX,
    domY,
    canvasResolution,
    canvasDisplaySize,
    containerSize,
  )

  // 2. 获取当前时间点的所有可见项
  const visibleItems = getVisibleTimelineItems(
    unifiedStore.timelineItems,
    currentFrame,
    (trackId: string) => unifiedStore.getTrack(trackId),
  )

  if (visibleItems.length === 0) {
    return null
  }

  // 3. 按轨道索引排序（从下到上）
  // 从 tracks 数组构建 trackIndexMap
  const trackIndexMap = new Map<string, number>()
  unifiedStore.tracks.forEach((track, index) => {
    trackIndexMap.set(track.id, index)
  })
  const sortedItems = sortTimelineItemsByTrackIndex(visibleItems, trackIndexMap)

  // 4. 从最上层（轨道索引最小）开始检测碰撞
  // 正序遍历，因为 sortedItems 是从大到小排序的
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i]

    // 检查是否有视觉属性（过滤掉纯音频项目）
    if (!TimelineItemQueries.hasVisualProperties(item)) {
      continue
    }

    // 获取渲染配置（包含动画插值）
    const renderConfig = TimelineItemQueries.getRenderConfig(item)

    // 碰撞检测：考虑旋转角度
    const isHit = isPointInRotatedBoundingBox(canvasPoint, {
      x: renderConfig.x,
      y: renderConfig.y,
      width: renderConfig.width,
      height: renderConfig.height,
      rotation: renderConfig.rotation,
    })

    if (isHit) {
      return item.id
    }
  }

  return null
}

// 右键菜单处理
function handleContextMenu(event: MouseEvent): void {
  event.preventDefault()

  contextMenuOptions.value.x = event.clientX
  contextMenuOptions.value.y = event.clientY
  showContextMenu.value = true
}

// ==================== 画布截帧功能 ====================

/**
 * 截取当前画布画面并下载
 */
async function captureCanvasFrame() {
  try {
    // 生成文件名（包含当前时间）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const currentTime = unifiedStore.formattedCurrentTime
    const filename = `screenshot-${timestamp}-at-${currentTime}.png`

    console.log('📸 开始截取画布画面...')
    await unifiedStore.captureCanvasFrame(filename)
    console.log('✅ 画布截帧成功')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ 画布截帧失败:', errorMessage)
  }
}
</script>

<style scoped>
.preview-window {
  width: 100%;
  flex: 1;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-xlarge);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-bg-secondary);
  box-sizing: border-box;
  min-width: 150px;
  min-height: 100px;
}

.renderer-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: default;
}

.controls-section {
  height: 50px;
  width: 100%;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-large);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md);
  flex-shrink: 0;
  min-width: 200px;
  overflow: hidden;
}

.time-display {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  font-family: monospace;
  flex-shrink: 0;
}

.center-controls {
  flex: 1;
  display: flex;
  justify-content: center;
  background-color: var(--color-bg-secondary);
}

.aspect-ratio-btn {
  background: none;
  border: 1px solid var(--color-border-primary);
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}

.aspect-ratio-btn:hover {
  background-color: var(--color-bg-quaternary);
  border-color: var(--color-border-secondary);
  color: var(--color-text-primary);
}

.aspect-ratio-text {
  font-family: monospace;
}
</style>
