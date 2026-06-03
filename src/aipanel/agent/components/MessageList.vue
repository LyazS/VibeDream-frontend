<template>
  <div class="chat-messages-container" ref="messagesContainer">
    <AgentMessage :message="welcomeMessage" />
    <template v-for="item in timelineItems" :key="item.id">
      <UserMessage v-if="item.type === 'message' && isUserMessage(item.message)" :message="item.message" />
      <AgentMessage
        v-else-if="item.type === 'message' && isAssistantMessage(item.message)"
        :message="item.message"
        :is-task-complete="SESSION_MANAGER.isTaskCompleteMessage(item.message.id)"
      />
      <InteractionCard v-else-if="item.type === 'interaction'" :record="item.record" />
    </template>
    <ThinkingIndicator v-if="isSending" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, provide, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import UserMessage from './UserMessage.vue'
import AgentMessage from './AgentMessage.vue'
import InteractionCard from './InteractionCard.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import {
  AgentMessageRole,
  MessagePartType,
  isAssistantMessage,
  isPublicMessage,
  isUserMessage,
} from '@/aipanel/agent/types'
import type {
  AgentMessage as AgentMessageModel,
  SessionInteractionRecord,
} from '@/aipanel/agent/types'
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

const messages = computed(() => SESSION_MANAGER.messages.value.filter(isPublicMessage))
const interactions = computed(() => SESSION_MANAGER.interactions.value)

type TimelineItem =
  | { type: 'message'; id: string; createdAt: string; message: AgentMessageModel }
  | { type: 'interaction'; id: string; createdAt: string; record: SessionInteractionRecord }

const timelineItems = computed<TimelineItem[]>(() => {
  const messageItems = messages.value.map((message) => ({
    type: 'message' as const,
    id: message.id,
    createdAt: message.created_at,
    message,
  }))
  const interactionItems = interactions.value.map((record) => ({
    type: 'interaction' as const,
    id: `interaction-${record.interrupt.interaction_id}`,
    createdAt: record.interrupt.created_at,
    record,
  }))

  return [...messageItems, ...interactionItems].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
})

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
  timelineItems,
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
