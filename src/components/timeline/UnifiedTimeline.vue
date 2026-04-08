<template>
  <div class="timeline" @click="handleTimelineContainerClick" @contextmenu="handleContextMenu">
    <!-- 顶部区域：轨道管理器头部 + 时间刻度 -->
    <div class="timeline-header">
      <div class="track-manager-header">
        <h3>{{ t('timeline.tracks') }}</h3>
        <HoverButton
          variant="small"
          @click="showAddTrackMenu($event)"
          :title="t('timeline.addNewTrack')"
        >
          <template #icon>
            <component :is="IconComponents.ADD" size="16px" />
          </template>
        </HoverButton>
      </div>
      <div
        class="timeline-scale"
        ref="scaleContainer"
        @wheel="handleTimeScaleWheel"
        @click="handleTimeScaleClick"
        @mousedown="handleTimeScaleMouseDown"
        @mousemove="handleTimeScaleMouseMove"
        @mouseup="handleTimeScaleMouseUp"
      >
        <!-- 时间刻度标记 -->
        <div
          v-for="mark in timeMarks"
          :key="mark.time"
          class="time-mark"
          :style="{ left: mark.position + 'px' }"
        >
          <div class="mark-line" :class="{ major: mark.isMajor }"></div>
          <div v-if="mark.isMajor" class="mark-label">
            {{ formatTime(mark.time) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 主体区域：每个轨道一行，包含左侧控制和右侧内容 -->
    <n-scrollbar>
      <div
        class="timeline-body"
        ref="timelineBody"
        @wheel="handleWheel"
        @dragover="handleTimelineDragOver"
        @drop="handleTimelineDrop"
        @dragleave="handleTimelineDragLeave"
        @dragend="handleTimelineDragEnd"
      >
        <!-- 每个轨道一行 -->
        <div
          v-for="track in tracks"
          :key="track.id"
          class="track-row"
          :style="{ height: track.height + 'px' }"
        >
          <!-- 左侧轨道控制 -->
          <div
            class="track-controls"
            :class="{
              'drag-over': dragOverTrackId === track.id,
              'drag-over-before': dragOverTrackId === track.id && insertPosition === 'before',
              'drag-over-after': dragOverTrackId === track.id && insertPosition === 'after'
            }"
            :data-track-id="track.id"
            @dragover="handleTrackDragOver($event, track.id)"
            @drop="handleTrackDrop($event, track.id)"
            @dragleave="handleTrackDragLeave($event, track.id)"
          >
            <!-- 拖拽提示蒙版 -->
            <div
              v-if="dragOverTrackId === track.id"
              class="drag-hint-overlay"
              :class="insertPosition"
            >
              <div class="drag-hint-text">
                {{ insertPosition === 'before' ? t('common.trackDrag.dragToTop') : t('common.trackDrag.dragToBottom') }}
              </div>
            </div>

            <!-- 轨道颜色标识 -->
            <div class="track-color-indicator" :class="`track-color-${track.type}`"></div>

            <!-- 轨道名称 -->
            <div class="track-name">
              <!-- 拖拽手柄图标 -->
              <div
                class="track-drag-handle"
                :class="{ 'dragging': draggingTrackId === track.id }"
                draggable="true"
                @dragstart="handleTrackDragStart($event, track.id)"
                @dragend="handleTrackDragEnd"
                :title="t('common.trackDrag.dragHandle')"
              >
                <component :is="IconComponents.DRAGGABLE" size="24px" />
              </div>

              <input
                v-if="editingTrackId === track.id"
                v-model="editingTrackName"
                @blur="finishRename"
                @keyup.enter="finishRename"
                @keyup.escape="cancelRename"
                class="track-name-input"
                :ref="
                  (el) => {
                    if (el) nameInputs[track.id] = el as HTMLInputElement
                  }
                "
              />
              <span
                v-else
                @dblclick="startRename(track)"
                class="track-name-text"
                :title="track.name"
              >
                {{ track.name }}
              </span>
            </div>

            <div class="track-buttons">
              <!-- 轨道类型图标和片段数量 -->
              <div
                class="track-type-info"
                :title="`${t('timeline.' + track.type + 'Track')}，${t('timeline.clips')} ${getClipsForTrack(track.id).length}`"
              >
                <div class="track-type-icon">
                  <component :is="getTrackTypeIcon(track.type)" size="14px" />
                </div>
                <div class="clip-count">
                  {{ getClipsForTrack(track.id).length }}
                </div>
              </div>

              <!-- 轨道快捷操作按钮 -->
              <div class="track-status">
                <!-- 可见性切换按钮 - 音频轨道不显示 -->
                <HoverButton
                  v-if="track.type !== 'audio'"
                  variant="small"
                  :class="track.isVisible ? 'active' : ''"
                  :title="track.isVisible ? t('timeline.hideTrack') : t('timeline.showTrack')"
                  @click="toggleVisibility(track.id)"
                >
                  <template #icon>
                    <component :is="getVisibilityIcon(track.isVisible)" size="14px" />
                  </template>
                </HoverButton>

                <!-- 静音切换按钮 - 文本轨道不显示 -->
                <HoverButton
                  v-if="track.type !== 'text'"
                  variant="small"
                  :class="!track.isMuted ? 'active' : ''"
                  :title="track.isMuted ? t('timeline.unmuteTrack') : t('timeline.muteTrack')"
                  @click="toggleMute(track.id)"
                >
                  <template #icon>
                    <component :is="getMuteIcon(track.isMuted)" size="14px" />
                  </template>
                </HoverButton>
              </div>
            </div>
          </div>

          <!-- 右侧轨道内容区域 -->
          <div
            class="track-content"
            :class="{
              'track-hidden': !track.isVisible,
              [`track-type-${track.type}`]: true,
            }"
            :data-track-id="track.id"
            :data-track-type="track.type"
            :data-hidden-text="!track.isVisible ? t('timeline.trackHidden') : ''"
            @click="handleTimelineClick"
            @wheel="handleWheel"
          >
            <!-- 该轨道的时间轴项目 -->
            <component
              v-for="item in getClipsForTrack(track.id)"
              :key="item.id"
              :is="renderTimelineItem(item, track)"
            />
            <UnifiedTimelineTransitionOverlay
              v-for="overlay in getTransitionOverlaysForTrack(track.id)"
              :key="overlay.selectionId"
              :overlay="overlay"
              :track-height="track.height"
              :timeline-width="unifiedStore.TimelineContentWidth"
              @select="handleSelectTransition"
              @contextmenu="handleTransitionContextMenu"
              @updateSnapResult="handleTransitionOverlaySnapResult"
            />
          </div>
        </div>

        <!-- 时间轴背景网格 -->
        <div class="timeline-grid">
          <div
            v-for="line in gridLines"
            :key="line.time"
            class="grid-line"
            :class="{ 'frame-line': line.isFrame }"
            :style="{
              left:
                LayoutConstants.TRACK_CONTROL_WIDTH +
                unifiedStore.frameToPixel(line.time, unifiedStore.TimelineContentWidth) +
                'px',
            }"
          ></div>
        </div>
      </div>
    </n-scrollbar>
    <!-- 吸附指示器 - 贯穿整个时间轴区域 -->
    <div class="snap-indicator-container">
      <UnifiedSnapIndicator
        :snap-result="currentSnapResult"
        :timeline-width="unifiedStore.TimelineContentWidth"
        :total-duration-frames="unifiedStore.totalDurationFrames"
        :zoom-level="unifiedStore.zoomLevel"
        :scroll-offset="unifiedStore.scrollOffset"
      />
    </div>

    <!-- 全局播放头组件 - 覆盖整个时间轴 -->
    <UnifiedPlayhead
      :timeline-width="unifiedStore.TimelineContentWidth"
      :track-control-width="LayoutConstants.TRACK_CONTROL_WIDTH"
      :wheel-container="timelineBody"
    />
  </div>

  <!-- 统一右键菜单 -->
  <ContextMenu v-model:show="showContextMenu" :options="contextMenuOptions">
    <template v-for="(item, index) in currentMenuItems" :key="index">
      <ContextMenuSeparator v-if="'type' in item && item.type === 'separator'" />
      <ContextMenuItem
        v-else-if="'label' in item && 'onClick' in item"
        :label="item.label"
        @click="item.onClick"
      >
        <template #icon>
          <component
            :is="item.icon"
            size="14px"
            :color="item.icon === IconComponents.DELETE ? '#ff6b6b' : undefined"
          />
        </template>
      </ContextMenuItem>
      <ContextMenuGroup v-else-if="'label' in item && 'children' in item" :label="item.label">
        <template #icon>
          <component :is="item.icon" size="14px" />
        </template>
        <template v-for="(child, childIndex) in item.children" :key="childIndex">
          <ContextMenuSeparator v-if="'type' in child && child.type === 'separator'" />
          <ContextMenuItem
            v-else-if="'label' in child && 'onClick' in child"
            :label="child.label"
            @click="child.onClick"
          >
            <template #icon>
              <component :is="child.icon" size="14px" />
            </template>
          </ContextMenuItem>
        </template>
      </ContextMenuGroup>
    </template>
  </ContextMenu>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, h, computed } from 'vue'
import { calculateViewportFrameRange } from '@/core/utils/thumbnailLayout'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { NScrollbar } from 'naive-ui'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import type { SnapResultState } from '@/core/composables/useTimelineSnap'

import UnifiedPlayhead from '@/components/timeline/UnifiedPlayhead.vue'
import UnifiedTimelineClip from '@/components/timeline/UnifiedTimelineClip.vue'
import UnifiedTimelineTransitionOverlay from '@/components/timeline/UnifiedTimelineTransitionOverlay.vue'
import UnifiedSnapIndicator from '@/components/timeline/UnifiedSnapIndicator.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuGroup,
} from '@imengyu/vue3-context-menu'
import {
  IconComponents,
  getTrackTypeIcon,
  getVisibilityIcon,
  getMuteIcon,
  getTrackTypeLabel,
} from '@/constants/iconComponents'
import { LayoutConstants } from '@/constants/LayoutConstants'
// 导入创建的模块
import { useTimelineTrackManagement } from '@/core/composables/useTimelineTrackManagement'
import { useTimelineContextMenu } from '@/core/composables/useTimelineContextMenu'
import { useTimelineItemOperations } from '@/core/composables/useTimelineItemOperations'
import { useTimelineEventHandlers } from '@/core/composables/useTimelineEventHandlers'
import { useTimelineGridLines } from '@/core/composables/useTimelineGridLines'
import { useTimelineTimeScale } from '@/core/composables/useTimelineTimeScale'
import { useTimelineDragPreview } from '@/core/composables/useTimelineDragPreview'
import { useTimelineSnap } from '@/core/composables/useTimelineSnap'
import { useTimelineDragHandlers } from '@/core/composables/useTimelineDragHandlers'
import { buildClipSelectionId } from '@/core/types/timelineSelection'

// Component name for Vue DevTools
defineOptions({
  name: 'CleanTimeline',
})

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 计算视口帧范围
const viewportFrameRange = computed(() => {
  return calculateViewportFrameRange(
    unifiedStore.TimelineContentWidth,
    unifiedStore.totalDurationFrames,
    unifiedStore.zoomLevel,
    unifiedStore.scrollOffset,
    unifiedStore.maxVisibleDurationFrames,
  )
})

const timelineBody = ref<HTMLElement>()

// 时间刻度相关变量
const scaleContainer = ref<HTMLElement>()

// 初始化时间刻度模块
const {
  timeMarks,
  formatTime,
  updateContainerWidth,
  handleTimeScaleClick,
  handleTimeScaleMouseDown,
  handleTimeScaleMouseMove,
  handleTimeScaleMouseUp,
  handleTimeScaleWheel,
} = useTimelineTimeScale(scaleContainer)

// 初始化项目操作模块
const {
  createTimelineItemFromMediaItem,
  moveSingleItem,
  moveMultipleItems,
  handleTimelineItemRemove,
  createTextAtPosition,
} = useTimelineItemOperations()

// 初始化轨道管理模块
const {
  tracks,
  editingTrackId,
  editingTrackName,
  nameInputs,
  addNewTrack,
  toggleVisibility,
  toggleMute,
  autoArrangeTrack,
  startRename,
  finishRename,
  cancelRename,
  removeTrack,
  getClipsForTrack,
} = useTimelineTrackManagement()

// 轨道拖拽排序状态
const draggingTrackId = ref<string | null>(null)
const dragOverTrackId = ref<string | null>(null)
const insertPosition = ref<'before' | 'after' | null>(null)

// 初始化右键菜单模块
const {
  showContextMenu,
  contextMenuType,
  contextMenuTarget,
  contextMenuOptions,
  currentMenuItems,
  handleContextMenu,
  handleTimelineItemContextMenu,
  handleTransitionContextMenu,
  removeClip,
  duplicateClip,
  renameTrack,
  showAddTrackMenu,
} = useTimelineContextMenu(
  addNewTrack,
  toggleVisibility,
  toggleMute,
  autoArrangeTrack,
  startRename,
  removeTrack,
  handleTimelineItemRemove,
  createTextAtPosition,
  tracks,
  getClipsForTrack,
  timelineBody,
)

// 初始化事件处理模块
const {
  handleTimelineContainerClick,
  handleWheel,
  handleTimelineClick,
  handleSelectClip,
  handleTimelineItemDoubleClick,
  handleTimelineItemResizeStart,
  handleKeyDown,
} = useTimelineEventHandlers(timelineBody, handleTimelineItemRemove)

// 初始化网格线模块
const { gridLines } = useTimelineGridLines()

// 初始化拖拽预览模块
const { handleDragPreview, hidePreview } = useTimelineDragPreview({
  frameToPixel: (frames: number) => unifiedStore.frameToPixel(frames, unifiedStore.TimelineContentWidth),
  getCurrentDragData: (event: DragEvent) => unifiedStore.getCurrentDragData(event),
  getMediaItem: (id: string) => unifiedStore.getMediaItem(id),
  getTimelineItemsByTrack: (trackId: string) => unifiedStore.getTimelineItemsByTrack(trackId),
  getTrack: (trackId: string) => unifiedStore.getTrack(trackId),
})

// 初始化吸附模块
const {
  currentSnapResult,
  calculateSnapPosition,
  updateSnapIndicator,
  clearSnapIndicator,
  calculateMouseXInTimeline,
} = useTimelineSnap()

// 初始化拖拽处理模块
const {
  handleTimelineDragOver,
  handleTimelineDrop,
  handleTimelineDragLeave,
  handleTimelineDragEnd,
} = useTimelineDragHandlers(
  timelineBody,
  {
    calculateSnapPosition,
    updateSnapIndicator,
    clearSnapIndicator,
    calculateMouseXInTimeline,
  },
  {
    handleDragPreview,
    hidePreview,
  },
)

function getTransitionOverlaysForTrack(trackId: string) {
  return unifiedStore.getTransitionOverlaysByTrack(trackId)
}

function handleTransitionOverlaySnapResult(snapResult: SnapResultState | null) {
  currentSnapResult.value = snapResult
}

// 类型安全的时间轴项目渲染函数 - 优化版本，仅传递必要状态
function renderTimelineItem(item: UnifiedTimelineItemData, track: UnifiedTrackData) {
  const commonProps = {
    // CleanTimelineClip 需要的核心属性
    data: item,
    isSelected: unifiedStore.isTimelineSelectionSelected(buildClipSelectionId(item.id)),
    isMultiSelected: unifiedStore.isTimelineSelectionMultiSelectMode,
    trackHeight: track.height,
    timelineWidth: unifiedStore.TimelineContentWidth,
    viewportFrameRange: viewportFrameRange.value,
    // 事件处理
    onSelect: (event: MouseEvent, id: string) => handleSelectClip(event, id),
    onDoubleClick: (id: string) => handleTimelineItemDoubleClick(id),
    onContextMenu: (event: MouseEvent, id: string) => handleTimelineItemContextMenu(event, id),
    onResizeStart: handleTimelineItemResizeStart,
    // 监听吸附结果更新（用于resize期间的吸附指示器）
    onUpdateSnapResult: (snapResult: SnapResultState) => {
      currentSnapResult.value = snapResult
    },
  }

  // 使用统一的 UnifiedTimelineClip 组件
  return h(UnifiedTimelineClip, commonProps)
}

function handleSelectTransition(event: MouseEvent, selectionId: string) {
  if (event.ctrlKey || event.metaKey) {
    unifiedStore.selectTimelineSelections([selectionId as any], 'toggle')
    return
  }

  unifiedStore.selectTimelineSelections([selectionId as any], 'replace')
}

// ========== 轨道拖拽排序 ==========

/**
 * 处理轨道拖拽开始
 */
function handleTrackDragStart(event: DragEvent, trackId: string) {
  draggingTrackId.value = trackId

  // 设置拖拽数据（必需）
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', trackId)
  }

  console.log('🎵 开始拖拽轨道:', trackId)
}

/**
 * 处理轨道拖拽结束
 */
function handleTrackDragEnd() {
  draggingTrackId.value = null
  dragOverTrackId.value = null
  insertPosition.value = null

  console.log('✅ 结束拖拽轨道')
}

/**
 * 处理拖拽悬停
 */
function handleTrackDragOver(event: DragEvent, targetTrackId: string) {
  event.preventDefault() // 允许放置

  // 不允许拖拽到自己身上
  if (draggingTrackId.value === targetTrackId) {
    return
  }

  // 计算插入位置（根据鼠标Y坐标）
  const targetElement = event.currentTarget as HTMLElement
  const rect = targetElement.getBoundingClientRect()
  const relativeY = event.clientY - rect.top
  const position: 'before' | 'after' = relativeY < rect.height / 2 ? 'before' : 'after'

  dragOverTrackId.value = targetTrackId
  insertPosition.value = position

  // 设置放置效果
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

/**
 * 处理拖拽放置
 */
async function handleTrackDrop(event: DragEvent, targetTrackId: string) {
  event.preventDefault()

  const sourceTrackId = draggingTrackId.value
  if (!sourceTrackId || sourceTrackId === targetTrackId) {
    handleTrackDragEnd()
    return
  }

  // 获取所有轨道
  const allTracks = tracks.value

  // 找到源轨道和目标轨道的当前位置
  const fromIndex = allTracks.findIndex((t) => t.id === sourceTrackId)
  const toIndex = allTracks.findIndex((t) => t.id === targetTrackId)

  if (fromIndex === -1 || toIndex === -1) {
    console.error('❌ 找不到轨道')
    handleTrackDragEnd()
    return
  }

  // 计算新位置
  let newPosition = toIndex
  if (insertPosition.value === 'after') {
    newPosition = toIndex + 1
  }

  // 如果从目标前面移动到后面，需要调整索引
  if (fromIndex < newPosition) {
    newPosition -= 1
  }

  // 使用历史记录执行移动
  try {
    await unifiedStore.moveTrackWithHistory(sourceTrackId, newPosition)

    console.log('✅ 轨道移动完成:', {
      from: fromIndex,
      to: newPosition,
      insertPosition: insertPosition.value,
    })
  } catch (error) {
    console.error('❌ 轨道移动失败:', error)
  }

  handleTrackDragEnd()
}

/**
 * 处理拖拽离开
 */
function handleTrackDragLeave(event: DragEvent, trackId: string) {
  const targetElement = event.currentTarget as HTMLElement
  const rect = targetElement.getBoundingClientRect()
  const x = event.clientX
  const y = event.clientY

  // 只有当鼠标真正离开元素边界时才清除状态
  // 防止子元素触发 dragleave 事件
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    dragOverTrackId.value = null
    insertPosition.value = null
  }
}

// ResizeObserver 实例
let resizeObserver: ResizeObserver | null = null

// 生命周期钩子
onMounted(() => {
  updateContainerWidth()

  // 使用 ResizeObserver 监听组件自身尺寸变化
  if (scaleContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerWidth()
    })
    resizeObserver.observe(scaleContainer.value)
  }

  window.addEventListener('keydown', handleKeyDown)

  if (scaleContainer.value) {
    scaleContainer.value.addEventListener('wheel', handleTimeScaleWheel, { passive: false })
  }
})

onUnmounted(() => {
  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  window.removeEventListener('keydown', handleKeyDown)

  if (scaleContainer.value) {
    scaleContainer.value.removeEventListener('wheel', handleTimeScaleWheel)
  }

  // 清理预览元素
  hidePreview()
})
</script>

<style scoped>
.timeline {
  flex: 1;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.timeline-scale {
  flex: 1;
  height: 40px;
  background-color: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-bg-quaternary);
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.time-mark {
  position: absolute;
  top: 0;
  height: 100%;
  pointer-events: none;
}

.mark-line {
  width: 1px;
  background-color: var(--color-border-secondary);
  height: 10px;
  margin-top: 30px;
}

.mark-line.major {
  background-color: var(--color-text-hint);
  height: 20px;
  margin-top: 20px;
}

.mark-label {
  position: absolute;
  top: 5px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: #ccc;
  white-space: nowrap;
  font-family: monospace;
}

.timeline-header {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-primary);
}

.track-manager-header {
  width: var(--track-control-width, 150px);
  padding: var(--spacing-md);
  background-color: var(--color-bg-tertiary);
  border-right: 1px solid var(--color-border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.track-manager-header h3 {
  margin: 0;
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
}

.timeline-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

.track-row {
  display: flex;
  border-bottom: 1px solid var(--color-border-primary);
}

.track-controls {
  width: var(--track-control-width, 150px);
  background-color: var(--color-bg-tertiary);
  border-right: 1px solid var(--color-border-primary);
  padding: var(--spacing-sm) var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

/* 轨道颜色标识 */
.track-color-indicator {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 0 2px 2px 0;
  transition: all var(--transition-fast);
}

/* 拖拽悬停时高亮轨道颜色标识 - 过渡成纯绿色 */
.track-controls.drag-over .track-color-indicator {
  width: 6px;
  background: #22c55e;
  box-shadow: 6px 0 6px -2px rgba(255, 255, 255, 0.8),
              4px 0 4px -2px rgba(255, 255, 255, 0.6);
  opacity: 1;
}

.track-color-indicator.track-color-video {
  background: linear-gradient(135deg, #5a6d90, #4a5d80);
}

.track-color-indicator.track-color-audio {
  background: linear-gradient(135deg, #5d905d, #4d804d);
}

.track-color-indicator.track-color-text {
  background: linear-gradient(135deg, #805b90, #704b80);
}

.track-content {
  flex: 1;
  position: relative;
  background-color: var(--color-bg-secondary);
  overflow: hidden;
}

.track-content:hover {
  background-color: var(--color-bg-tertiary);
}

/* 隐藏轨道样式 */
.track-content.track-hidden {
  background-color: var(--color-bg-quaternary);
  opacity: 0.6;
  position: relative;
}

.track-content.track-hidden::before {
  content: attr(data-hidden-text);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  pointer-events: none;
  z-index: 1;
  background-color: rgba(0, 0, 0, 0.7);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-small);
  white-space: nowrap;
}

.track-content.track-hidden:hover {
  background-color: var(--color-bg-quaternary);
  opacity: 0.8;
}

.track-name {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.track-type-info {
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  border-radius: var(--border-radius-small);
  border: 1px solid rgba(156, 163, 175, 0.3);
  overflow: hidden;
}

.track-type-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 0;
  background-color: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
  flex-shrink: 0;
  border: none;
}

.track-name-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  display: block;
  padding: 2px var(--spacing-xs);
  border-radius: 2px;
  transition: background-color var(--transition-fast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-name-text:hover {
  background-color: var(--color-bg-quaternary);
}

.track-name-input {
  background: var(--color-bg-quaternary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 2px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: 2px var(--spacing-xs);
  width: 100%;
}

.track-buttons {
  display: flex;
  gap: var(--spacing-xs);
  justify-content: flex-start;
}

.track-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.status-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: var(--border-radius-small);
  background-color: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.status-btn:hover {
  background-color: rgba(156, 163, 175, 0.15);
  border-color: rgba(156, 163, 175, 0.3);
  color: #d1d5db;
}

.status-btn.active {
  background-color: rgba(156, 163, 175, 0.25);
  border-color: rgba(156, 163, 175, 0.4);
  color: #f3f4f6;
}

.status-btn.active:hover {
  background-color: rgba(156, 163, 175, 0.35);
  border-color: rgba(156, 163, 175, 0.5);
  color: #ffffff;
}

.clip-count {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 0;
  background-color: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
  border: none;
}

.timeline-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
}

.grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: var(--color-bg-quaternary);
  opacity: 0.5;
}

.grid-line.frame-line {
  background-color: var(--color-border-secondary);
  opacity: 0.3;
  width: 1px;
}

/* 吸附指示器容器 - 贯穿整个时间轴区域 */
.snap-indicator-container {
  position: absolute;
  top: 0;
  left: var(--track-control-width, 150px);
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1000;
}

.snap-indicator-line {
  background-image: linear-gradient(to bottom, #22c55e, #22c55e);
  box-shadow: 0 0 2px rgba(34, 197, 94, 0.5);
}

/* ========== 轨道拖拽排序样式 ========== */

/* 拖拽手柄样式 */
.track-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  cursor: grab;
  color: #9ca3af;
  border-radius: 4px;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.track-drag-handle:hover {
  background-color: rgba(156, 163, 175, 0.25);
  color: #6b7280;
}

.track-drag-handle.dragging {
  opacity: 0.5;
  cursor: grabbing;
}


/* 拖拽提示蒙版 */
.drag-hint-overlay {
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1001;
  animation: fadeIn 0.15s ease-out;
}

.drag-hint-overlay.before {
  top: 0;
}

.drag-hint-overlay.after {
  bottom: 0;
}

.drag-hint-text {
  background-color: rgba(34, 197, 94, 0.95);
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 插入指示器线条 */
.track-controls.drag-over::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background-color: #22c55e;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
}
</style>
