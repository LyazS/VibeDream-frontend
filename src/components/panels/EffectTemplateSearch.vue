<template>
  <label class="effect-template-search">
    <component :is="IconComponents.SEARCH" size="16px" />
    <input v-model="model" :placeholder="placeholder" />
  </label>
</template>

<script setup lang="ts">
import { IconComponents } from '@/constants/iconComponents'

defineProps<{
  placeholder: string
}>()

const model = defineModel<string>({ required: true })
</script>

<style scoped>
.effect-template-search {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  min-height: 24px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  transition-property: background-color, border-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.effect-template-search:hover {
  background: var(--color-bg-hover);
}

.effect-template-search:focus-within {
  border-color: transparent;
  background: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.effect-template-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  caret-color: var(--color-text-primary);
  font-size: var(--font-size-base);
  outline: none;
}

.effect-template-search input::placeholder {
  color: var(--color-text-hint);
}
</style>
