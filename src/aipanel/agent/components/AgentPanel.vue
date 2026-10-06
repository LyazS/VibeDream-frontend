<template>
  <SessionHistoryPanel v-if="showHistory" @close="$emit('update:showHistory', false)" />
  <template v-else>
    <MessageList :key="store.agentSessionId" />
    <AgentInput v-if="!store.agentPendingInteraction" :key="store.agentSessionId" />
  </template>
</template>

<script setup lang="ts">
import MessageList from './MessageList.vue'
import AgentInput from './AgentInput.vue'
import SessionHistoryPanel from './SessionHistoryPanel.vue'
import { useUnifiedStore } from '@/core/unifiedStore'

const store = useUnifiedStore()

// 定义 props
defineProps<{
  showHistory: boolean
}>()

// 定义事件
defineEmits<{
  'update:showHistory': [value: boolean]
}>()
</script>

<style scoped>
/* Agent 面板样式 */
</style>
