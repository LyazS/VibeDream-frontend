<template>
  <div class="tool-call-display">
    <div class="tool-header tool-header--interactive" @click="toggleExpand">
      <div class="status-dot"></div>
      <component :is="IconComponents.TOOLS_FILL" size="16px" class="tool-icon" />
      <div class="tool-title-group">
        <div class="tool-title-stack">
          <span class="tool-title">{{ displayName }}</span>
        </div>
      </div>
      <button
        v-if="canCancelToolExecution"
        type="button"
        class="tool-stop-button"
        :title="t('aiPanel.toolsState.stop')"
        :aria-label="t('aiPanel.toolsState.stop')"
        @click.stop="handleCancelToolExecution"
      >
        <component :is="IconComponents.STOP" size="12px" />
      </button>
      <component
        :is="isExpanded ? IconComponents.DROPDOWN : IconComponents.NEXT_KEYFRAME"
        size="14px"
        class="expand-icon"
      />
    </div>

    <div v-if="hasProgressState" class="tool-progress">
      <div class="tool-progress-track">
        <div
          class="tool-progress-fill"
          :class="{ 'tool-progress-fill--active': isProgressActive }"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <div v-if="isExpanded" class="tool-params-expanded">
      <IndexingRuntimeCard v-if="progressState" :state="progressState" />
      <FrameInspectionRuntimeCard
        v-else-if="frameInspectionExecutionState"
        :state="frameInspectionExecutionState"
      />
      <pre>{{ formattedArgs }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import 'github-markdown-css/github-markdown.css'
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import type { ToolCallPart } from '../types'
import IndexingRuntimeCard from './IndexingRuntimeCard.vue'
import FrameInspectionRuntimeCard from './FrameInspectionRuntimeCard.vue'
import { useReadMediaExecutionState } from '../composables/tools/readMedia'
import { useSearchMediaExecutionState } from '../composables/tools/searchMedia'
import { useFrameInspectionExecutionState } from '../composables/tools/inspectTimelineFrames'
import { cancelToolExecution } from '../composables/tools/cancellation'

const props = defineProps<{
  item: ToolCallPart
}>()

const { t } = useAppI18n()
const isExpanded = ref(false)

const formattedArgs = computed(() => JSON.stringify(props.item.args || {}, null, 2))
const readMediaExecutionState = useReadMediaExecutionState(props.item.tool_call_id)
const searchMediaExecutionState = useSearchMediaExecutionState(props.item.tool_call_id)
const frameInspectionExecutionState = useFrameInspectionExecutionState(props.item.tool_call_id)
const progressState = computed(
  () => readMediaExecutionState.value ?? searchMediaExecutionState.value,
)
const hasProgressState = computed(
  () => !!progressState.value || !!frameInspectionExecutionState.value,
)
const isProgressActive = computed(
  () => progressState.value?.active ?? frameInspectionExecutionState.value?.active ?? false,
)

const canCancelToolExecution = computed(() => {
  if (
    props.item.tool_name === 'read_media' &&
    !!readMediaExecutionState.value?.active &&
    !!readMediaExecutionState.value?.canCancel
  ) {
    return true
  }

  if (
    props.item.tool_name === 'inspect_timeline_frames' &&
    !!frameInspectionExecutionState.value?.active &&
    !!frameInspectionExecutionState.value?.canCancel
  ) {
    return true
  }

  if (
    props.item.tool_name === 'search_media' &&
    !!searchMediaExecutionState.value?.active &&
    !!searchMediaExecutionState.value?.canCancel
  ) {
    return true
  }

  return false
})
const progressPercent = computed(() => {
  const readState = readMediaExecutionState.value
  if (readState) {
    if (readState.totalCount <= 0) return 0
    const resolvedCount = readState.completedCount + readState.failedCount
    const ratio = resolvedCount / readState.totalCount
    if (!readState.active) {
      return Math.max(0, Math.min(100, ratio * 100 || 100))
    }

    return Math.max(12, Math.min(92, ratio * 100))
  }

  const searchState = searchMediaExecutionState.value
  if (searchState) {
    if (searchState.currentStage === 'indexing' && searchState.indexingTotalCount > 0) {
      const ratio = searchState.indexingResolvedCount / searchState.indexingTotalCount
      if (!searchState.active) {
        return Math.max(0, Math.min(100, ratio * 100 || 100))
      }

      return Math.max(12, Math.min(92, ratio * 100))
    }

    if (searchState.totalSteps <= 0) return 0
    const ratio = searchState.completedSteps / searchState.totalSteps
    if (!searchState.active) {
      return Math.max(0, Math.min(100, ratio * 100 || 100))
    }

    return Math.max(12, Math.min(92, ratio * 100))
  }

  const frameInspectionState = frameInspectionExecutionState.value
  if (frameInspectionState) {
    return Math.max(0, Math.min(100, frameInspectionState.progress))
  }

  return 0
})

const displayName = computed(() => {
  const key = `aiPanel.tools.${props.item.tool_name}`
  return t(key, props.item.tool_name)
})

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const handleCancelToolExecution = async () => {
  await cancelToolExecution(props.item.tool_name, props.item.tool_call_id)
}
</script>

<style scoped>
.tool-call-display {
  margin: 4px 0;
  padding: 0;
  border-radius: 0;
  background: transparent;
  width: 100%;
  box-sizing: border-box;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 9px;
  border-radius: 9px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.024) 0%, rgba(255, 255, 255, 0.013) 100%),
    rgba(255, 255, 255, 0.008);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    0 4px 12px rgba(0, 0, 0, 0.075);
  user-select: none;
  transition:
    transform var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.tool-header--interactive {
  cursor: pointer;
}

.tool-header--interactive:hover {
  transform: translateY(-1px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.016) 100%),
    rgba(255, 255, 255, 0.01);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    0 8px 18px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.02);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #10b981;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.tool-icon {
  flex-shrink: 0;
  color: #a9b1bb;
}

.tool-title {
  font-weight: 600;
  font-size: 12px;
  line-height: 1.35;
  color: #d5dbe3;
  text-wrap: balance;
  -webkit-font-smoothing: antialiased;
}

.tool-title-group {
  display: flex;
  flex: 1;
  min-width: 0;
}

.tool-title-stack {
  display: flex;
  flex: 1;
  min-width: 0;
}

.tool-stop-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: none;
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-radius: 999px;
  width: 22px;
  height: 22px;
  padding: 0;
  cursor: pointer;
  box-shadow:
    0 0 0 1px rgba(239, 68, 68, 0.2),
    0 4px 10px rgba(0, 0, 0, 0.09);
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.tool-stop-button::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 40px;
  height: 40px;
  transform: translate(-50%, -50%);
}

.tool-stop-button:hover {
  background: rgba(239, 68, 68, 0.18);
  color: #fecaca;
  box-shadow:
    0 0 0 1px rgba(239, 68, 68, 0.24),
    0 7px 14px rgba(0, 0, 0, 0.12);
}

.tool-stop-button:active {
  transform: scale(0.96);
}

.tool-progress {
  margin-top: 5px;
  padding: 0 10px;
}

.tool-progress-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.18);
}

.tool-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.75) 0%, rgba(52, 211, 153, 1) 100%);
  transition: width 0.25s ease;
}

.tool-progress-fill--active {
  background-size: 200% 100%;
  animation: tool-progress-pulse 1.4s linear infinite;
}

@keyframes tool-progress-pulse {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: 0 0;
  }
}

.expand-icon {
  flex-shrink: 0;
  color: #98a2ae;
  transition:
    transform var(--transition-fast),
    color var(--transition-fast);
}

.tool-params-expanded {
  margin-top: 5px;
  padding: 9px 11px;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.16) 100%), rgba(0, 0, 0, 0.12);
  border-radius: 9px;
  font-size: 11px;
  overflow-x: auto;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.tool-params-expanded pre {
  margin: 0;
  color: #adb3bd;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  line-height: 1.5;
}
</style>
