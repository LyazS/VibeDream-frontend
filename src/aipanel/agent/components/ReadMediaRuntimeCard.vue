<template>
  <div class="tool-runtime-card">
    <div class="tool-runtime-header">
      <span class="tool-runtime-status">
        {{ t('aiPanel.toolsState.indexing') }}
      </span>
      <span class="tool-runtime-count">
        {{ resolvedCount }}/{{ state.totalCount }}
      </span>
    </div>
    <div class="tool-runtime-meta">
      <span>{{ t('aiPanel.toolsState.completed', { count: state.completedCount }) }}</span>
      <span>{{ t('aiPanel.toolsState.failed', { count: state.failedCount }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { ReadMediaExecutionState } from '../composables/tools/readMedia'

const props = defineProps<{
  state: ReadMediaExecutionState
}>()

const { t } = useAppI18n()

const resolvedCount = computed(() => props.state.completedCount + props.state.failedCount)
</script>

<style scoped>
.tool-runtime-card {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.16);
}

.tool-runtime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tool-runtime-status {
  color: #d1fae5;
  font-size: 12px;
  font-weight: 600;
}

.tool-runtime-count {
  color: #a7f3d0;
  font-size: 12px;
  font-weight: 600;
}

.tool-runtime-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  color: #9ca3af;
  font-size: 11px;
}
</style>
