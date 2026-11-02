<template>
  <div v-if="visibleMessages.length" class="chat-message ai">
    <div class="message-bubble">
      <div v-for="message in visibleMessages" :key="message.id" class="message-section">
        <div class="message-content">
          <template v-for="(item, index) in message.parts" :key="index">
            <div
              v-if="item.type === MessagePartType.TEXT && item.text.trim()"
              class="markdown-body"
              v-html="renderMarkdown(item.text)"
            ></div>
            <ToolCallDisplay v-else-if="item.type === MessagePartType.TOOL_CALL" :item="item" />
          </template>
          <div
            v-if="message.modelCallStatus === 'cancelled' || message.modelCallStatus === 'failed'"
            class="message-status"
          >
            {{
              t(
                message.modelCallStatus === 'cancelled'
                  ? 'common.chat.replyCancelled'
                  : 'common.chat.replyFailed',
              )
            }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type DeepReadonly } from 'vue'
import 'github-markdown-css/github-markdown.css'
import type { AgentMessage } from '@/core/agent/types'
import { MessagePartType } from '@/core/agent/types'
import ToolCallDisplay from './ToolCallDisplay.vue'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

// 注入markdown渲染函数
const renderMarkdown = inject<(content: string) => string>('renderMarkdown', (content: string) => {
  return content
})

const props = defineProps<{
  messages: readonly DeepReadonly<AgentMessage>[]
}>()

const visibleMessages = computed(() =>
  props.messages.filter(
    (message) =>
      message.parts.some(
        (part) =>
          part.type === MessagePartType.TOOL_CALL ||
          (part.type === MessagePartType.TEXT && part.text.trim()),
      ) ||
      message.modelCallStatus === 'cancelled' ||
      message.modelCallStatus === 'failed',
  ),
)
</script>

<style scoped>
.chat-message {
  display: flex;
}

.chat-message.ai {
  justify-content: flex-start;
  width: 100%;
}

.message-bubble {
  max-width: 95%;
  padding: 0 var(--spacing-md);
  border-radius: var(--border-radius-large);
  position: relative;
  word-wrap: break-word;
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  font-size: var(--font-size-base);
  line-height: 1.4;
  width: 100%;
}

.message-section + .message-section {
  margin-top: var(--spacing-md);
}

.markdown-body {
  color: var(--color-text-primary);
  background-color: transparent;

  /* github-markdown-css follows the OS color scheme by default. Keep rendered
     Markdown aligned with LightCut's dark editor theme instead. */
  --fgColor-default: var(--color-text-primary);
  --fgColor-muted: var(--color-text-secondary);
  --bgColor-default: var(--color-bg-secondary);
  --bgColor-muted: var(--color-bg-tertiary);
  --borderColor-default: var(--color-border-primary);
  --borderColor-muted: var(--color-border-secondary);
}

.message-status {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.markdown-body table {
  display: block;
  overflow-x: auto;
}

.markdown-body table tr {
  background-color: var(--color-bg-secondary);
}

.markdown-body table tr:nth-child(2n) {
  background-color: var(--color-bg-tertiary);
}
</style>
