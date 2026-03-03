<template>
  <div class="chat-message ai">
    <div class="message-bubble">
      <div class="message-header">
        <component :is="IconComponents.ROBOT" size="20px" class="agent-icon" />
        <span class="agent-label">Agent</span>
      </div>
      <div class="message-content">
        <template v-for="(item, index) in message.content" :key="index">
          <div
            v-if="item.type === ChatMessageAssistantContentType.TEXT"
            class="markdown-body"
            v-html="renderMarkdown(item.content)"
          ></div>
          <div v-else-if="item.type === ChatMessageAssistantContentType.TOOL_USE" class="tool-component">
            <div class="status-dot"></div>
            <component :is="IconComponents.TOOLS_FILL" size="16px" class="tool-icon" />
            <span class="tool-title">工具调用</span>
            <span class="tool-params">{{ item.content }}</span>
          </div>
          <!-- 任务完成UI -->
          <div v-else-if="item.type === ChatMessageAssistantContentType.TASK_COMPLETE" class="task-complete-component">
            <div class="task-complete-header">
              <component :is="IconComponents.SUCCESS" size="18px" class="check-icon" />
              <span class="task-complete-title">任务完成</span>
            </div>
            <div class="task-complete-content markdown-body" v-html="renderMarkdown(item.content)"></div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import 'github-markdown-css'
import type { ChatMessageAssistant } from '../types'
import { ChatMessageAssistantContentType } from '../types'
import { IconComponents } from '@/constants/iconComponents'

// 注入markdown渲染函数
const renderMarkdown = inject<(content: string) => string>('renderMarkdown', (content: string) => {
  // 如果没有注入，返回原始内容（降级处理）
  return content
})

const props = defineProps<{
  message: ChatMessageAssistant
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
}

.markdown-body {
  color: var(--color-text-primary);
  background-color: transparent;
}

.markdown-body table {
  display: block;
  overflow-x: auto;
}

.tool-component {
  margin: 2px 0;
  padding: 2px 12px;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: rgba(209, 213, 219, 0.1);
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
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
  flex-shrink: 0;
}

.tool-params {
  font-size: 11px;
  color: #adb3bd;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-content > *:first-child {
  margin-top: 0;
}

.message-content > *:last-child {
  margin-bottom: 0;
}

.message-content > .tool-component + .tool-component {
  margin-top: 8px;
}

.message-content > .markdown-body + .tool-component,
.message-content > .tool-component + .markdown-body {
  margin-top: 12px;
}

/* 任务完成组件样式 */
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

.task-complete-content.markdown-body {
  background: transparent;
}
</style>
