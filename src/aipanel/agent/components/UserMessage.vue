<template>
  <div class="chat-message user">
    <div class="message-bubble">
      <div class="message-content">
        {{ getMessageText() }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentMessage } from '@/aipanel/agent/types'
import { getMessageTextParts } from '@/aipanel/agent/types'

const props = defineProps<{
  message: AgentMessage
}>()

const getMessageText = () => {
  return getMessageTextParts(props.message)
    .map((item) => item.text)
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
}

.message-content {
  font-size: var(--font-size-base);
  line-height: 1.4;
}
</style>
