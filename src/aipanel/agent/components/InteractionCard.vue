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
          :placeholder="t('aiPanel.interaction.customPlaceholder')"
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045) 0%, rgba(255, 255, 255, 0.028) 100%),
    rgba(255, 255, 255, 0.02);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.05),
    0 6px 16px rgba(0, 0, 0, 0.12),
    0 2px 6px rgba(0, 0, 0, 0.1);
  width: 100%;
  box-sizing: border-box;
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.interaction-card:hover {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.07),
    0 10px 24px rgba(0, 0, 0, 0.16),
    0 3px 8px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
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
  background: rgba(255, 255, 255, 0.045);
  border-radius: var(--border-radius-medium);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.045),
    0 4px 10px rgba(0, 0, 0, 0.08);
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.03) 100%);
  color: var(--color-text-primary);
  border-radius: var(--border-radius-large);
  min-height: 40px;
  padding: 10px 12px;
  font-size: var(--font-size-base);
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 3px 8px rgba(0, 0, 0, 0.08);
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0.05) 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.07),
    0 8px 18px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}

.interaction-option-chip:focus-visible {
  outline: none;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0.05) 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.14),
    0 0 0 3px rgba(255, 159, 67, 0.12),
    0 8px 18px rgba(0, 0, 0, 0.12);
}

.interaction-option-chip:active:not(:disabled) {
  transform: scale(0.96);
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
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-primary);
  border-radius: var(--border-radius-large);
  min-height: 40px;
  padding: 9px 12px;
  font-size: var(--font-size-md);
  line-height: 1.4;
  outline: none;
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.interaction-custom-input:focus {
  border-color: var(--color-accent-secondary);
  background: rgba(255, 255, 255, 0.04);
  box-shadow:
    0 0 0 1px rgba(255, 159, 67, 0.16),
    0 6px 14px rgba(0, 0, 0, 0.1);
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
  min-height: 40px;
  padding: 8px 10px;
  font-size: var(--font-size-sm);
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 3px 8px rgba(0, 0, 0, 0.08);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.interaction-custom-submit:hover:not(:disabled) {
  background: var(--color-accent-secondary);
  color: #fff;
  box-shadow:
    0 0 0 1px rgba(255, 159, 67, 0.14),
    0 8px 18px rgba(0, 0, 0, 0.14);
}

.interaction-custom-submit:active:not(:disabled) {
  transform: scale(0.96);
}

.interaction-custom-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
