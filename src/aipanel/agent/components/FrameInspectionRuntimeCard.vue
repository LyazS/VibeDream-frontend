<template>
  <div class="inspection-runtime-card">
    <div class="inspection-runtime-header">
      <span>{{ t(props.state.messageKey) }}</span>
      <span>{{ props.state.uploadedFrames }}/{{ props.state.totalFrames }}</span>
    </div>
    <div class="inspection-runtime-detail">
      {{ t('aiPanel.toolsState.inspectionFrameCount', { count: props.state.totalFrames }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppI18n } from '@/core/composables/useI18n'
import type { FrameInspectionExecutionState } from '../composables/tools/inspectTimelineFrames'

const props = defineProps<{
  state: FrameInspectionExecutionState
}>()

const { t } = useAppI18n()
</script>

<style scoped>
.inspection-runtime-card {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(96, 165, 250, 0.2);
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.08);
}

.inspection-runtime-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #dbeafe;
  font-size: 12px;
  font-weight: 600;
}

.inspection-runtime-detail {
  margin-top: 8px;
  color: #93c5fd;
  font-size: 11px;
}
</style>
