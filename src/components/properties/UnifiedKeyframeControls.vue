<template>
  <div class="property-section">
    <h4>{{ t('properties.keyframes.keyframeAnimation') }}</h4>

    <!-- 关键帧控制按钮组 - 一行显示 -->
    <div class="keyframe-controls-row">
      <!-- 上一个关键帧 -->
      <KeyframeControlButton
        kind="navigation"
        @click="$emit('go-to-previous')"
        :disabled="!hasPreviousKeyframe || !canOperateKeyframes"
        :title="t('properties.keyframes.previousKeyframe')"
      >
        <template #icon>
          <component :is="IconComponents.PREV_KEYFRAME" size="16px" />
        </template>
        <span>{{ t('properties.keyframes.goToPrevious') }}</span>
      </KeyframeControlButton>

      <!-- 主关键帧按钮 -->
      <KeyframeControlButton
        kind="toggle"
        :state="keyframeButtonState"
        @click="$emit('toggle-keyframe')"
        :disabled="!canOperateKeyframes"
        :title="keyframeTooltip"
      >
        <template #icon>
          <component :is="IconComponents.KEYFRAME" size="16px" />
        </template>
        <span>{{ t('properties.keyframes.keyframes') }}</span>
      </KeyframeControlButton>

      <!-- 下一个关键帧 -->
      <KeyframeControlButton
        kind="navigation"
        @click="$emit('go-to-next')"
        :disabled="!hasNextKeyframe || !canOperateKeyframes"
        :title="t('properties.keyframes.nextKeyframe')"
        icon-position="after"
      >
        <span>{{ t('properties.keyframes.goToNext') }}</span>
        <template #icon>
          <component :is="IconComponents.NEXT_KEYFRAME" size="16px" />
        </template>
      </KeyframeControlButton>

      <!-- 调试按钮 - 开发时使用 -->
      <!-- <HoverButton
        v-if="showDebugButton"
        @click="$emit('debug-keyframes')"
        class="debug-btn"
        :title="t('properties.keyframes.debugKeyframes')"
      >
        <span>{{ t('properties.keyframes.debugKeyframes') }}</span>
      </HoverButton> -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import KeyframeControlButton from '@/components/base/KeyframeControlButton.vue'

const { t } = useAppI18n()

interface Props {
  keyframeButtonState: 'none' | 'on-keyframe' | 'between-keyframes'
  canOperateKeyframes: boolean
  hasPreviousKeyframe: boolean
  hasNextKeyframe: boolean
  keyframeTooltip: string
  showDebugButton?: boolean
}

interface Emits {
  (e: 'toggle-keyframe'): void
  (e: 'go-to-previous'): void
  (e: 'go-to-next'): void
  (e: 'debug-keyframes'): void
}

defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.keyframe-controls-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
  justify-content: space-between;
  flex-wrap: nowrap;
}

@media (max-width: 400px) {
  .keyframe-controls-row {
    flex-wrap: wrap;
    gap: 4px;
  }
}
</style>
