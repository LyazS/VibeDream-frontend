<template>
  <div class="chat-messages-container" ref="messagesContainer">
    <AgentMessage :messages="[welcomeMessage]" />
    <template v-for="message in store.agentMessages" :key="message.id">
      <UserMessage v-if="message.role === AgentMessageRole.USER" :message="message" />
      <AgentMessage v-else :messages="[message]" />
      <InteractionCard v-if="message.interaction" :record="message.interaction" />
    </template>
    <ThinkingIndicator v-if="indicatorStatus" :status="indicatorStatus" />
    <div v-if="store.agentModelCall?.status === 'failed'" class="chat-error" role="alert">
      {{ store.agentModelCall?.error }}
    </div>
    <div v-if="store.agentStorageError" class="chat-error" role="alert">
      {{ store.agentStorageError }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, provide, computed, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import UserMessage from './UserMessage.vue'
import AgentMessage from './AgentMessage.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import InteractionCard from './InteractionCard.vue'
import { AgentMessageRole, MessagePartType } from '@/aipanel/agent/types'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'

const store = useUnifiedStore()
const { t } = useAppI18n()
const indicatorStatus = ref<'thinking' | 'completed' | null>(null)
let completedIndicatorTimer: ReturnType<typeof setTimeout> | null = null
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
provide('renderMarkdown', (content: string) => md.render(content))
const welcomeMessage = computed(() => ({
  id: 'welcome-1',
  role: AgentMessageRole.ASSISTANT,
  parts: [{ type: MessagePartType.TEXT as const, text: t('common.chat.welcomeMessage') }],
  created_at: new Date().toISOString(),
}))
const messagesContainer = ref<HTMLElement>()
async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value)
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
}
function clearCompletedIndicatorTimer() {
  if (completedIndicatorTimer !== null) clearTimeout(completedIndicatorTimer)
  completedIndicatorTimer = null
}
watch(() => store.agentMessages, scrollToBottom, { deep: true })
watch(
  () => store.agentRunning,
  (sending) => {
    clearCompletedIndicatorTimer()
    indicatorStatus.value = sending
      ? 'thinking'
      : store.agentModelCall?.status === 'completed' && !store.agentPendingInteraction
        ? 'completed'
        : null
    void scrollToBottom()
    if (indicatorStatus.value === 'completed') {
      completedIndicatorTimer = setTimeout(() => {
        indicatorStatus.value = null
        completedIndicatorTimer = null
      }, 1200)
    }
  },
  { immediate: true },
)
onBeforeUnmount(clearCompletedIndicatorTimer)
void scrollToBottom()
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
.chat-error {
  color: var(--color-error);
}
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
