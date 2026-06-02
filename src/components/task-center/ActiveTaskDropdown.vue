<template>
  <div class="task-dropdown">
    <div class="task-dropdown-header">{{ t('editor.taskCenter.currentTasks') }}</div>
    <div class="task-list">
      <div v-for="item in items" :key="item.id" class="task-item">
        <div class="task-item-main">
          <div class="task-item-title">{{ item.title }}</div>
          <div class="task-item-status">{{ statusLabel(item.status) }}</div>
        </div>
        <div v-if="item.subtitle" class="task-item-subtitle">{{ item.subtitle }}</div>
        <div v-if="typeof item.progress === 'number'" class="task-progress">
          <div class="task-progress-bar" :style="{ width: `${Math.round(item.progress * 100)}%` }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppI18n } from '@/core/composables/useI18n'

interface ActiveTaskItem {
  id: string
  title: string
  subtitle?: string
  status: 'idle' | 'queued' | 'running'
  progress?: number
}

defineProps<{
  items: ActiveTaskItem[]
}>()

const { t } = useAppI18n()

function statusLabel(status: ActiveTaskItem['status']) {
  switch (status) {
    case 'idle':
      return t('editor.taskCenter.statuses.idle')
    case 'queued':
      return t('editor.taskCenter.statuses.queued')
    case 'running':
      return t('editor.taskCenter.statuses.running')
  }
}
</script>

<style scoped>
.task-dropdown {
  width: 312px;
  max-width: min(312px, calc(100vw - 32px));
}

.task-dropdown-header {
  padding: 2px 4px 10px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-default);
}

.task-list {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
}

.task-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 72%, transparent);
}

.task-item:last-child {
  border-bottom: none;
  padding-bottom: 4px;
}

.task-item-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-item-title {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  line-height: 1.35;
  word-break: break-word;
}

.task-item-status {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.2;
}

.task-item-subtitle {
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
}

.task-progress {
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-text-muted) 14%, transparent);
}

.task-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #1f9d55 0%, #63d471 100%);
  transition: width 0.2s ease;
}
</style>
