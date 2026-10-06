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
import { MessagePartType } from '@/aipanel/agent/types'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  message: DeepReadonly<AgentMessage>
}>()

const getMessageText = () => {
  return props.message.parts
    .filter((item) => item.type === MessagePartType.TEXT)
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
