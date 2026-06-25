<template>
  <div v-if="!pendingAskUserArgs" class="chat-input-wrapper">
    <div class="chat-input-shell">
      <div class="chat-input-main">
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
        <HoverButton
          variant="primary"
          class="chat-send-button"
          :disabled="hasProcessingMessage ? false : !inputMessage.trim()"
          :title="hasProcessingMessage ? t('common.chat.stop') : t('common.chat.send')"
          @click="hasProcessingMessage ? handleStop() : handleSend()"
        >
          <template #icon>
            <component
              :is="hasProcessingMessage ? IconComponents.STOP : IconComponents.SEND"
              size="18px"
            />
          </template>
        </HoverButton>
      </div>
    </div>
  </div>
  <div v-else class="chat-input-wrapper chat-input-wrapper--paused">
    <div class="chat-input-shell chat-input-shell--paused">
      <div class="paused-note">
        {{ t('aiPanel.interaction.pausedNote') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

// AgentInput 现在完全自主，不需要发射任何事件

const inputMessage = ref('')
const isComposing = ref(false) // 跟踪输入法 composition 状态
const textareaHeight = ref(72) // 初始高度 72px (3行 × 24px)

// 检查是否有进行中的消息（使用响应式计算属性）
const hasProcessingMessage = computed(() => SESSION_MANAGER.isSending.value)
const pendingInteraction = computed(() => SESSION_MANAGER.pendingInteraction.value)
const pendingAskUserArgs = computed(() => pendingInteraction.value)

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
  return pendingAskUserArgs.value?.prompt || t('common.chat.inputPlaceholder')
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
  try {
    await SESSION_MANAGER.handleSendMessage(message)
  } catch {
    inputMessage.value = message
    adjustTextareaHeight()
  }
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
  margin: 8px 16px 12px 16px;
}

.chat-input-shell {
  display: flex;
  flex-direction: column;
}

.chat-input-wrapper--paused {
  margin-top: 6px;
}

.chat-input-shell--paused {
  padding: 12px 14px;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025) 0%, rgba(255, 255, 255, 0.015) 100%),
    rgba(255, 255, 255, 0.01);
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.14),
    0 3px 10px rgba(0, 0, 0, 0.1);
}

.chat-input-main {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 88px;
  padding: 10px 58px 10px 12px;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.018) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 4px 10px rgba(0, 0, 0, 0.08);
  transition:
    box-shadow var(--transition-fast),
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.chat-input-main:focus-within {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.022) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 34px rgba(0, 0, 0, 0.2),
    0 8px 18px rgba(0, 0, 0, 0.14),
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 0 24px rgba(33, 150, 243, 0.1);
  transform: translateY(-2px);
}

.paused-note {
  width: 100%;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  text-wrap: pretty;
}

.chat-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  overflow-y: hidden;
  resize: none;
  text-wrap: pretty;
  -webkit-font-smoothing: antialiased;
}

.chat-textarea::placeholder {
  color: var(--color-text-secondary);
}

.chat-send-button {
  position: absolute;
  right: 10px;
  bottom: 10px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(33, 150, 243, 0.22) 0%, rgba(33, 150, 243, 0.12) 100%),
    rgba(255, 255, 255, 0.03);
  color: #d9eeff;
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.16),
    0 8px 18px rgba(0, 0, 0, 0.14);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.chat-input-main:focus-within .chat-send-button {
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.2),
    0 14px 26px rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}

.chat-send-button:hover:not(.hover-btn--disabled) {
  background:
    linear-gradient(180deg, rgba(33, 150, 243, 0.3) 0%, rgba(33, 150, 243, 0.16) 100%),
    rgba(255, 255, 255, 0.05);
  color: #fff;
  box-shadow:
    0 0 0 1px rgba(33, 150, 243, 0.24),
    0 12px 24px rgba(0, 0, 0, 0.18);
}

.chat-send-button:active:not(.hover-btn--disabled) {
  transform: scale(0.96);
}

.chat-send-button:deep(svg) {
  margin-left: 1px;
}
</style>
