<template>
  <div class="property-section">
    <h4>{{ t('properties.audio.audioProperties') }}</h4>

    <!-- 音量控制 -->
    <div class="property-item">
      <label :class="getAnimatedLabelClass(audioButtonState)">
        {{ t('properties.playback.volume') }}
      </label>
      <div class="volume-controls">
        <SliderInput
          :model-value="volume"
          @input="updateVolumeDeferred"
          @change="commitVolumeDeferredUpdate"
          :disabled="!canOperateVisualChannels"
          :min="0"
          :max="1"
          :step="0.01"
          slider-class="volume-slider"
        />
        <NumberInput
          :model-value="volume"
          @change="setVolume"
          :disabled="!canOperateVisualChannels"
          :min="0"
          :max="1"
          :step="0.01"
          :precision="2"
          :show-controls="false"
          :placeholder="t('properties.placeholders.volume')"
        />
        <button
          @click="toggleMute"
          :disabled="!canOperateVisualChannels"
          class="mute-btn"
          :title="isMuted ? t('properties.playback.unmuteTitle') : t('properties.playback.muteTitle')"
        >
          <component :is="getMuteIcon(isMuted)" size="14px" />
        </button>
        <KeyframeNavButtons
          :state="audioButtonState"
          :tooltip="getChannelKeyframeTooltip('audio.volume')"
          :disabled="!canOperateVisualChannels"
          :has-previous="hasPreviousChannelKeyframe('audio.volume')"
          :has-next="hasNextChannelKeyframe('audio.volume')"
          @previous="goToPreviousChannelKeyframe('audio.volume')"
          @toggle="toggleChannelKeyframe('audio.volume')"
          @next="goToNextChannelKeyframe('audio.volume')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { TimelineItemQueries, hasAudioProperties } from '@/core/timelineitem/queries'
import { useUnifiedKeyframeVisualControls } from '@/core/composables'
import { IconComponents, getMuteIcon } from '@/constants/iconComponents'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import KeyframeNavButtons from '@/components/properties/common/KeyframeNavButtons.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData | null
  currentFrame: number
}

const props = defineProps<Props>()
const { t } = useAppI18n()

// 使用关键帧控制器获取音量（支持关键帧动画）和可操作状态
const {
  volume,
  setVolume,
  setMutedDirectly,
  updateVolumeDeferred,
  canOperateVisualChannels,
  getChannelButtonState,
  hasPreviousChannelKeyframe,
  hasNextChannelKeyframe,
  goToPreviousChannelKeyframe,
  goToNextChannelKeyframe,
  toggleChannelKeyframe,
  getChannelKeyframeTooltip,
  commitVolumeDeferredUpdate,
} = useUnifiedKeyframeVisualControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

const audioButtonState = computed(() => getChannelButtonState('audio.volume'))

const getAnimatedLabelClass = (state: string) => ({
  'animated-property-label': state !== 'none',
  'animated-property-label--on-keyframe': state === 'on-keyframe',
  'animated-property-label--between-keyframes': state === 'between-keyframes',
})

// isMuted 不使用关键帧系统，直接从基础音频配置读取
const isMuted = computed(() => {
  if (!props.selectedTimelineItem || !hasAudioProperties(props.selectedTimelineItem)) {
    return false
  }
  return TimelineItemQueries.getBaseAudioConfig(props.selectedTimelineItem)?.isMuted ?? false
})

// 切换静音（不使用关键帧系统）
const toggleMute = async () => {
  await setMutedDirectly(!isMuted.value)
}
</script>

<style scoped>
.volume-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 1;
}

.mute-btn {
  background: var(--color-bg-quaternary);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xs);
  transition: all 0.2s ease;
  width: 24px;
  height: 24px;
}

.mute-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-focus);
}

.mute-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  border-color: var(--color-border-secondary);
}

.mute-btn:disabled:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-secondary);
}

.animated-property-label--on-keyframe {
  color: #5ba6ff;
}

.animated-property-label--between-keyframes {
  color: #d9a441;
}
</style>
