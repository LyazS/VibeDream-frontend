<template>
  <div class="video-preview-engine">
    <!-- 左侧：预览区域和时间轴 -->
    <div class="left-content" :style="{ width: computedLeftContentWidth + '%' }">
      <!-- 预览区域：三列布局 -->
      <div class="preview-section" :style="{ height: previewHeight + '%' }">
        <!-- 左侧：素材库 -->
        <div class="media-library-panel" :style="{ width: leftPanelPercent + '%' }">
          <AssetLibraryPanel />
        </div>

        <!-- 左侧分割器 -->
        <div
          class="splitter vertical"
          @mousedown="startLeftResize"
          :class="{ dragging: isLeftDragging }"
        ></div>

        <!-- 中间：预览窗口（包含控制面板和分辨率弹窗） -->
        <div class="preview-center" :style="{ width: centerPanelPercent + '%' }">
          <PreviewWindow />
        </div>

        <!-- 右侧分割器 -->
        <div
          class="splitter vertical"
          @mousedown="startRightResize"
          :class="{ dragging: isRightDragging }"
        ></div>

        <!-- 右侧：属性面板 -->
        <div class="properties-panel-container" :style="{ width: rightPanelPercent + '%' }">
          <UnifiedPropertiesPanel />
        </div>
      </div>

      <!-- 可拖动的分割器 -->
      <div
        class="splitter horizontal"
        @mousedown="startResize"
        :class="{ dragging: isDragging }"
      ></div>

      <!-- 时间轴区域 -->
      <div class="timeline-section" :style="{ height: timelineHeight + '%' }">
        <!-- 片段管理工具栏在时间刻度上方 -->
        <div class="clip-management-toolbar">
          <UnifiedClipManagementToolbar />
        </div>
        <UnifiedTimeline />
      </div>
    </div>

    <!-- 中间垂直分割器（仅在聊天面板显示时显示） -->
    <div
      v-if="props.isAIChatPanelVisible"
      class="splitter vertical"
      @mousedown="startMainResize"
      :class="{ dragging: isMainDragging }"
    ></div>

    <!-- 右侧：聊天气泡面板 -->
    <div
      class="right-panel"
      :style="{ width: computedRightPanelWidthPercent + '%' }"
      v-show="props.isAIChatPanelVisible"
    >
      <AIPanel @close="handleCloseChatPanel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import PreviewWindow from '@/components/panels/PreviewWindow.vue'
import AssetLibraryPanel from '@/components/panels/AssetLibraryPanel.vue'
import UnifiedTimeline from '@/components/timeline/UnifiedTimeline.vue'
import UnifiedClipManagementToolbar from '@/components/timeline/UnifiedClipManagementToolbar.vue'
import UnifiedPropertiesPanel from '@/components/panels/UnifiedPropertiesPanel.vue'
import AIPanel from '@/aipanel/AIPanel.vue'
import { useKeyboardShortcuts } from '@/core/composables'

// 定义props和emit
const props = defineProps<{
  isAIChatPanelVisible: boolean
}>()

const emit = defineEmits<{
  'update:isAIChatPanelVisible': [value: boolean]
}>()

// 处理关闭聊天面板
const handleCloseChatPanel = () => {
  emit('update:isAIChatPanelVisible', false)
}

// 分割条宽度常量（像素）
const SPLITTER_WIDTH = 8

// 注册全局快捷键
useKeyboardShortcuts()

onMounted(() => {
  // 初始化百分比宽度
  initializePanelPercentages()
})

// 初始化百分比宽度
const initializePanelPercentages = () => {
  // 直接设置初始比例为40-30-30
  leftPanelPercent.value = 40
  centerPanelPercent.value = 30
  rightPanelPercent.value = 30
}

// 响应式数据
const previewHeight = ref(66)
const timelineHeight = ref(34)
const isDragging = ref(false)

// 垂直分割器相关
const leftPanelPercent = ref(40)
const centerPanelPercent = ref(30)
const rightPanelPercent = ref(30)
const isLeftDragging = ref(false)
const isRightDragging = ref(false)

// 主内容区域分割相关
const leftContentWidth = ref(70) // 左侧内容宽度 70%
const rightPanelWidthPercent = ref(30) // 右侧面板宽度 30%
const isMainDragging = ref(false)

// 计算属性：根据聊天面板显示状态调整左侧宽度
const computedLeftContentWidth = computed(() => {
  return props.isAIChatPanelVisible ? leftContentWidth.value : 100
})

const computedRightPanelWidthPercent = computed(() => {
  return props.isAIChatPanelVisible ? rightPanelWidthPercent.value : 0
})

// 监听百分比变化，自动调整
watch([leftPanelPercent, rightPanelPercent], ([newLeft, newRight]) => {
  const total = newLeft + newRight
  if (total > 80) {
    // 给中间区域至少留20%
    centerPanelPercent.value = 100 - total
  } else {
    centerPanelPercent.value = Math.max(20, 100 - total)
  }
})

let startY = 0
let startPreviewHeight = 0
let startX = 0
let startLeftWidth = 0
let startRightWidth = 0
let startMainX = 0
let startLeftContentWidth = 0

// 开始拖动
const startResize = (event: MouseEvent) => {
  isDragging.value = true
  startY = event.clientY
  startPreviewHeight = previewHeight.value

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

// 处理拖动
const handleResize = (event: MouseEvent) => {
  if (!isDragging.value) return

  const deltaY = event.clientY - startY
  const container = document.querySelector('.video-preview-engine')
  const containerHeight = container ? container.clientHeight : 600
  const deltaPercent = (deltaY / containerHeight) * 100

  let newPreviewHeight = startPreviewHeight + deltaPercent

  // 限制最小和最大高度
  newPreviewHeight = Math.max(20, Math.min(80, newPreviewHeight))

  previewHeight.value = newPreviewHeight
  timelineHeight.value = 100 - newPreviewHeight
}

// 停止拖动
const stopResize = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 左侧分割器拖拽
const startLeftResize = (event: MouseEvent) => {
  isLeftDragging.value = true
  startX = event.clientX
  startLeftWidth = leftPanelPercent.value

  document.addEventListener('mousemove', handleLeftResize)
  document.addEventListener('mouseup', stopLeftResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

const handleLeftResize = (event: MouseEvent) => {
  if (!isLeftDragging.value) return

  const deltaX = event.clientX - startX
  const container = document.querySelector('.preview-section')
  const containerWidth = container ? container.clientWidth : window.innerWidth
  const availableWidth = containerWidth - SPLITTER_WIDTH * 2 // 减去两个分割条占用的宽度
  const deltaPercent = (deltaX / availableWidth) * 100

  let newLeftPercent = startLeftWidth + deltaPercent

  // 限制最小和最大百分比
  newLeftPercent = Math.max(15, Math.min(40, newLeftPercent))

  // 按比例调整其他列
  const oldLeftPercent = leftPanelPercent.value
  const percentChange = newLeftPercent - oldLeftPercent

  // 确保中间区域最小20%
  const newCenterPercent = centerPanelPercent.value - percentChange
  if (newCenterPercent >= 20) {
    centerPanelPercent.value = newCenterPercent
    leftPanelPercent.value = newLeftPercent
  } else {
    // 如果中间区域会太小，限制左侧扩展
    const maxLeftPercent = 100 - rightPanelPercent.value - 20
    leftPanelPercent.value = Math.min(maxLeftPercent, newLeftPercent)
    centerPanelPercent.value = 100 - leftPanelPercent.value - rightPanelPercent.value
  }
}

const stopLeftResize = () => {
  isLeftDragging.value = false
  document.removeEventListener('mousemove', handleLeftResize)
  document.removeEventListener('mouseup', stopLeftResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 右侧分割器拖拽
const startRightResize = (event: MouseEvent) => {
  isRightDragging.value = true
  startX = event.clientX
  startRightWidth = rightPanelPercent.value

  document.addEventListener('mousemove', handleRightResize)
  document.addEventListener('mouseup', stopRightResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

const handleRightResize = (event: MouseEvent) => {
  if (!isRightDragging.value) return

  const deltaX = event.clientX - startX
  const container = document.querySelector('.preview-section')
  const containerWidth = container ? container.clientWidth : window.innerWidth
  const availableWidth = containerWidth - SPLITTER_WIDTH * 2 // 减去两个分割条占用的宽度
  const deltaPercent = (deltaX / availableWidth) * 100

  let newRightPercent = startRightWidth - deltaPercent // 注意：右侧是反向的

  // 限制最小和最大百分比
  newRightPercent = Math.max(15, Math.min(40, newRightPercent))

  // 按比例调整其他列
  const oldRightPercent = rightPanelPercent.value
  const percentChange = newRightPercent - oldRightPercent

  // 确保中间区域最小20%
  const newCenterPercent = centerPanelPercent.value - percentChange
  if (newCenterPercent >= 20) {
    centerPanelPercent.value = newCenterPercent
    rightPanelPercent.value = newRightPercent
  } else {
    // 如果中间区域会太小，限制右侧扩展
    const maxRightPercent = 100 - leftPanelPercent.value - 20
    rightPanelPercent.value = Math.min(maxRightPercent, newRightPercent)
    centerPanelPercent.value = 100 - leftPanelPercent.value - rightPanelPercent.value
  }
}

const stopRightResize = () => {
  isRightDragging.value = false
  document.removeEventListener('mousemove', handleRightResize)
  document.removeEventListener('mouseup', stopRightResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 主分割器拖拽
const startMainResize = (event: MouseEvent) => {
  isMainDragging.value = true
  startMainX = event.clientX
  startLeftContentWidth = leftContentWidth.value

  document.addEventListener('mousemove', handleMainResize)
  document.addEventListener('mouseup', stopMainResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

const handleMainResize = (event: MouseEvent) => {
  if (!isMainDragging.value) return

  const deltaX = event.clientX - startMainX
  const container = document.querySelector('.video-preview-engine')
  const containerWidth = container ? container.clientWidth : window.innerWidth
  const deltaPercent = (deltaX / containerWidth) * 100

  let newLeftContentWidth = startLeftContentWidth + deltaPercent

  // 限制最小和最大宽度
  newLeftContentWidth = Math.max(50, Math.min(90, newLeftContentWidth))

  leftContentWidth.value = newLeftContentWidth
  rightPanelWidthPercent.value = 100 - newLeftContentWidth
}

const stopMainResize = () => {
  isMainDragging.value = false
  document.removeEventListener('mousemove', handleMainResize)
  document.removeEventListener('mouseup', stopMainResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.removeEventListener('mousemove', handleLeftResize)
  document.removeEventListener('mouseup', stopLeftResize)
  document.removeEventListener('mousemove', handleRightResize)
  document.removeEventListener('mouseup', stopRightResize)
  document.removeEventListener('mousemove', handleMainResize)
  document.removeEventListener('mouseup', stopMainResize)
})
</script>

<style scoped>
.video-preview-engine {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  padding: var(--spacing-sm);
  overflow: hidden;
}

.left-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-section {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 20%;
}

.media-library-panel {
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  min-width: 100px; /* 最小像素宽度 */
  max-width: 800px; /* 最大像素宽度 */
  overflow: hidden;
}

/* 分割器样式 - 从 common.css 迁移 */
.splitter {
  background-color: transparent;
  cursor: ew-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background-color var(--transition-fast);
  flex-shrink: 0;
}

.splitter.vertical {
  width: 8px;
  cursor: ew-resize;
}

.splitter.horizontal {
  height: 8px;
  cursor: ns-resize;
}

.splitter:hover {
  background-color: transparent;
}

.splitter.dragging {
  background-color: transparent;
}

.preview-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 200px; /* 最小像素宽度 */
  overflow: hidden;
  background-color: var(--color-bg-primary);
}

.properties-panel-container {
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  min-width: 100px; /* 最小像素宽度 */
  max-width: 800px; /* 最大像素宽度 */
  overflow: hidden;
}

.timeline-section {
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 20%;
}

.timeline-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  gap: var(--spacing-lg);
}

.timeline-loading .loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--color-bg-tertiary);
  border-top: 3px solid var(--color-accent-warning);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.timeline-loading p {
  font-size: var(--font-size-lg);
  margin: 0;
}

.clip-management-toolbar {
  /* 片段管理工具栏 */
  flex-shrink: 0;
}

.controls-section {
  height: 50px;
  width: 100%;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-large);
  display: flex;
  align-items: center;
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
  min-width: 80px;
}

.center-controls {
  flex: 1;
  display: flex;
  justify-content: center;
  background-color: var(--color-bg-secondary);
}

.right-controls {
  min-width: 80px;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--spacing-xs);
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

/* 右侧面板样式 */
.right-panel {
  flex-shrink: 0;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  min-width: 100px;
  max-width: 50%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel-header {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-primary);
  background-color: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.right-panel-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
  font-weight: 500;
}

.right-panel-content {
  flex: 1;
  padding: var(--spacing-md);
  overflow-y: auto;
  color: var(--color-text-secondary);
}
</style>
