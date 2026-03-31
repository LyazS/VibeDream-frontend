<template>
  <div class="keyframe-nav-group">
    <button
      class="keyframe-nav-btn"
      :disabled="disabled || !hasPrevious"
      :title="t('properties.keyframes.previousKeyframe')"
      @click="$emit('previous')"
    >
      <component :is="IconComponents.PREV_KEYFRAME" size="11px" />
    </button>
    <button
      class="property-keyframe-btn"
      :class="`state-${state}`"
      :title="tooltip"
      :disabled="disabled"
      @click="$emit('toggle')"
    >
      ◆
    </button>
    <button
      class="keyframe-nav-btn"
      :disabled="disabled || !hasNext"
      :title="t('properties.keyframes.nextKeyframe')"
      @click="$emit('next')"
    >
      <component :is="IconComponents.NEXT_KEYFRAME" size="11px" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables'

defineProps<{
  state: string
  tooltip: string
  disabled: boolean
  hasPrevious: boolean
  hasNext: boolean
}>()

defineEmits<{
  (e: 'previous'): void
  (e: 'toggle'): void
  (e: 'next'): void
}>()

const { t } = useAppI18n()
</script>

<style scoped>
.keyframe-nav-group {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
  flex: 0 0 auto;
}

.keyframe-nav-btn {
  width: 12px;
  height: 22px;
  border-radius: 0;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all var(--transition-fast);
  flex: 0 0 auto;
}

.keyframe-nav-group > .property-keyframe-btn {
  border-radius: var(--border-radius-small);
}

.keyframe-nav-btn:hover:not(:disabled) {
  background: transparent;
  color: var(--color-text-primary);
}

.keyframe-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: transparent;
  color: var(--color-text-muted);
}

.property-keyframe-btn {
  width: 22px;
  height: 22px;
  border-radius: var(--border-radius-small);
  border: 1px solid var(--color-border-secondary);
  background: var(--color-bg-active);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.property-keyframe-btn.state-on-keyframe {
  color: #5ba6ff;
  border-color: #5ba6ff;
}

.property-keyframe-btn.state-between-keyframes {
  color: #d9a441;
  border-color: #d9a441;
}

.property-keyframe-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
