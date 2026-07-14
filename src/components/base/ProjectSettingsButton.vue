<template>
  <button
    type="button"
    :class="visible ? 'project-settings-button is-visible' : 'project-settings-button'"
    :title="title"
    @click="emit('click', $event)"
  >
    <component :is="IconComponents.MORE" size="20px" />
  </button>
</template>

<script setup lang="ts">
import { IconComponents } from '@/constants/iconComponents'

withDefaults(
  defineProps<{
    title: string
    visible?: boolean
  }>(),
  {
    visible: false,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.project-settings-button {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 36px;
  height: 36px;
  padding: var(--spacing-xs);
  border: none;
  border-radius: var(--border-radius-medium);
  background: rgba(0, 0, 0, 0.6);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  opacity: 0;
  transform: scale(0.9);
  backdrop-filter: blur(4px);
  transition:
    background-color 0.2s ease,
    opacity 0.2s ease,
    transform 0.2s ease;
}

.project-settings-button.is-visible {
  opacity: 1;
  transform: scale(1);
}

.project-settings-button:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.05);
}

.project-settings-button:active {
  transform: scale(0.96);
}

:global(.list-view) .project-settings-button {
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;
}
</style>
