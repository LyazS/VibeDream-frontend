<!-- DefaultContentTemplate.vue -->
<template>
  <div class="default-renderer-content" :class="{ selected: isSelected }">
    <!-- 媒体类型指示器 -->
    <div class="media-type-indicator">{{ mediaType }}</div>

    <!-- 状态指示器 -->
    <div class="status-indicator">{{ timelineStatus }}</div>

    <!-- 项目名称 -->
    <div class="item-name">{{ displayName }}</div>

    <!-- 简化信息（小尺寸时显示） -->
    <div v-if="!showDetails" class="simple-info">
      <div class="simple-media-type">{{ shortMediaType }}</div>
      <div class="simple-status">{{ shortStatus }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ContentTemplateProps } from '@/core/types/clipRenderer'
import { getTimelineItemDisplayName } from '@/core/utils/clipUtils'

const props = defineProps<ContentTemplateProps>()

// 计算属性
const showDetails = computed(() => {
  const durationFrames =
    props.data.timeRange.timelineEndTime - props.data.timeRange.timelineStartTime
  return durationFrames >= 24 // 大约0.8秒的片段显示详细信息
})

const displayName = computed(() => getTimelineItemDisplayName(props.data))

const mediaType = computed(() => props.data.mediaType)

const timelineStatus = computed(() => props.data.timelineStatus)

const shortMediaType = computed(() => {
  const typeMap: Record<string, string> = {
    video: 'V',
    image: 'I',
    audio: 'A',
  }
  return typeMap[props.data.mediaType] || props.data.mediaType.charAt(0).toUpperCase()
})

const shortStatus = computed(() => {
  const statusMap: Record<string, string> = {
    ready: '✓',
    loading: '⏳',
    error: '❌',
  }
  return statusMap[props.data.timelineStatus] || props.data.timelineStatus.charAt(0).toUpperCase()
})
</script>

<style scoped>
.default-renderer-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 4px 8px;
  gap: 2px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(128, 128, 128, 0.2);
  border-radius: var(--border-radius-medium);
}

.default-renderer-content.selected {
  background: linear-gradient(135deg, var(--color-clip-selected), var(--color-clip-selected-dark));
}

.media-type-indicator {
  font-weight: bold;
  color: white;
  text-transform: uppercase;
  font-size: 9px;
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 4px;
  border-radius: 2px;
}

.status-indicator {
  font-size: 8px;
  opacity: 0.7;
  color: var(--color-status-indicator);
  text-transform: uppercase;
}

.item-name {
  font-size: 9px;
  color: white;
  text-align: center;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.simple-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
}

.simple-media-type {
  background: rgba(0, 0, 0, 0.5);
  color: white;
  padding: 1px 3px;
  border-radius: 2px;
  font-weight: bold;
  min-width: 12px;
  text-align: center;
}

.simple-status {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  padding: 1px 3px;
  border-radius: 2px;
  min-width: 12px;
  text-align: center;
}

/* 状态颜色 */
.default-renderer-content[data-timeline-status='ready'] .status-indicator {
  color: var(--color-status-ready);
}

.default-renderer-content[data-timeline-status='loading'] .status-indicator {
  color: var(--color-status-loading);
  animation: pulse 1.5s infinite;
}

.default-renderer-content[data-timeline-status='error'] .status-indicator {
  color: var(--color-status-error);
}

/* 媒体类型颜色 */
.default-renderer-content[data-media-type='video'] .media-type-indicator {
  background: rgba(255, 107, 53, 0.3);
}

.default-renderer-content[data-media-type='image'] .media-type-indicator {
  background: rgba(66, 133, 244, 0.3);
}

.default-renderer-content[data-media-type='audio'] .media-type-indicator {
  background: rgba(123, 31, 162, 0.3);
}


@keyframes pulse {
  0% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.7;
  }
}
</style>
