<template>
  <template v-if="cloudChatDemoEnabled">
    <MessageList :demo-messages="demo.messages.value" :demo-sending="demo.isSending.value" />
    <div v-if="demo.errorText.value" class="chat-error" role="alert">
      {{ demo.errorText.value }}
    </div>
    <AgentInput
      demo-mode
      :demo-connecting="demo.isConnecting.value"
      :demo-sending="demo.isSending.value"
      @demo-send="sendDemoMessage"
      @demo-stop="demo.stop"
    />
  </template>
  <template v-else-if="!showHistory">
    <MessageList />
    <AgentInput />
  </template>
  <template v-else>
    <SessionHistoryPanel @close="emit('update:showHistory', false)" />
  </template>
</template>

<script setup lang="ts">
import MessageList from './MessageList.vue'
import AgentInput from './AgentInput.vue'
import SessionHistoryPanel from './SessionHistoryPanel.vue'
import { cloudChatDemoEnabled, useCloudChatDemo } from '../composables/useCloudChatDemo'

const demo = useCloudChatDemo()
const sendDemoMessage = (text: string, onSubmitted: () => void, onRejected: () => void) => {
  void demo.send(text, onSubmitted, onRejected).catch(() => {})
}

// 定义 props
defineProps<{
  showHistory: boolean
}>()

// 定义事件
const emit = defineEmits<{
  'update:showHistory': [value: boolean]
}>()
</script>

<style scoped>
.chat-error {
  margin: 0 16px;
  padding: 8px 10px;
  color: var(--color-text-primary);
  background: rgba(190, 65, 55, 0.18);
  border: 1px solid rgba(230, 104, 86, 0.4);
  border-radius: 6px;
  font-size: 12px;
}
</style>
