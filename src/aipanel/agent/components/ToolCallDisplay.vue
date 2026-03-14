<template>
  <div class="tool-call-display">
    <div class="tool-header" @click="isFrontendTool && toggleExpand()">
      <div class="status-dot"></div>
      <component :is="IconComponents.TOOLS_FILL" size="16px" class="tool-icon" />
      <span class="tool-title">{{ displayName }}</span>
      <!-- 仅前端工具显示箭头 -->
      <component v-if="isFrontendTool"
                 :is="isExpanded ? IconComponents.DROPDOWN : IconComponents.NEXT_KEYFRAME"
                 size="14px"
                 class="expand-icon" />
    </div>
    <!-- 展开的参数区域 -->
    <div v-if="isFrontendTool && isExpanded" class="tool-params-expanded">
      <!-- edit_sdk 工具使用 markdown 渲染代码块 -->
      <div v-if="isEditSdkTool && editSdkScript" class="markdown-body" v-html="renderMarkdown('```javascript\n' + editSdkScript + '\n```')"></div>
      <!-- 其他工具显示原始 JSON -->
      <pre v-else>{{ formattedArgs }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import type { ChatMessageAssistantContent } from '../types'
import 'github-markdown-css'

const props = defineProps<{
  item: ChatMessageAssistantContent
}>()

const { t } = useAppI18n()
const isExpanded = ref(false)

// 注入 markdown 渲染函数
const renderMarkdown = inject<(content: string) => string>('renderMarkdown', (content: string) => content)

const isFrontendTool = computed(() => props.item.isFrontendTool ?? false)

// 检测是否是 edit_sdk 工具
const isEditSdkTool = computed(() => props.item.toolName === 'edit_sdk')

// 解析 edit_sdk 工具的 script 字段
const editSdkScript = computed(() => {
  if (!isEditSdkTool.value) return ''
  try {
    const args = JSON.parse(props.item.toolArgs || '{}')
    return args.script || ''
  } catch {
    return ''
  }
})

const displayName = computed(() => {
  const toolName = props.item.toolName
  if (!toolName) return t('aiPanel.tools.unknown', '未知工具')
  const key = `aiPanel.tools.${toolName}`
  return t(key, toolName)
})

const formattedArgs = computed(() => {
  return props.item.toolArgs || '{}'
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
  height: 20px;
  cursor: pointer;
  user-select: none;
}

.tool-header:hover {
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
  flex: 1;
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
