<template>
  <template v-if="!showHistory">
    <MessageList />
    <AgentInput />
  </template>
  <template v-else>
    <SessionHistoryPanel @close="emit('update:showHistory', false)" />
  </template>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MessageList from './MessageList.vue'
import AgentInput from './AgentInput.vue'
import SessionHistoryPanel from './SessionHistoryPanel.vue'

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
/* Agent 面板样式 */
</style>
