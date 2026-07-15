<template>
  <div class="property-section">
    <h4>{{ t('properties.playback.playbackSettings') }}</h4>

    <!-- 时长控制 -->
    <div class="property-item">
      <label>{{ t('properties.basic.targetDuration') }}</label>
      <TimecodeInput
        :model-value="timelineDurationFrames"
        @update:model-value="updateTargetDurationFrames"
        @error="handleTimecodeError"
        :placeholder="t('properties.timecodes.timecodeFormat')"
      />
    </div>

    <!-- 倍速控制（仅 video/audio） -->
    <div v-if="showSpeedControl" class="property-item">
      <label>{{ t('properties.playback.speed') }}</label>
      <div class="speed-controls">
        <SliderInput
          :model-value="normalizedSpeed"
          @input="updateNormalizedSpeed"
          :min="0"
          :max="100"
          :step="1"
          container-class="speed-slider-container"
          slider-class="segmented-speed-slider"
          :segments="speedSliderSegments"
        />
        <NumberInput
          :model-value="speedInputValue"
          @change="updateSpeedFromInput"
          :min="0.1"
          :max="100"
          :step="0.1"
          :precision="1"
          :show-controls="false"
          :placeholder="t('properties.placeholders.speed')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  isVideoTimelineItem,
  isImageTimelineItem,
  isAudioTimelineItem,
} from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import TimecodeInput from '@/components/base/TimecodeInput.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData | null
  showSpeedControl?: boolean
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

// 时间轴时长（帧数）
const timelineDurationFrames = computed(() => {
  if (!props.selectedTimelineItem) return 0
  const timeRange = props.selectedTimelineItem.timeRange
  return Math.round(timeRange.timelineEndTime - timeRange.timelineStartTime)
})

// 倍速分段配置
const speedSegments = [
  { min: 0.1, max: 1, normalizedStart: 0, normalizedEnd: 20 },
  { min: 1, max: 2, normalizedStart: 20, normalizedEnd: 40 },
  { min: 2, max: 5, normalizedStart: 40, normalizedEnd: 60 },
  { min: 5, max: 10, normalizedStart: 60, normalizedEnd: 80 },
  { min: 10, max: 100, normalizedStart: 80, normalizedEnd: 100 },
]

// 倍速滑块分段标记
const speedSliderSegments = [
  { position: 20, label: '1x' },
  { position: 40, label: '2x' },
  { position: 60, label: '5x' },
  { position: 80, label: '10x' },
]

// 播放速率
const playbackRate = computed(() => {
  if (!props.selectedTimelineItem) return 1

  // 图片类型没有播放速度概念
  if (isImageTimelineItem(props.selectedTimelineItem)) {
    return 1
  }

  // 对于视频和音频类型，从 timeRange 计算播放速度
  if (
    isVideoTimelineItem(props.selectedTimelineItem)
    || isAudioTimelineItem(props.selectedTimelineItem)
  ) {
    const timeRange = props.selectedTimelineItem.timeRange
    const clipDurationFrames = timeRange.clipEndTime - timeRange.clipStartTime
    const timelineDurationFrames = timeRange.timelineEndTime - timeRange.timelineStartTime

    if (clipDurationFrames > 0 && timelineDurationFrames > 0) {
      let playbackRate = clipDurationFrames / timelineDurationFrames

      // 修正浮点数精度问题
      const rounded = Math.round(playbackRate * 10) / 10
      if (Math.abs(playbackRate - rounded) < 0.001) {
        playbackRate = rounded
      }

      return playbackRate
    }
  }

  return 1
})

const normalizedSpeed = computed(() => speedToNormalized(playbackRate.value))
const speedInputValue = computed(() => playbackRate.value)

// 将归一化值(0-100)转换为实际播放速度
const normalizedToSpeed = (normalized: number) => {
  for (const segment of speedSegments) {
    if (normalized >= segment.normalizedStart && normalized <= segment.normalizedEnd) {
      const segmentProgress =
        (normalized - segment.normalizedStart) / (segment.normalizedEnd - segment.normalizedStart)
      return segment.min + segmentProgress * (segment.max - segment.min)
    }
  }
  return 1
}

// 将实际播放速度转换为归一化值(0-100)
const speedToNormalized = (speed: number) => {
  for (const segment of speedSegments) {
    if (speed >= segment.min && speed <= segment.max) {
      const segmentProgress = (speed - segment.min) / (segment.max - segment.min)
      return (
        segment.normalizedStart +
        segmentProgress * (segment.normalizedEnd - segment.normalizedStart)
      )
    }
  }
  return 20
}

// 更新播放速度
const updatePlaybackRate = async (newRate?: number) => {
  if (
    props.selectedTimelineItem
    && (isVideoTimelineItem(props.selectedTimelineItem)
      || isAudioTimelineItem(props.selectedTimelineItem))
  ) {
    // 暂停播放
    unifiedStore.pause()

    const rate = newRate || playbackRate.value
    await unifiedStore.updatePlaybackRateWithHistory(props.selectedTimelineItem.id, rate)
  }
}

// 更新归一化速度
const updateNormalizedSpeed = (newNormalizedSpeed: number) => {
  const actualSpeed = normalizedToSpeed(newNormalizedSpeed)
  updatePlaybackRate(actualSpeed)
}

// 从输入框更新倍速
const updateSpeedFromInput = (newSpeed: number) => {
  if (newSpeed && newSpeed > 0) {
    const clampedSpeed = Math.max(0.1, Math.min(100, newSpeed))
    updatePlaybackRate(clampedSpeed)
  }
}

// 处理时间码错误
const handleTimecodeError = (errorMessage: string) => {
  unifiedStore.messageError(errorMessage)
}

// 更新目标时长
const updateTargetDurationFrames = async (newDurationFrames: number) => {
  if (!props.selectedTimelineItem) {
    console.warn('⚠️ 没有选中的时间轴项目')
    return
  }

  // 验证新时长
  if (newDurationFrames <= 0) {
    unifiedStore.messageError(t('properties.errors.invalidDuration'))
    return
  }

  const timeRange = props.selectedTimelineItem.timeRange
  const currentDurationFrames = timeRange.timelineEndTime - timeRange.timelineStartTime

  // 检查时长是否有变化
  if (Math.abs(currentDurationFrames - newDurationFrames) < 1) {
    console.log('⚠️ 时长没有变化，跳过更新')
    return
  }

  // 暂停播放
  unifiedStore.pause()

  // 计算新的时间范围
  const newTimeRange = {
    timelineStartTime: timeRange.timelineStartTime,
    timelineEndTime: timeRange.timelineStartTime + newDurationFrames,
    clipStartTime: timeRange.clipStartTime,
    clipEndTime: timeRange.clipEndTime,
  }

  try {
    // 使用 resizeTimelineItemWithHistory 更新时长
    await unifiedStore.resizeTimelineItemWithHistory(props.selectedTimelineItem.id, newTimeRange)
    console.log('✅ 时长更新成功:', {
      oldDuration: currentDurationFrames,
      newDuration: newDurationFrames,
    })
  } catch (error) {
    console.error('❌ 时长更新失败:', error)
    unifiedStore.messageError(t('properties.errors.updateFailed'))
  }
}
</script>

<style scoped>
.speed-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 1;
  min-width: 0;
  container-type: inline-size;
}

@container (max-width: 140px) {
  .speed-controls :deep(.speed-slider-container) {
    display: none;
  }
}
</style>
