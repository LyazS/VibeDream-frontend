<template>
  <div class="chat-message user">
    <div class="message-bubble">
      <div class="message-content">
        {{ getMessageText() }}
      </div>
      <div class="message-timestamp">{{ message.timestamp }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageUser } from '@/aipanel/agent/types'
import { ChatMessageUserContentType } from '@/aipanel/agent/types'

const props = defineProps<{
  message: ChatMessageUser
}>()

// 获取消息的文本内容（用户消息只包含文本）
const getMessageText = () => {
  return props.message.content
    .filter((item) => item.type === ChatMessageUserContentType.TEXT)
    .map((item) => item.content)
    .join('')
}
</script>

<style scoped>
.chat-message {
  display: flex;
  margin-bottom: var(--spacing-sm);
}

.chat-message.user {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 70%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-large);
  position: relative;
  word-wrap: break-word;
}

.chat-message.user .message-bubble {
  background-color: #3b82f6;
  color: white;
  border-bottom-right-radius: var(--border-radius-small);
  position: relative;
}

/* 添加气泡小角 */
.chat-message.user .message-bubble::after {
  content: '';
  position: absolute;
  bottom: 0;
  right: -8px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 10px 0 0 10px;
  border-color: transparent transparent transparent #3b82f6;
}

.message-content {
  font-size: var(--font-size-base);
  line-height: 1.4;
  margin-bottom: var(--spacing-xs);
}

.message-timestamp {
  font-size: var(--font-size-xs);
  opacity: 0.7;
  text-align: right;
}
</style>
