<template>
  <button type="button" class="preview-reset-button" :title="title" @click="emit('click', $event)">
    <component :is="IconComponents.REFRESH" size="16px" />
  </button>
</template>

<script setup lang="ts">
import { IconComponents } from '@/constants/iconComponents'

defineProps<{
  title: string
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.preview-reset-button {
  position: absolute;
  right: var(--spacing-sm);
  bottom: var(--spacing-sm);
  z-index: 30;
  min-width: 24px;
  height: 24px;
  padding: var(--spacing-xs);
  border: none;
  border-radius: var(--border-radius-medium);
  background-color: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.preview-reset-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 8px 18px rgba(0, 0, 0, 0.2);
  transform: translateY(-1px);
  backdrop-filter: blur(8px);
}

.preview-reset-button:active {
  transform: translateY(-1px) scale(0.96);
}
</style>
