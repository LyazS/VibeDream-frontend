<template>
  <div class="ask-user-tool-display">
    <div class="tool-header">
      <div class="status-dot"></div>
      <component :is="IconComponents.TOOLS_FILL" size="16px" class="tool-icon" />
      <div class="tool-title-group">
        <span class="tool-title">ask_user</span>
      </div>
    </div>

    <div v-if="askUserArgs" class="tool-params-expanded">
      <div class="ask-user-content">
        <div class="ask-user-question">{{ askUserArgs.question }}</div>
        <div v-if="askUserResponse" class="ask-user-response">
          <div class="ask-user-response-value">{{ askUserResponse }}</div>
        </div>
        <div v-else-if="displayOptions.length" class="ask-user-options">
          <button
            v-for="option in displayOptions"
            :key="option"
            type="button"
            class="ask-user-option-chip"
            :disabled="!isPendingAskUser || isSending"
            @click="submitAskUserOption(option)"
          >
            {{ option }}
          </button>
        </div>
        <form
          v-if="isPendingAskUser && !askUserResponse"
          class="ask-user-custom-form"
          @submit.prevent="submitCustomAnswer"
        >
          <input
            v-model="customAnswer"
            type="text"
            class="ask-user-custom-input"
            :placeholder="customInputPlaceholder"
            :disabled="isSending"
          />
          <button
            type="submit"
            class="ask-user-custom-submit"
            :disabled="isSending || !customAnswer.trim()"
          >
            提交自定义回复
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import type { AskUserToolArgs, ToolCallPart } from '../types'

const props = defineProps<{
  item: ToolCallPart
}>()

const isSending = computed(() => SESSION_MANAGER.isSending.value)
const isPendingAskUser = computed(() =>
  SESSION_MANAGER.isPendingAskUserToolCall(props.item.tool_call_id),
)
const askUserResponse = computed(() =>
  SESSION_MANAGER.getAskUserResponse(props.item.tool_call_id),
)
const customAnswer = ref('')

const askUserArgs = computed<AskUserToolArgs | null>(() => {
  const args = props.item.args
  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question) return null

  return {
    question,
    context: typeof args.context === 'string' ? args.context : undefined,
    answer_format: typeof args.answer_format === 'string' ? args.answer_format : undefined,
    suggested_options: Array.isArray(args.suggested_options)
      ? args.suggested_options.filter(
          (option): option is string => typeof option === 'string' && option.trim().length > 0,
        )
      : undefined,
    placeholder: typeof args.placeholder === 'string' ? args.placeholder : undefined,
  }
})

const displayOptions = computed(() => askUserArgs.value?.suggested_options || [])

const customInputPlaceholder = computed(
  () => askUserArgs.value?.placeholder || '其他，请输入你的自定义回复',
)

const submitAskUserOption = async (option: string) => {
  if (!isPendingAskUser.value || isSending.value) return
  await SESSION_MANAGER.submitPendingAskUserOption(option)
}

const submitCustomAnswer = async () => {
  if (!isPendingAskUser.value || isSending.value || !customAnswer.value.trim()) return
  const answer = customAnswer.value
  customAnswer.value = ''
  await SESSION_MANAGER.submitPendingAskUserResponse(answer)
}
</script>

<style scoped>
.ask-user-tool-display {
  margin: 2px 0;
  padding: 6px 6px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.22);
  width: 100%;
  box-sizing: border-box;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  user-select: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #10b981;
  flex-shrink: 0;
}

.tool-icon {
  flex-shrink: 0;
  color: #9ca3af;
}

.tool-title-group {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.tool-title {
  font-weight: 600;
  font-size: 13px;
  color: #cbd0d6;
}

.tool-subtitle {
  font-size: 12px;
  color: #93c5fd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-params-expanded {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 12px;
}

.ask-user-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--color-text-primary);
}

.ask-user-question {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  color: #eff6ff;
}

.ask-user-options {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.ask-user-option-chip {
  border: 1px solid rgba(96, 165, 250, 0.3);
  background: rgba(59, 130, 246, 0.12);
  color: #bfdbfe;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.ask-user-option-chip:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(96, 165, 250, 0.5);
  transform: translateY(-1px);
}

.ask-user-option-chip:disabled {
  opacity: 0.55;
  cursor: default;
}

.ask-user-custom-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ask-user-custom-input {
  width: 100%;
  border: 1px solid rgba(96, 165, 250, 0.24);
  background: rgba(15, 23, 42, 0.45);
  color: #e5eefb;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
  box-sizing: border-box;
}

.ask-user-custom-input:focus {
  border-color: rgba(96, 165, 250, 0.55);
}

.ask-user-custom-input:disabled {
  opacity: 0.6;
}

.ask-user-custom-submit {
  align-self: flex-start;
  border: 1px solid rgba(96, 165, 250, 0.28);
  background: rgba(59, 130, 246, 0.18);
  color: #dbeafe;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.ask-user-custom-submit:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.24);
  border-color: rgba(96, 165, 250, 0.46);
}

.ask-user-custom-submit:disabled {
  opacity: 0.55;
  cursor: default;
}

.ask-user-response {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.22);
}

.ask-user-response-value {
  font-size: 13px;
  line-height: 1.5;
  color: #ecfdf5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
