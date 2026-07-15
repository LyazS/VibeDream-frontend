<template>
  <div class="tool-runtime-card">
    <div class="tool-runtime-header">
      <span class="tool-runtime-status">
        {{ statusText }}
      </span>
      <span class="tool-runtime-count">
        {{ progressText }}
      </span>
    </div>
    <div class="tool-runtime-meta">
      <span>{{ t('aiPanel.toolsState.completed', { count: successCount }) }}</span>
      <span>{{ t('aiPanel.toolsState.failed', { count: props.state.indexingFailedCount }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { IndexingRuntimeState } from '../composables/tools/indexingRuntime'

const props = defineProps<{
  state: IndexingRuntimeState
}>()

const { t } = useAppI18n()

const successCount = computed(() =>
  Math.max(props.state.indexingResolvedCount - props.state.indexingFailedCount, 0),
)

const statusText = computed(() =>
  t(props.state.indexingStatus.key, props.state.indexingStatus.params || {}),
)

const progressText = computed(() => {
  return `${props.state.indexingResolvedCount}/${props.state.indexingTotalCount}`
})
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
