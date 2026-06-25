<template>
  <div class="interaction-card">
    <div class="interaction-header">
      <component :is="IconComponents.TOOLS_FILL" size="16px" class="interaction-icon" />
      <div class="interaction-question">{{ record.interrupt.prompt }}</div>
    </div>

    <div v-if="record.result" class="interaction-response">
      <div class="interaction-response-value">{{ record.result.answer }}</div>
    </div>

    <div v-else class="interaction-body">
      <div v-if="record.interrupt.options.length" class="interaction-options">
        <div
          v-for="(option, index) in record.interrupt.options"
          :key="option"
          class="interaction-option-row"
        >
          <span class="interaction-option-index">{{ index + 1 }}</span>
          <button
            type="button"
            class="interaction-option-chip"
            :disabled="!isPending || isSending"
            @click="submitOption(option)"
          >
            <span class="interaction-option-text">{{ option }}</span>
          </button>
        </div>
      </div>
      <form
        v-if="isPending"
        class="interaction-custom-form"
        @submit.prevent="submitCustomAnswer"
      >
        <div class="interaction-custom-index">
          {{ record.interrupt.options.length + 1 }}
        </div>
        <input
          v-model="customAnswer"
          type="text"
          class="interaction-custom-input"
          :placeholder="customInputPlaceholder"
          :disabled="isSending"
        />
        <button
          type="submit"
          class="interaction-custom-submit"
          :disabled="isSending || !customAnswer.trim()"
        >
          {{ t('aiPanel.interaction.submitCustom') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import { useAppI18n } from '@/core/composables/useI18n'
import type { SessionInteractionRecord } from '../types'

const props = defineProps<{
  record: SessionInteractionRecord
}>()

const { t } = useAppI18n()
const isSending = computed(() => SESSION_MANAGER.isSending.value)
const isPending = computed(
  () => SESSION_MANAGER.pendingInteraction.value?.interaction_id === props.record.interrupt.interaction_id,
)
const customAnswer = ref('')

const customInputPlaceholder = computed(
  () => props.record.interrupt.placeholder || t('aiPanel.interaction.customPlaceholder'),
)

const submitOption = async (option: string) => {
  if (!isPending.value || isSending.value) return
  try {
    await SESSION_MANAGER.submitPendingAskUserOption(option)
  } catch {
    // SessionManager already exposes the user-facing error state.
  }
}

const submitCustomAnswer = async () => {
  if (!isPending.value || isSending.value || !customAnswer.value.trim()) return
  const answer = customAnswer.value
  customAnswer.value = ''
  try {
    await SESSION_MANAGER.submitPendingAskUserResponse(answer)
  } catch {
    customAnswer.value = answer
  }
}
</script>

<style scoped>
.interaction-card {
  margin: 2px 0;
  padding: var(--spacing-lg);
  border-radius: var(--border-radius-large);
  background: rgba(255, 255, 255, 0.035);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  width: 100%;
  box-sizing: border-box;
}

.interaction-header {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.interaction-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #ff9f43;
}

.interaction-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.interaction-question {
  flex: 1;
  font-size: var(--font-size-lg);
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-text-primary);
}

.interaction-response {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--border-radius-medium);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.interaction-response-value {
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.interaction-options {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--spacing-sm);
}

.interaction-option-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.interaction-option-chip {
  flex: 1;
  min-width: 0;
  border: none;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
  border-radius: var(--border-radius-large);
  padding: 10px 12px;
  font-size: var(--font-size-base);
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.interaction-option-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.interaction-option-text {
  flex: 1;
  min-width: 0;
}

.interaction-option-chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
  transform: translateY(-1px);
}

.interaction-option-chip:focus-visible {
  outline: none;
  background: rgba(255, 255, 255, 0.09);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.interaction-option-chip:disabled {
  opacity: 0.55;
  cursor: default;
}

.interaction-custom-form {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.interaction-custom-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.interaction-custom-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-border-primary);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border-radius: var(--border-radius-large);
  padding: 9px 12px;
  font-size: var(--font-size-md);
  line-height: 1.4;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}

.interaction-custom-input:focus {
  border-color: var(--color-accent-secondary);
  background: rgba(255, 255, 255, 0.02);
}

.interaction-custom-input:disabled {
  opacity: 0.6;
}

.interaction-custom-input::placeholder {
  color: var(--color-text-hint);
}

.interaction-custom-submit {
  border: 1px solid transparent;
  background: var(--color-bg-quaternary);
  color: var(--color-text-primary);
  border-radius: var(--border-radius-medium);
  padding: 8px 10px;
  font-size: var(--font-size-sm);
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.interaction-custom-submit:hover:not(:disabled) {
  background: var(--color-accent-secondary);
  color: #fff;
}

.interaction-custom-submit:active:not(:disabled) {
  transform: translateY(1px);
}

.interaction-custom-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
