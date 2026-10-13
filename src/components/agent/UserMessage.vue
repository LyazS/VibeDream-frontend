<template>
  <div class="chat-message user">
    <div v-if="images.length" class="message-images">
      <AgentImage v-for="image in images" :key="image.imageId" :image-id="image.imageId" />
    </div>
    <div v-if="textParts.length" class="message-bubble">
      <div v-for="(text, index) in textParts" :key="index" class="message-content">
        {{ text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentMessage } from '@/core/agent/types'
import { MessagePartType } from '@/core/agent/types'
import { computed, type DeepReadonly } from 'vue'
import AgentImage from './AgentImage.vue'

const props = defineProps<{
  message: DeepReadonly<AgentMessage>
}>()

const images = computed(() =>
  props.message.parts.filter((part) => part.type === MessagePartType.IMAGE),
)
const textParts = computed(() =>
  props.message.parts.flatMap((part) =>
    part.type === MessagePartType.TEXT && part.text.trim() ? [part.text] : [],
  ),
)
</script>

<style scoped>
.chat-message {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  margin-bottom: var(--spacing-sm);
}

.message-images {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-width: 100%;
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
