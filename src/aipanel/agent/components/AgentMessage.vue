<template>
  <div class="chat-message ai">
    <div class="message-bubble">
      <div class="message-header">
        <component :is="IconComponents.ROBOT" size="20px" class="agent-icon" />
        <span class="agent-label">Agent</span>
      </div>
      <div v-if="isTaskComplete" class="task-complete-component">
        <div class="task-complete-header">
          <component :is="IconComponents.SUCCESS" size="18px" class="check-icon" />
          <span class="task-complete-title">{{ t('aiPanel.taskComplete') }}</span>
        </div>
        <div class="task-complete-content">
          <template v-for="(item, index) in message.parts" :key="index">
            <div
              v-if="item.type === MessagePartType.TEXT"
              class="markdown-body"
              v-html="renderMarkdown(item.text)"
            ></div>
          </template>
        </div>
      </div>
      <div v-else class="message-content">
        <template v-for="(item, index) in message.parts" :key="index">
          <div
            v-if="item.type === MessagePartType.TEXT"
            class="markdown-body"
            v-html="renderMarkdown(item.text)"
          ></div>
          <ToolCallDisplay
            v-else-if="item.type === MessagePartType.TOOL_CALL && item.tool_name !== 'task_complete'"
            :item="item"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import 'github-markdown-css/github-markdown.css'
import type { AgentMessage } from '../types'
import { MessagePartType } from '../types'
import { IconComponents } from '@/constants/iconComponents'
import ToolCallDisplay from './ToolCallDisplay.vue'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

// 注入markdown渲染函数
const renderMarkdown = inject<(content: string) => string>('renderMarkdown', (content: string) => {
  return content
})

const props = defineProps<{
  message: AgentMessage
  isTaskComplete?: boolean
}>()
</script>

<style scoped>
.chat-message {
  display: flex;
  margin-bottom: var(--spacing-sm);
}

.chat-message.ai {
  justify-content: flex-start;
  width: 100%;
}

.message-bubble {
  max-width: 95%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-large);
  position: relative;
  word-wrap: break-word;
}

.message-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.agent-icon {
  margin-right: var(--spacing-sm);
}

.agent-label {
  font-weight: 600;
  font-size: var(--font-size-lg);
}

.message-content {
  font-size: var(--font-size-base);
  line-height: 1.4;
  margin-bottom: var(--spacing-xs);
  width: 100%;
}

.markdown-body {
  color: var(--color-text-primary);
  background-color: transparent;
}

.markdown-body table {
  display: block;
  overflow-x: auto;
}

.message-content > *:first-child {
  margin-top: 0;
}

.message-content > *:last-child {
  margin-bottom: 0;
}

.task-complete-component {
  margin: 12px 0;
  padding: 12px 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(52, 211, 153, 0.05) 100%);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.task-complete-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.check-icon {
  color: #10b981;
  flex-shrink: 0;
}

.task-complete-title {
  font-weight: 600;
  font-size: 14px;
  color: #10b981;
}

.task-complete-content {
  padding-left: 26px;
  color: var(--color-text-primary);
}

</style>
