<template>
  <button
    type="button"
    :class="buttonClasses"
    :disabled="disabled"
    :title="title"
    @click="emit('click', $event)"
  >
    <template v-if="iconPosition === 'before'">
      <slot name="icon" />
      <slot />
    </template>
    <template v-else>
      <slot />
      <slot name="icon" />
    </template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type ButtonKind = 'navigation' | 'toggle'
type KeyframeButtonState = 'none' | 'on-keyframe' | 'between-keyframes'

const props = withDefaults(
  defineProps<{
    kind: ButtonKind
    state?: KeyframeButtonState
    disabled: boolean
    title: string
    iconPosition?: 'before' | 'after'
  }>(),
  {
    state: 'none',
    iconPosition: 'before',
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const buttonClasses = computed(() =>
  [
    props.kind === 'toggle' ? 'keyframe-toggle-button' : 'keyframe-navigation-button',
    props.kind === 'toggle' ? `keyframe-toggle-button--${props.state}` : undefined,
  ]
    .filter(Boolean)
    .join(' '),
)
</script>

<style scoped>
.keyframe-toggle-button {
  flex: 1 1 auto;
  min-width: 90px;
  max-width: 120px;
  height: 36px;
  border: none;
  gap: 0;
  padding: 0 12px;
  border-radius: 4px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.keyframe-toggle-button:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  transform: translateY(-1px);
}

.keyframe-toggle-button--on-keyframe {
  background: rgba(64, 158, 255, 0.2);
  box-shadow: 0 0 8px rgba(64, 158, 255, 0.4);
}

.keyframe-toggle-button--on-keyframe :deep(svg) {
  color: #409eff;
}

.keyframe-toggle-button--on-keyframe:hover:not(:disabled) {
  background: rgba(64, 158, 255, 0.3);
  box-shadow: 0 0 12px rgba(64, 158, 255, 0.6);
}

.keyframe-toggle-button--between-keyframes {
  background: rgba(255, 215, 0, 0.15);
  color: #ffd700;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.3);
}

.keyframe-toggle-button--between-keyframes:hover:not(:disabled) {
  background: rgba(255, 215, 0, 0.25);
  box-shadow: 0 0 12px rgba(255, 215, 0, 0.5);
}

.keyframe-toggle-button:disabled,
.keyframe-navigation-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  box-shadow: none;
}

.keyframe-navigation-button {
  flex: 0 0 auto;
  min-width: 55px;
  height: 36px;
  border: none;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 11px;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease;
}

.keyframe-navigation-button:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  transform: translateY(-1px);
}

.keyframe-toggle-button :deep(span),
.keyframe-navigation-button :deep(span) {
  font-size: 10px;
  white-space: nowrap;
}

@media (max-width: 400px) {
  .keyframe-toggle-button {
    flex: 1 1 100%;
    margin-bottom: 4px;
  }

  .keyframe-navigation-button {
    flex: 1 1 calc(33.333% - 3px);
    min-width: 0;
  }
}
</style>
