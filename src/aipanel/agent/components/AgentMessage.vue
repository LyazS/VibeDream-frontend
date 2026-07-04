<template>
  <div class="chat-message ai">
    <div class="message-bubble">
      <div v-for="message in messages" :key="message.id" class="message-section">
        <div class="message-content">
          <template v-for="(item, index) in message.parts" :key="index">
            <div
              v-if="item.type === MessagePartType.TEXT"
              class="markdown-body"
              v-html="renderMarkdown(item.text)"
            ></div>
            <ToolCallDisplay
              v-else-if="item.type === MessagePartType.TOOL_CALL"
              :item="item"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import 'github-markdown-css/github-markdown.css'
import type { AgentMessage } from '../types'
import { MessagePartType } from '../types'
import ToolCallDisplay from './ToolCallDisplay.vue'

// 注入markdown渲染函数
const renderMarkdown = inject<(content: string) => string>('renderMarkdown', (content: string) => {
  return content
})

const props = defineProps<{
  messages: AgentMessage[]
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

.message-content {
  font-size: var(--font-size-base);
  line-height: 1.4;
  margin-bottom: var(--spacing-xs);
  width: 100%;
}

.message-section + .message-section {
  margin-top: var(--spacing-md);
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
</style>
