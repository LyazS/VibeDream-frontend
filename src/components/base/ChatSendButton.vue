<template>
  <button
    type="button"
    class="chat-send-button"
    :disabled="disabled"
    :title="title"
    @click="emit('click', $event)"
  >
    <component :is="icon" size="18px" />
  </button>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  disabled: boolean
  title: string
  icon: Component
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.chat-send-button {
  position: absolute;
  right: 10px;
  bottom: 10px;
  min-width: 40px;
  min-height: 40px;
  padding: var(--spacing-md);
  border: none;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(33, 150, 243, 0.22) 0%, rgba(33, 150, 243, 0.12) 100%),
    rgba(255, 255, 255, 0.03);
  color: #d9eeff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.16),
    0 8px 18px rgba(0, 0, 0, 0.14);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

:global(.chat-input-main:focus-within) .chat-send-button {
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.2),
    0 14px 26px rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}

.chat-send-button:hover:not(:disabled) {
  background:
    linear-gradient(180deg, rgba(33, 150, 243, 0.3) 0%, rgba(33, 150, 243, 0.16) 100%),
    rgba(255, 255, 255, 0.05);
  color: #fff;
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.24),
    0 12px 24px rgba(0, 0, 0, 0.18);
}

.chat-send-button:active:not(:disabled) {
  transform: scale(0.96);
}

.chat-send-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.chat-send-button :deep(svg) {
  margin-left: 1px;
}
</style>
