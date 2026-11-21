<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="linked-media-import-progress-modal"
      :aria-label="t('media.linked.importing')"
      @cancel.prevent
      @keydown.stop
    >
      <component
        :is="IconComponents.LOADING"
        class="progress-spinner"
        size="48px"
        aria-hidden="true"
      />
      <h2 class="progress-title">{{ t('media.linked.importing') }}</h2>
      <p class="progress-stage" role="status">{{ stage }}</p>

      <div v-if="percentage !== undefined" class="progress-meter">
        <div
          class="progress-track"
          role="progressbar"
          :aria-label="t('media.linked.importing')"
          :aria-valuenow="Math.round(percentage)"
        >
          <div class="progress-fill" :style="{ width: `${percentage}%` }"></div>
        </div>
        <span class="progress-percentage" aria-hidden="true">{{ Math.round(percentage) }}%</span>
      </div>

      <p v-if="stopping" class="progress-stopping" role="status">
        {{ t('media.linked.stopping') }}
      </p>
      <button
        class="cancel-button"
        type="button"
        :disabled="stopping"
        autofocus
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'

const props = defineProps<{
  visible: boolean
  stage: string
  percentage?: number
  stopping: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()
const { t } = useAppI18n()
const dialog = ref<HTMLDialogElement>()

watchEffect(
  () => {
    const element = dialog.value
    if (!element || element.open === props.visible) return
    if (props.visible) element.showModal()
    else element.close()
  },
  { flush: 'post' },
)
</script>

<style scoped>
.linked-media-import-progress-modal {
  width: min(320px, calc(100% - 32px));
  box-sizing: border-box;
  margin: auto;
  padding: 32px;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  text-align: center;
}

.linked-media-import-progress-modal::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.progress-spinner {
  margin-bottom: 16px;
  color: var(--color-accent-primary);
  animation: progress-spin 2s linear infinite;
}

@keyframes progress-spin {
  to {
    transform: rotate(360deg);
  }
}

.progress-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
  text-wrap: balance;
}

.progress-stage,
.progress-percentage {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.progress-stage {
  margin: 0 0 20px;
  font-size: 16px;
}

.progress-meter {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 14px;
}

.progress-track {
  height: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-secondary));
  border-radius: inherit;
  transition: width 0.15s ease-out;
}

.progress-stopping {
  margin: 0 0 16px;
  color: var(--color-text-muted);
  font-size: 14px;
  text-wrap: pretty;
}

.cancel-button {
  min-height: 40px;
  padding: 8px 24px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border-primary);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.cancel-button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.cancel-button:active:not(:disabled) {
  transform: scale(0.96);
}

.cancel-button:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .progress-spinner {
    animation: none;
  }

  .progress-fill,
  .cancel-button {
    transition: none;
  }
}
</style>
