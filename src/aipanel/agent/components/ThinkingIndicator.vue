<template>
  <div class="thinking-indicator" role="status" aria-live="polite">
    <template v-if="status === 'thinking'">
      <span class="thinking-indicator__label">{{ t('aiPanel.agentStatus.thinking') }}</span>
      <span class="thinking-indicator__ellipsis" aria-hidden="true">.....</span>
    </template>
    <span v-else class="thinking-indicator__label">{{ t('aiPanel.agentStatus.completed') }}</span>
  </div>
</template>

<script setup lang="ts">
import { useAppI18n } from '@/core/composables/useI18n'

defineProps<{
  status: 'thinking' | 'completed'
}>()

const { t } = useAppI18n()
</script>

<style scoped>
.thinking-indicator {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border-radius: 12px;
  width: fit-content;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  text-wrap: pretty;
}

.thinking-indicator__label,
.thinking-indicator__ellipsis {
  font-variant-numeric: tabular-nums;
}

.thinking-indicator__ellipsis {
  display: inline-block;
  width: 5ch;
  overflow: hidden;
  white-space: nowrap;
  animation: thinking-ellipsis 1.6s step-end infinite;
}

@keyframes thinking-ellipsis {
  0%,
  11.11% {
    width: 1ch;
  }
  22.22% {
    width: 2ch;
  }
  33.33% {
    width: 3ch;
  }
  44.44% {
    width: 4ch;
  }
  55.56% {
    width: 5ch;
  }
  66.67% {
    width: 4ch;
  }
  77.78% {
    width: 3ch;
  }
  88.89% {
    width: 2ch;
  }
  100% {
    width: 1ch;
  }
}
</style>
