<template>
  <div v-if="!pendingAskUserArgs" class="chat-input-wrapper">
    <textarea
      v-model="inputMessage"
      class="chat-textarea"
      :placeholder="inputPlaceholder"
      :style="textareaStyle"
      autocomplete="off"
      @input="adjustTextareaHeight"
      @keydown.enter="handleEnterKey"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
    />
    <div class="chat-actions">
      <HoverButton
        variant="primary"
        :disabled="hasProcessingMessage ? false : !inputMessage.trim()"
        :title="hasProcessingMessage ? t('common.chat.stop') : t('common.chat.send')"
        @click="hasProcessingMessage ? handleStop() : handleSend()"
      >
        <template #icon>
          <component
            :is="hasProcessingMessage ? IconComponents.STOP : IconComponents.SEND"
            size="20px"
          />
        </template>
      </HoverButton>
    </div>
  </div>
  <div v-else class="chat-input-wrapper chat-input-wrapper--paused">
    <div class="paused-note">
      请在上方问题卡片中选择一个选项，或使用第 4 个输入框填写自定义回复。
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import type { AskUserToolArgs } from '@/aipanel/agent/types'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

// AgentInput 现在完全自主，不需要发射任何事件

const inputMessage = ref('')
const isComposing = ref(false) // 跟踪输入法 composition 状态
const textareaHeight = ref(72) // 初始高度 72px (3行 × 24px)

// 检查是否有进行中的消息（使用响应式计算属性）
const hasProcessingMessage = computed(() => SESSION_MANAGER.isSending.value)
const pendingAskUserArgs = computed<AskUserToolArgs | null>(() => SESSION_MANAGER.getPendingAskUserArgs())

// 基础行高（字体大小 + 行间距）
const LINE_HEIGHT = 24 // px
const MIN_LINES = 3
const MAX_LINES = 10

const textareaStyle = computed(() => ({
  overflowY:
    textareaHeight.value >= MAX_LINES * LINE_HEIGHT ? ('auto' as const) : ('hidden' as const),
  resize: 'none' as const,
  height: `${textareaHeight.value}px`,
  minHeight: `${MIN_LINES * LINE_HEIGHT}px`,
  maxHeight: `${MAX_LINES * LINE_HEIGHT}px`,
}))

const inputPlaceholder = computed(() => {
  const placeholder = pendingAskUserArgs.value?.placeholder
  if (typeof placeholder === 'string' && placeholder.trim()) {
    return placeholder
  }
  return pendingAskUserArgs.value?.question || t('common.chat.inputPlaceholder')
})

const adjustTextareaHeight = () => {
  // 简单计算行数：根据换行符数量 + 1
  const lineBreaks = (inputMessage.value.match(/\n/g) || []).length
  const estimatedLines = lineBreaks + 1

  // 根据行数计算高度
  const newHeight = Math.min(
    Math.max(estimatedLines * LINE_HEIGHT, MIN_LINES * LINE_HEIGHT),
    MAX_LINES * LINE_HEIGHT,
  )

  textareaHeight.value = newHeight
}

const handleEnterKey = (event: KeyboardEvent) => {
  // 如果正在使用输入法，不处理 Enter 键
  if (isComposing.value) {
    return
  }

  if (!event.shiftKey) {
    event.preventDefault() // 只有普通Enter才阻止默认行为
    handleSend()
  } else {
    // Shift+Enter 换行，允许默认行为，然后调整高度
    nextTick(() => {
      adjustTextareaHeight()
    })
  }
}

const handleSend = async () => {
  if (!inputMessage.value.trim()) return

  const message = inputMessage.value.trim()

  // 清空输入框并重置高度
  inputMessage.value = ''
  textareaHeight.value = MIN_LINES * LINE_HEIGHT // 重置为最小高度(3行)

  // 使用 SessionManager 处理消息发送（回调函数现在是可选的）
  await SESSION_MANAGER.handleSendMessage(message)
}

// 停止当前进行中的消息
const handleStop = () => {
  // 中止当前进行中的消息请求
  SESSION_MANAGER.abortCurrentMessage()
  console.log('已停止当前进行中的消息')
}
</script>

<style scoped>
.chat-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  background-color: var(--color-bg-primary);
  border-radius: 12px;
  padding: 8px 8px;
  border: 1px solid var(--color-border-primary);
  transition: border-color 0.2s ease;
  margin: 8px 16px 12px 16px;
  border-top: 1px solid var(--color-border-primary);
}

.chat-input-wrapper:focus-within {
  border-color: #3b82f6;
}

.chat-input-wrapper--paused {
  align-items: stretch;
}

.paused-note {
  width: 100%;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  padding: 2px 4px;
}

.chat-textarea {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  overflow-y: hidden;
  resize: none;
}

.chat-textarea::placeholder {
  color: var(--color-text-secondary);
}

.chat-actions {
  display: flex;
  align-items: flex-end;
  padding-bottom: 0px;
}
</style>
