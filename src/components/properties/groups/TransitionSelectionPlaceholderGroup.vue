<template>
  <div class="transition-selection-placeholder">
    <div class="property-section">
      <h4>{{ t('properties.transition.title') }}</h4>

      <div class="placeholder-card">
        <div class="placeholder-row">
          <span>{{ t('properties.transitionSelection.effectAsset') }}</span>
          <strong>{{ templateName }}</strong>
        </div>
        <div class="placeholder-row">
          <span>{{ t('properties.transition.status') }}</span>
          <strong>{{ bindingStateText }}</strong>
        </div>
        <div class="placeholder-row">
          <span>{{ t('properties.transitionSelection.sourceClip') }}</span>
          <strong>{{ sourceClipName }}</strong>
        </div>
        <p class="placeholder-hint">
          {{ t('properties.transitionSelection.placeholder') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { TimelineTransitionOverlayViewModel } from '@/core/timelineitem/transitionOverlay'

interface Props {
  overlay: TimelineTransitionOverlayViewModel
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

const sourceClipName = computed(() => {
  const sourceItem = unifiedStore.getTimelineItem(props.overlay.sourceItemId)
  if (!sourceItem || sourceItem.mediaItemId === null) {
    return '-'
  }

  return unifiedStore.getMediaItem(sourceItem.mediaItemId)?.name || '-'
})

const templateName = computed(() => {
  const sourceItem = unifiedStore.getTimelineItem(props.overlay.sourceItemId)
  const assetId = sourceItem?.transitionOut?.templateAssetId
  if (!assetId) return '-'
  return unifiedStore.getAsset(assetId)?.name || assetId
})

const bindingStateText = computed(() => {
  const key = props.overlay.bindingState === 'invalid-target'
    ? 'invalidTarget'
    : props.overlay.bindingState === 'invalid-overlap'
      ? 'invalidOverlap'
      : props.overlay.bindingState

  return t(`properties.transition.statuses.${key}`)
})
</script>

<style scoped>
.transition-selection-placeholder {
  width: 100%;
}

.placeholder-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--border-radius-medium);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-secondary);
}

.placeholder-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.placeholder-row strong {
  color: var(--color-text-primary);
  font-weight: 600;
}

.placeholder-hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
</style>
