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
        v-if="canCancelReadMedia"
        type="button"
        class="tool-stop-button"
        :title="t('aiPanel.toolsState.stop')"
        :aria-label="t('aiPanel.toolsState.stop')"
        @click.stop="handleCancelReadMedia"
      >
        <component :is="IconComponents.STOP" size="12px" />
      </button>
      <component
        :is="isExpanded ? IconComponents.DROPDOWN : IconComponents.NEXT_KEYFRAME"
        size="14px"
        class="expand-icon"
      />
    </div>

    <div v-if="readMediaExecutionState" class="tool-progress">
      <div class="tool-progress-track">
        <div
          class="tool-progress-fill"
          :class="{ 'tool-progress-fill--active': readMediaExecutionState.active }"
          :style="{ width: `${readMediaProgressPercent}%` }"
        ></div>
      </div>
    </div>

    <div v-if="isExpanded" class="tool-params-expanded">
      <ReadMediaRuntimeCard v-if="readMediaExecutionState" :state="readMediaExecutionState" />
      <div
        v-if="isEditSdkTool && editSdkScript"
        class="markdown-body"
        v-html="renderMarkdown('```javascript\n' + editSdkScript + '\n```')"
      ></div>
      <pre v-else>{{ formattedArgs }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import 'github-markdown-css/github-markdown.css'
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import type { ToolCallPart } from '../types'
import ReadMediaRuntimeCard from './ReadMediaRuntimeCard.vue'
import {
  cancelReadMediaExecution,
  useReadMediaExecutionState,
} from '../composables/tools/readMedia'

const props = defineProps<{
  item: ToolCallPart
}>()

const { t } = useAppI18n()
const isExpanded = ref(false)

const renderMarkdown = inject<(content: string) => string>(
  'renderMarkdown',
  (content: string) => content,
)

const isEditSdkTool = computed(() => props.item.tool_name === 'edit_sdk')
const formattedArgs = computed(() => JSON.stringify(props.item.args || {}, null, 2))
const readMediaExecutionState = useReadMediaExecutionState(props.item.tool_call_id)
const canCancelReadMedia = computed(
  () =>
    props.item.tool_name === 'read_media'
    && !!readMediaExecutionState.value?.active
    && !!readMediaExecutionState.value?.canCancel,
)
const readMediaProgressPercent = computed(() => {
  const state = readMediaExecutionState.value
  if (!state || state.totalCount <= 0) return 0

  const resolvedCount = state.completedCount + state.failedCount
  const ratio = resolvedCount / state.totalCount
  if (!state.active) {
    return Math.max(0, Math.min(100, ratio * 100 || 100))
  }

  return Math.max(12, Math.min(92, ratio * 100))
})

const editSdkScript = computed(() => {
  if (!isEditSdkTool.value) return ''
  const args = props.item.args as Record<string, unknown>
  return typeof args.script === 'string' ? args.script : ''
})

const displayName = computed(() => {
  const key = `aiPanel.tools.${props.item.tool_name}`
  return t(key, props.item.tool_name)
})

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const handleCancelReadMedia = async () => {
  await cancelReadMediaExecution(props.item.tool_call_id)
}
</script>

<style scoped>
.tool-call-display {
  margin: 2px 0;
  padding: 6px 6px;
  border-radius: 6px;
  background-color: rgba(209, 213, 219, 0.1);
  width: 100%;
  box-sizing: border-box;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  user-select: none;
}

.tool-header--interactive {
  cursor: pointer;
}

.tool-header--interactive:hover {
  opacity: 0.9;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #10b981;
  flex-shrink: 0;
}

.tool-icon {
  flex-shrink: 0;
  color: #9ca3af;
}

.tool-title {
  font-weight: 600;
  font-size: 13px;
  color: #cbd0d6;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-radius: 999px;
  width: 22px;
  height: 22px;
  padding: 0;
  cursor: pointer;
}

.tool-stop-button:hover {
  background: rgba(239, 68, 68, 0.18);
}

.tool-progress {
  margin-top: 8px;
}

.tool-progress-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
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
  color: #9ca3af;
  transition: transform 0.2s;
}

.tool-params-expanded {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
}

.tool-params-expanded pre {
  margin: 0;
  color: #adb3bd;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
</style>
