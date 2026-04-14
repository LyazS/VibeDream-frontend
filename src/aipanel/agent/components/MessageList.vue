<template>
  <div class="chat-messages-container" ref="messagesContainer">
    <AgentMessage :message="welcomeMessage" />
    <template v-for="message in messages" :key="message.id">
      <UserMessage v-if="isUserMessage(message)" :message="message" />
      <AgentMessage
        v-else
        :message="message"
        :is-task-complete="SESSION_MANAGER.isTaskCompleteMessage(message.id)"
      />
    </template>
    <ThinkingIndicator v-if="isSending" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, provide, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import UserMessage from './UserMessage.vue'
import AgentMessage from './AgentMessage.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import { AgentMessageRole, MessagePartType, isUserMessage } from '@/aipanel/agent/types'
import type { AgentMessage as AgentMessageModel } from '@/aipanel/agent/types'
import { useAppI18n } from '@/core/composables/useI18n'

// AI 发送状态
const isSending = computed(() => SESSION_MANAGER.isSending.value)

// 创建共享的markdown-it实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})

const renderMarkdown = (content: string) => {
  return md.render(content)
}

provide('renderMarkdown', renderMarkdown)

const messages = computed(() =>
  SESSION_MANAGER.messages.value.filter((message) => message.role !== AgentMessageRole.TOOL),
)

const { t } = useAppI18n()

const welcomeMessage = computed<AgentMessageModel>(() => ({
  id: 'welcome-1',
  role: AgentMessageRole.ASSISTANT,
  parts: [
    {
      type: MessagePartType.TEXT,
      text: t('common.chat.welcomeMessage'),
    },
  ],
  created_at: new Date().toISOString(),
}))

const messagesContainer = ref<HTMLElement>()

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

watch(
  messages,
  () => {
    scrollToBottom()
  },
  { deep: true },
)

scrollToBottom()
</script>

<style scoped>
.chat-messages-container {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

/* 滚动条样式 */
.chat-messages-container::-webkit-scrollbar {
  width: 6px;
}

.chat-messages-container::-webkit-scrollbar-track {
  background: var(--color-bg-primary);
  border-radius: 3px;
}

.chat-messages-container::-webkit-scrollbar-thumb {
  background: var(--color-border-secondary);
  border-radius: 3px;
}

.chat-messages-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-primary);
}
</style>
