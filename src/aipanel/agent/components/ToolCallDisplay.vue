<template>
  <div class="tool-call-display">
    <div class="tool-header tool-header--interactive" @click="toggleExpand">
      <div class="status-dot"></div>
      <component :is="IconComponents.TOOLS_FILL" size="16px" class="tool-icon" />
      <div class="tool-title-group">
        <span class="tool-title">{{ displayName }}</span>
      </div>
      <component
        :is="isExpanded ? IconComponents.DROPDOWN : IconComponents.NEXT_KEYFRAME"
        size="14px"
        class="expand-icon"
      />
    </div>

    <div v-if="isExpanded" class="tool-params-expanded">
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
