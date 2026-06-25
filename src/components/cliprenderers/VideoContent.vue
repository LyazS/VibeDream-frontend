<!-- VideoContentTemplate.vue - 多缩略图版本 -->
<template>
  <div class="video-content" :class="{ selected: isSelected }">
    <!-- 多缩略图容器 - 添加了拖拽事件处理 -->
    <div
      class="multi-thumbnails-container"
      :style="{
        height: `${THUMBNAIL_CONSTANTS.HEIGHT}px`,
        top: `${THUMBNAIL_CONSTANTS.TOP_OFFSET}px`,
      }"
      @dragstart.stop.prevent="handleInnerDrag"
    >
      <div
        v-for="item in thumbnailLayout"
        :key="item.index"
        class="thumbnail-slot"
        :style="getThumbnailSlotStyle(item)"
      >
        <!-- 实时生成的缩略图 - 阻止拖拽行为 -->
        <img
          v-if="getThumbnailUrl(item)"
          :src="getThumbnailUrl(item)!"
          class="thumbnail-image"
          :draggable="false"
          @mousedown.stop
          @dragstart.stop.prevent
        />
        <div v-else class="thumbnail-placeholder">
          <!-- 生成中的加载状态 -->
          <div class="loading-spinner"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, ref } from 'vue'
import type { ContentTemplateProps } from '@/core/types/clipRenderer'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  calculateThumbnailLayout,
  filterThumbnailVisible,
  calculateClipWidthPixels,
} from '@/core/utils/thumbnailLayout'
import type { ThumbnailLayoutItem } from '@/core/types/thumbnail'
import { THUMBNAIL_CONSTANTS } from '@/constants/ThumbnailConstants'
import { isImageTimelineItem } from '@/core/timelineitem/queries'

const props = defineProps<ContentTemplateProps<'video' | 'image'>>()
const unifiedStore = useUnifiedStore()

// 缩略图布局数组
const thumbnailLayout = computed<ThumbnailLayoutItem[]>(() => {
  const timeRange = props.data.timeRange
  const clipTLStartFrame = timeRange.timelineStartTime
  const clipTLDurationFrames = timeRange.timelineEndTime - clipTLStartFrame
  const clipStartFrame = timeRange.clipStartTime
  const clipDurationFrames = timeRange.clipEndTime - clipStartFrame

  // 计算clip的像素宽度
  const clipWidthPixels = calculateClipWidthPixels(
    clipTLDurationFrames,
    props.timelineWidth,
    unifiedStore.totalDurationFrames,
    unifiedStore.zoomLevel,
  )

  // 使用传入的视口帧范围
  const viewportStartFrame = props.viewportFrameRange.startFrames
  const viewportEndFrame = props.viewportFrameRange.endFrames

  // 计算初始布局
  const layout = calculateThumbnailLayout(
    clipStartFrame,
    clipDurationFrames,
    clipWidthPixels,
    clipTLStartFrame,
    clipTLDurationFrames,
    THUMBNAIL_CONSTANTS.WIDTH, // 固定缩略图宽度
  )

  // 过滤可见的缩略图
  return filterThumbnailVisible(
    layout,
    props.renderFrame?.timeRange.timelineStartTime ?? clipTLStartFrame,
    props.renderFrame?.durationFrames ?? clipTLDurationFrames,
    viewportStartFrame,
    viewportEndFrame,
  )
})

// 获取缩略图槽位样式
function getThumbnailSlotStyle(item: ThumbnailLayoutItem) {
  return {
    left: `${props.renderFrame?.frameToLocalPixel(item.timelineFramePosition) ?? item.pixelPosition}px`,
    width: `${THUMBNAIL_CONSTANTS.WIDTH}px`,
    height: `${THUMBNAIL_CONSTANTS.HEIGHT}px`,
  }
}

// 获取缩略图URL
function getThumbnailUrl(item: ThumbnailLayoutItem): string | null {
  // 使用全局缓存系统
  // 对于图片类型，使用固定缓存键（帧位置、clipStartTime、clipEndTime都为0）
  // 对于视频类型，使用实际参数
  if (isImageTimelineItem(props.data)) {
    return unifiedStore.getThumbnailUrl(
      props.data.id,
      0, // 图片使用固定帧位置0
      0, // 图片使用固定clipStartTime 0
      0, // 图片使用固定clipEndTime 0
    )
  } else {
    return unifiedStore.getThumbnailUrl(
      props.data.id,
      item.framePosition,
      props.data.timeRange.clipStartTime,
      props.data.timeRange.clipEndTime,
    )
  }
}

// 监听布局变化触发批量生成
watch(
  thumbnailLayout,
  (newLayout) => {
    // 取消旧任务
    unifiedStore.cancelThumbnailTasks(props.data.id)

    // 过滤未缓存的项目
    const uncachedItems = newLayout.filter((item) => {
      // 检查全局缓存
      // 对于图片类型，使用固定缓存键（帧位置、clipStartTime、clipEndTime都为0）
      // 对于视频类型，使用实际参数
      let cachedUrl: string | null
      if (isImageTimelineItem(props.data)) {
        cachedUrl = unifiedStore.getThumbnailUrl(
          props.data.id,
          0, // 图片使用固定帧位置0
          0, // 图片使用固定clipStartTime 0
          0, // 图片使用固定clipEndTime 0
        )
      } else {
        cachedUrl = unifiedStore.getThumbnailUrl(
          props.data.id,
          item.framePosition,
          props.data.timeRange.clipStartTime,
          props.data.timeRange.clipEndTime,
        )
      }
      return !cachedUrl
    })

    if (uncachedItems.length > 0) {
      // 提交新请求到定时处理队列
      unifiedStore.requestThumbnails({
        timelineItemId: props.data.id,
        thumbnailLayout: uncachedItems,
        timestamp: Date.now(),
      })
    }
  },
  { deep: true, immediate: true },
)

/**
 * 处理内部元素的拖拽事件 - 阻止浏览器默认行为
 * 确保拖拽时显示整个clip的预览，而不是单个缩略图
 */
function handleInnerDrag(event: DragEvent) {
  // 阻止内部元素的拖拽行为，让整个clip处理拖拽
  event.preventDefault()
  event.stopPropagation()
  // 返回false阻止默认拖拽行为
  return false
}
</script>

<style scoped>
/* 多缩略图容器样式 */
.multi-thumbnails-container {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.thumbnail-slot {
  position: absolute;
  width: 50px;
  top: 0;
  overflow: hidden;
  background-color: rgba(0, 0, 0, 0.3);
}

.thumbnail-slot:last-child {
  border-right: none;
}

.thumbnail-frame-index {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: bold;
  color: white;
  background-color: rgba(0, 0, 0, 0.5);
}

/* 保持原有样式（向后兼容） */
.video-content {
  display: flex;
  align-items: center;
  height: 100%;
  overflow: hidden;
  border-radius: var(--border-radius-medium);
}

.overlay-info {
  position: absolute;
  top: 4px;
  left: 8px;
  right: 8px;
  pointer-events: none;
  z-index: 10;
}

.clip-name {
  font-size: 11px;
  font-weight: bold;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.clip-duration {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.8);
}

.clip-speed {
  font-size: 9px;
  color: var(--color-speed-indicator);
  font-weight: bold;
}

.clip-simple {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.simple-duration {
  font-size: 10px;
  font-weight: bold;
  color: white;
  background-color: rgba(0, 0, 0, 0.3);
  padding: 2px 4px;
  border-radius: 2px;
  white-space: nowrap;
}

/* 选中状态样式 */
.video-content.selected {
  background: linear-gradient(135deg, var(--color-clip-selected), var(--color-clip-selected-dark));
}
</style>
