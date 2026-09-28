<template>
  <div v-if="demoMode || !pendingAskUserArgs" class="chat-input-wrapper">
    <div class="chat-input-shell">
      <div class="chat-input-main">
        <textarea
          v-model="inputMessage"
          class="chat-textarea"
          :placeholder="inputPlaceholder"
          :style="textareaStyle"
          autocomplete="off"
          :disabled="demoMode && (demoConnecting || demoSending)"
          @input="adjustTextareaHeight"
          @keydown.enter="handleEnterKey"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
        />
        <ChatSendButton
          :disabled="
            (demoMode && demoConnecting) ||
            (hasProcessingMessage ? false : !inputMessage.trim())
          "
          :title="hasProcessingMessage ? t('common.chat.stop') : t('common.chat.send')"
          :icon="hasProcessingMessage ? IconComponents.STOP : IconComponents.SEND"
          @click="hasProcessingMessage ? handleStop() : handleSend()"
        />
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
import ChatSendButton from '@/components/base/ChatSendButton.vue'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

const props = withDefaults(
  defineProps<{
    demoMode?: boolean
    demoConnecting?: boolean
    demoSending?: boolean
  }>(),
  { demoMode: false, demoConnecting: false, demoSending: false },
)
const emit = defineEmits<{
  demoSend: [text: string, onSubmitted: () => void, onRejected: () => void]
  demoStop: []
}>()

const inputMessage = ref('')
const isComposing = ref(false) // 跟踪输入法 composition 状态
const textareaHeight = ref(72) // 初始高度 72px (3行 × 24px)

// 检查是否有进行中的消息（使用响应式计算属性）
const hasProcessingMessage = computed(() =>
  props.demoMode ? props.demoSending : SESSION_MANAGER.isSending.value,
)
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
  if (
    !inputMessage.value.trim() ||
    (props.demoMode && (props.demoConnecting || props.demoSending))
  )
    return

  const draft = inputMessage.value
  const message = draft.trim()

  if (props.demoMode) {
    emit(
      'demoSend',
      message,
      () => {
        if (inputMessage.value !== draft) return
        inputMessage.value = ''
        textareaHeight.value = MIN_LINES * LINE_HEIGHT
      },
      () => {
        if (inputMessage.value) return
        inputMessage.value = draft
        adjustTextareaHeight()
      },
    )
    return
  }

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
  if (props.demoMode) {
    emit('demoStop')
    return
  }
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
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.03) 0%,
    rgba(255, 255, 255, 0.018) 100%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 4px 10px rgba(0, 0, 0, 0.08);
  transition:
    box-shadow var(--transition-fast),
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.chat-input-main:focus-within {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.022) 100%
  );
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
</style>
