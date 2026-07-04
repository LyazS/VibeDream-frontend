<template>
  <div class="inspection-panel">
    <n-scrollbar
      class="inspection-scrollbar"
      style="flex: 1; max-height: 100%; padding: var(--spacing-md) var(--spacing-xl)"
    >
      <div class="inspection-stack">
        <section class="section-card">
          <div class="section-header">
            <div>
              <div class="section-title">{{ t('aiPanel.frameInspection.title') }}</div>
              <div class="section-desc">{{ t('aiPanel.frameInspection.description') }}</div>
            </div>
            <div class="meta-tags">
              <n-tag size="small" round>{{ t('aiPanel.frameInspection.maxPoints', { count: maxFrames }) }}</n-tag>
              <n-tag size="small" round>{{ t('aiPanel.frameInspection.durationHint', { timecode: projectDurationTimecode }) }}</n-tag>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">{{ t('aiPanel.frameInspection.instructionLabel') }}</label>
            <n-input
              v-model:value="instruction"
              class="inspection-input"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 6 }"
              :placeholder="t('aiPanel.frameInspection.instructionPlaceholder')"
            />
          </div>

          <div class="field-group">
            <label class="field-label">{{ t('aiPanel.frameInspection.timecodesLabel') }}</label>
            <n-input
              v-model:value="timecodesInput"
              class="inspection-input inspection-input--timecodes"
              type="textarea"
              :autosize="{ minRows: 6, maxRows: 12 }"
              :placeholder="t('aiPanel.frameInspection.timecodesPlaceholder')"
            />
            <div class="field-help">{{ t('aiPanel.frameInspection.timecodesHelp') }}</div>
          </div>

          <div class="action-row">
            <n-button
              type="primary"
              class="inspect-button"
              :loading="isRunning"
              :disabled="isRunning"
              @click="handleInspect"
            >
              {{ isRunning ? t('aiPanel.frameInspection.inspectingButton') : t('aiPanel.frameInspection.inspectButton') }}
            </n-button>
          </div>
        </section>

        <div v-if="status !== 'idle'" class="status-alert-wrap">
          <n-alert :type="statusAlertType" :show-icon="true">
            <template #header>
              {{ statusTitle }}
            </template>
            <div class="status-content">
              <div>{{ statusMessage }}</div>
              <n-progress
                v-if="status !== 'error'"
                :percentage="progressPercentage"
                :show-indicator="true"
                :height="8"
                processing
              />
            </div>
          </n-alert>
        </div>

        <section class="section-card">
          <div class="section-title">{{ t('aiPanel.frameInspection.resultTitle') }}</div>

          <div v-if="previewFrames.length > 0" class="preview-grid">
            <div v-for="frame in previewFrames" :key="frame.timecode" class="preview-card">
              <img :src="frame.previewUrl" :alt="frame.timecode" class="preview-image" />
              <div class="preview-timecode">{{ frame.timecode }}</div>
            </div>
          </div>

          <div v-if="answer" class="answer-card">
            <div class="answer-header">
              <span>{{ t('aiPanel.frameInspection.answerLabel') }}</span>
              <n-tag size="small" round>{{ answerModel }}</n-tag>
            </div>
            <div class="answer-text">{{ answer }}</div>
          </div>

          <n-empty
            v-if="previewFrames.length === 0 && !answer"
            :description="t('aiPanel.frameInspection.emptyResult')"
          />
        </section>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NProgress,
  NScrollbar,
  NTag,
} from 'naive-ui'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  callFrameInspectionApi,
  captureInspectionFrames,
  FRAME_INSPECTION_MAX_FRAMES,
  framesToInspectionTimecode,
  normalizeInspectionTimecode,
  parseInspectionTimecode,
  uploadInspectionFrames,
  type FrameInspectionPoint,
} from './frameInspectionService'

type InspectionStage = 'idle' | 'capturing' | 'uploading' | 'inspecting' | 'done' | 'error'

interface PreviewFrameItem {
  timecode: string
  previewUrl: string
  imageUrl?: string
}

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

const instruction = ref('')
const timecodesInput = ref('')
const status = ref<InspectionStage>('idle')
const statusMessage = ref('')
const progressPercentage = ref(0)
const previewFrames = ref<PreviewFrameItem[]>([])
const answer = ref('')
const answerModel = ref('')

let activeAbortController: AbortController | null = null

const maxFrames = FRAME_INSPECTION_MAX_FRAMES
const isRunning = computed(
  () => status.value === 'capturing' || status.value === 'uploading' || status.value === 'inspecting',
)
const projectDurationTimecode = computed(() =>
  framesToInspectionTimecode(Math.max(0, unifiedStore.contentEndTimeFrames)),
)
const maxInspectableTimecode = computed(() =>
  framesToInspectionTimecode(Math.max(0, unifiedStore.contentEndTimeFrames - 1)),
)
const statusAlertType = computed<'info' | 'success' | 'error'>(() => {
  if (status.value === 'done') {
    return 'success'
  }
  if (status.value === 'error') {
    return 'error'
  }
  return 'info'
})
const statusTitle = computed(() => {
  switch (status.value) {
    case 'capturing':
      return t('aiPanel.frameInspection.status.capturing')
    case 'uploading':
      return t('aiPanel.frameInspection.status.uploading')
    case 'inspecting':
      return t('aiPanel.frameInspection.status.inspecting')
    case 'done':
      return t('aiPanel.frameInspection.status.done')
    case 'error':
      return t('aiPanel.frameInspection.status.error')
    default:
      return ''
  }
})

function setStatus(nextStatus: InspectionStage, message: string, percentage: number): void {
  status.value = nextStatus
  statusMessage.value = message
  progressPercentage.value = percentage
}

function cleanupPreviewFrames(): void {
  for (const frame of previewFrames.value) {
    URL.revokeObjectURL(frame.previewUrl)
  }
  previewFrames.value = []
}

function resetResultState(): void {
  cleanupPreviewFrames()
  answer.value = ''
  answerModel.value = ''
}

function buildValidatedPoints(): FrameInspectionPoint[] {
  const trimmedInstruction = instruction.value.trim()
  if (!trimmedInstruction) {
    throw new Error(t('aiPanel.frameInspection.errors.emptyInstruction'))
  }

  const rawLines = timecodesInput.value
    .split(/\r?\n/g)
    .map((line) => normalizeInspectionTimecode(line))
    .filter((line) => line.length > 0)

  if (rawLines.length === 0) {
    throw new Error(t('aiPanel.frameInspection.errors.emptyTimecodes'))
  }

  const deduped = new Map<string, FrameInspectionPoint>()
  const maxFrameExclusive = Math.max(0, unifiedStore.contentEndTimeFrames)
  if (maxFrameExclusive <= 0) {
    throw new Error(t('aiPanel.frameInspection.errors.emptyTimeline'))
  }

  for (const timecode of rawLines) {
    let frameNumber = 0
    try {
      frameNumber = parseInspectionTimecode(timecode)
    } catch {
      throw new Error(t('aiPanel.frameInspection.errors.invalidTimecode', { timecode }))
    }

    if (frameNumber >= maxFrameExclusive) {
      throw new Error(
        t('aiPanel.frameInspection.errors.timecodeOutOfRange', {
          timecode,
          maxTimecode: maxInspectableTimecode.value,
        }),
      )
    }

    if (!deduped.has(timecode)) {
      deduped.set(timecode, {
        timecode,
        frameNumber,
      })
    }
  }

  const points = [...deduped.values()].sort((left, right) => left.frameNumber - right.frameNumber)
  if (points.length > FRAME_INSPECTION_MAX_FRAMES) {
    throw new Error(
      t('aiPanel.frameInspection.errors.tooManyTimecodes', {
        count: FRAME_INSPECTION_MAX_FRAMES,
      }),
    )
  }

  return points
}

async function handleInspect(): Promise<void> {
  if (isRunning.value) {
    return
  }

  try {
    const points = buildValidatedPoints()
    const normalizedInstruction = instruction.value.trim()

    resetResultState()
    setStatus(
      'capturing',
      t('aiPanel.frameInspection.progressCapturing', {
        current: 0,
        total: points.length,
      }),
      5,
    )

    const capturedFrames = await captureInspectionFrames({
      points,
      timelineItems: [...unifiedStore.timelineItems],
      tracks: unifiedStore.tracks.map((track) => ({
        id: track.id,
        isVisible: track.isVisible,
        isMuted: track.isMuted,
      })),
      getMediaItem: (id) => unifiedStore.getMediaItem(id),
      getAsset: (id) => unifiedStore.getAsset(id),
      videoResolution: {
        width: unifiedStore.videoResolution.width,
        height: unifiedStore.videoResolution.height,
      },
    })

    previewFrames.value = capturedFrames.map((frame) => ({
      timecode: frame.timecode,
      previewUrl: URL.createObjectURL(frame.blob),
    }))
    setStatus(
      'uploading',
      t('aiPanel.frameInspection.progressUploading', {
        current: 0,
        total: capturedFrames.length,
      }),
      35,
    )

    const uploadedFrames = await uploadInspectionFrames(
      capturedFrames,
      (completedCount, totalCount, fileProgress, point) => {
        const ratio = (completedCount + fileProgress / 100) / Math.max(1, totalCount)
        setStatus(
          'uploading',
          t('aiPanel.frameInspection.progressUploadingDetail', {
            current: Math.min(totalCount, completedCount + 1),
            total: totalCount,
            timecode: point.timecode,
          }),
          35 + Math.round(ratio * 40),
        )
      },
    )

    previewFrames.value = previewFrames.value.map((frame) => {
      const uploaded = uploadedFrames.find((item) => item.timecode === frame.timecode)
      return {
        ...frame,
        imageUrl: uploaded?.imageUrl,
      }
    })

    setStatus('inspecting', t('aiPanel.frameInspection.progressInspecting'), 82)
    activeAbortController = new AbortController()
    const response = await callFrameInspectionApi(
      normalizedInstruction,
      uploadedFrames,
      activeAbortController.signal,
    )

    answer.value = response.answer
    answerModel.value = response.model
    setStatus('done', t('aiPanel.frameInspection.messages.success'), 100)
    unifiedStore.messageSuccess(t('aiPanel.frameInspection.messages.success'))
  } catch (error) {
    const message = error instanceof Error ? error.message : t('aiPanel.frameInspection.messages.failed')
    setStatus('error', message, progressPercentage.value)
    unifiedStore.messageError(message)
  } finally {
    activeAbortController = null
  }
}

onBeforeUnmount(() => {
  activeAbortController?.abort()
  cleanupPreviewFrames()
})
</script>

<style scoped>
.inspection-panel {
  --inspection-surface:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.028) 100%),
    rgba(20, 20, 20, 0.84);
  --inspection-surface-hover:
    linear-gradient(180deg, rgba(255, 255, 255, 0.072) 0%, rgba(255, 255, 255, 0.04) 100%),
    rgba(26, 26, 26, 0.88);
  --inspection-surface-soft:
    linear-gradient(180deg, rgba(255, 255, 255, 0.038) 0%, rgba(255, 255, 255, 0.02) 100%),
    rgba(255, 255, 255, 0.018);
  --inspection-surface-accent:
    linear-gradient(180deg, rgba(76, 175, 80, 0.14) 0%, rgba(76, 175, 80, 0.03) 100%),
    rgba(18, 18, 18, 0.9);
  --inspection-border: rgba(255, 255, 255, 0.07);
  --inspection-border-strong: rgba(255, 255, 255, 0.12);
  --inspection-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.045),
    0 14px 30px rgba(0, 0, 0, 0.24),
    0 4px 10px rgba(0, 0, 0, 0.18);
  --inspection-shadow-hover:
    0 0 0 1px rgba(255, 255, 255, 0.07),
    0 18px 34px rgba(0, 0, 0, 0.28),
    0 6px 12px rgba(0, 0, 0, 0.2);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--color-text-primary);
  background:
    radial-gradient(circle at top, rgba(76, 175, 80, 0.08), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.012), rgba(255, 255, 255, 0));
  -webkit-font-smoothing: antialiased;
}

.inspection-scrollbar :deep(.n-scrollbar-content) {
  min-height: 100%;
}

.inspection-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-radius: 18px;
  background: var(--inspection-surface);
  box-shadow: var(--inspection-shadow);
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.section-card:hover {
  background: var(--inspection-surface-hover);
  box-shadow: var(--inspection-shadow-hover);
  transform: translateY(-1px);
}

.section-header {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
  align-items: flex-start;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  text-wrap: balance;
}

.section-desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-wrap: pretty;
}

.meta-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-help {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
  text-wrap: pretty;
}

.action-row {
  display: flex;
  justify-content: flex-end;
}

.inspection-input :deep(.n-input-wrapper) {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.032);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.055),
    0 2px 4px rgba(0, 0, 0, 0.12);
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.inspection-input :deep(.n-input-wrapper:hover) {
  background: rgba(255, 255, 255, 0.045);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 6px 12px rgba(0, 0, 0, 0.16);
}

.inspection-input :deep(.n-input__textarea-el),
.inspection-input :deep(.n-input__input-el) {
  color: var(--color-text-primary);
  line-height: 1.6;
}

.inspection-input--timecodes :deep(.n-input__textarea-el) {
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
}

.inspection-input :deep(.n-input__placeholder) {
  color: var(--color-text-muted);
}

.inspection-input.n-input--focus :deep(.n-input-wrapper),
.inspection-input.n-input--stateful:not(.n-input--disabled).n-input--focus :deep(.n-input-wrapper) {
  background: rgba(255, 255, 255, 0.05);
  box-shadow:
    inset 0 0 0 1px rgba(76, 175, 80, 0.52),
    0 0 0 3px rgba(76, 175, 80, 0.12),
    0 10px 18px rgba(0, 0, 0, 0.18);
}

.action-row :deep(.n-button) {
  min-height: 40px;
  padding: 0 18px;
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 8px 18px rgba(0, 0, 0, 0.22);
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast),
    filter var(--transition-fast);
}

.action-row :deep(.n-button:not(.n-button--disabled):hover) {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 12px 24px rgba(0, 0, 0, 0.24);
  transform: translateY(-1px);
}

.action-row :deep(.n-button:not(.n-button--disabled):active) {
  transform: scale(0.96);
}

.status-alert-wrap {
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--inspection-shadow);
}

.status-alert-wrap :deep(.n-alert) {
  background: var(--inspection-surface-soft);
}

.status-alert-wrap :deep(.n-alert-body) {
  color: var(--color-text-primary);
}

.status-alert-wrap :deep(.n-alert-body__header) {
  color: var(--color-text-primary);
}

.status-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  color: var(--color-text-secondary);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--spacing-md);
}

.preview-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: 10px;
  border-radius: 14px;
  background: var(--inspection-surface-soft);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.05),
    0 10px 18px rgba(0, 0, 0, 0.16);
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.preview-card:hover {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 14px 24px rgba(0, 0, 0, 0.2);
  transform: translateY(-1px);
}

.preview-image {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 10px;
  background: #0f172a;
  outline: 1px solid rgba(255, 255, 255, 0.1);
  outline-offset: -1px;
}

.preview-timecode {
  font-family: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.answer-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-radius: 14px;
  background: var(--inspection-surface-accent);
  box-shadow:
    0 0 0 1px rgba(76, 175, 80, 0.14),
    0 10px 20px rgba(0, 0, 0, 0.18);
}

.answer-header {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.answer-text {
  white-space: pre-wrap;
  line-height: 1.7;
  color: var(--color-text-primary);
  text-wrap: pretty;
}

@media (max-width: 768px) {
  .section-header {
    flex-direction: column;
  }

  .action-row {
    justify-content: stretch;
  }

  .action-row :deep(.n-button) {
    width: 100%;
  }
}
</style>
