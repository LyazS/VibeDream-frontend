<template>
  <div class="unified-clip-properties">
    <!-- 基本信息 - 非文本类型显示 -->
    <BasicInfoSection
      v-if="selectedTimelineItem && !isTextTimelineItem(selectedTimelineItem)"
      :selected-timeline-item="selectedTimelineItem"
      :show-resolution="selectedTimelineItem ? hasVisualProperties(selectedTimelineItem) : false"
    />

    <!-- 播放设置 -->
    <PlaybackSettingsSection
      v-if="selectedTimelineItem"
      :selected-timeline-item="selectedTimelineItem"
      :show-speed-control="showSpeedControl"
    />

    <!-- 文本属性组 - 仅 text（包含文本内容编辑） -->
    <TextPropertiesGroup
      v-if="selectedTimelineItem && isTextTimelineItem(selectedTimelineItem)"
      :selected-timeline-item="selectedTimelineItem"
      :current-frame="currentFrame"
    />

    <!-- 视觉属性组 - video/image/text -->
    <VisualPropertiesGroup
      v-if="selectedTimelineItem && hasVisualProperties(selectedTimelineItem)"
      :selected-timeline-item="selectedTimelineItem"
      :current-frame="currentFrame"
    />

    <!-- 音频属性组 - video/audio -->
    <AudioPropertiesGroup
      v-if="selectedTimelineItem && hasAudioProperties(selectedTimelineItem)"
      :selected-timeline-item="selectedTimelineItem"
      :current-frame="currentFrame"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  hasVisualProperties,
  hasAudioProperties,
  isTextTimelineItem,
  isVideoTimelineItem,
  isAudioTimelineItem,
} from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

import BasicInfoSection from './BasicInfoSection.vue'
import PlaybackSettingsSection from './PlaybackSettingsSection.vue'
import TextPropertiesGroup from '../groups/TextPropertiesGroup.vue'
import VisualPropertiesGroup from '../groups/VisualPropertiesGroup.vue'
import AudioPropertiesGroup from '../groups/AudioPropertiesGroup.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData | null
  currentFrame: number
}

const props = defineProps<Props>()

// 是否显示倍速控制
const showSpeedControl = computed(() => {
  if (!props.selectedTimelineItem) return false
  return isVideoTimelineItem(props.selectedTimelineItem) ||
         isAudioTimelineItem(props.selectedTimelineItem)
})
</script>

<style scoped>
.unified-clip-properties {
  width: 100%;
}
</style>
