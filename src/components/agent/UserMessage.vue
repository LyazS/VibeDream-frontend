<template>
  <div class="chat-message user">
    <div class="message-bubble">
      <template v-for="(part, index) in message.parts" :key="index">
        <div v-if="part.type === MessagePartType.TEXT && part.text" class="message-content">
          {{ part.text }}
        </div>
        <AgentImage v-else-if="part.type === MessagePartType.IMAGE" :image-id="part.imageId" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentMessage } from '@/core/agent/types'
import { MessagePartType } from '@/core/agent/types'
import type { DeepReadonly } from 'vue'
import AgentImage from './AgentImage.vue'

defineProps<{
  message: DeepReadonly<AgentMessage>
}>()
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
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-base);
  line-height: 1.4;
}
</style>
