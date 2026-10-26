<template>
  <div
    v-if="status === 'thinking'"
    class="thinking-indicator"
    :class="{ 'thinking-indicator--expanded': expanded && reasoning.trim() }"
  >
    <button
      type="button"
      class="thinking-indicator__toggle"
      :aria-expanded="expanded"
      :aria-controls="contentId"
      @click="expanded = !expanded"
    >
      <span class="thinking-indicator__label" role="status" aria-live="polite">
        {{ t('aiPanel.agentStatus.thinking') }}
      </span>
      <span class="thinking-indicator__ellipsis" aria-hidden="true">.....</span>
    </button>
    <div
      v-show="expanded && reasoning.trim()"
      :id="contentId"
      ref="body"
      class="thinking-indicator__content"
      tabindex="0"
      role="region"
      :aria-label="t('common.chat.reasoning')"
      aria-live="off"
    >
      {{ reasoning }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppI18n } from '@/core/composables/useI18n'
import { nextTick, ref, useId, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    status: 'thinking' | 'completed'
    reasoning?: string
    modelCallId?: string
  }>(),
  { reasoning: '' },
)

const { t } = useAppI18n()
const contentId = useId()
const expanded = ref(false)
const body = ref<HTMLElement>()

watch(
  () => props.status,
  (status) => {
    if (status !== 'thinking') expanded.value = false
  },
)

watch(
  () => [props.modelCallId, props.reasoning] as const,
  async ([callId], [previousCallId]) => {
    const element = body.value
    const changedCall = callId !== previousCallId
    const follow = element && element.scrollHeight - element.scrollTop - element.clientHeight < 32
    await nextTick()
    if (!body.value) return
    if (changedCall) body.value.scrollTop = 0
    else if (follow && expanded.value) body.value.scrollTop = body.value.scrollHeight
  },
)
</script>

<style scoped>
.thinking-indicator {
  align-self: flex-start;
  flex-shrink: 0;
  max-width: 100%;
  min-width: 0;
  background: var(--color-bg-secondary);
  border-radius: 12px;
  width: fit-content;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  text-wrap: pretty;
}

.thinking-indicator--expanded {
  width: 100%;
}

.thinking-indicator__toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 40px;
  padding: 12px 16px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.thinking-indicator__toggle:hover {
  color: var(--color-text-primary);
}

.thinking-indicator__toggle:focus-visible,
.thinking-indicator__content:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
}

.thinking-indicator__content {
  max-height: 220px;
  padding: 0 16px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-base);
  line-height: 1.65;
}

.thinking-indicator__label,
.thinking-indicator__ellipsis {
  font-variant-numeric: tabular-nums;
}

.thinking-indicator__ellipsis {
  display: inline-block;
  width: 5ch;
  overflow: hidden;
  white-space: nowrap;
  animation: thinking-ellipsis 1.6s step-end infinite;
}

@keyframes thinking-ellipsis {
  0%,
  11.11% {
    width: 1ch;
  }
  22.22% {
    width: 2ch;
  }
  33.33% {
    width: 3ch;
  }
  44.44% {
    width: 4ch;
  }
  55.56% {
    width: 5ch;
  }
  66.67% {
    width: 4ch;
  }
  77.78% {
    width: 3ch;
  }
  88.89% {
    width: 2ch;
  }
  100% {
    width: 1ch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-indicator__ellipsis {
    animation: none;
    width: 3ch;
  }
}
</style>
