<template>
  <div
    class="chat-input-wrapper"
    @paste="handlePaste"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div class="chat-input-shell">
      <div v-if="draftImages.length" class="draft-images">
        <div v-for="draft in draftImages" :key="draft.id" class="draft-image">
          <button
            v-if="previews.get(draft.id)"
            type="button"
            class="draft-preview-trigger"
            :aria-label="draft.image?.original.fileName || t('common.chat.image')"
            @click="openDraftPreview(draft)"
          >
            <img :src="previews.get(draft.id)!.url" :alt="t('common.chat.image')" />
          </button>
          <div
            v-else
            class="draft-image-status"
            :class="{ 'draft-image-status--failed': draft.status === 'failed' }"
            :aria-label="imageStatusLabel(draft)"
          >
            <component
              :is="draft.status === 'failed' ? IconComponents.WARNING : IconComponents.LOADING"
              size="20px"
            />
            <button
              v-if="draft.status === 'failed'"
              type="button"
              class="retry-image"
              :title="t('common.retry')"
              :aria-label="t('common.retry')"
              :disabled="!store.agentDraftEditable"
              @click="store.retryAgentDraftImage(draft.id)"
            >
              <component :is="IconComponents.REFRESH" size="18px" />
            </button>
            <span v-else>{{ imageStatusLabel(draft) }}</span>
          </div>
          <button
            type="button"
            class="remove-image"
            :title="t('common.chat.removeImage')"
            :aria-label="t('common.chat.removeImage')"
            :disabled="store.agentDraft.submitting"
            @click="store.removeAgentDraftImage(draft.id)"
          >
            <component :is="IconComponents.CLOSE" size="16px" />
          </button>
        </div>
      </div>
      <div v-if="imageErrorMessage" class="image-error" role="alert">{{ imageErrorMessage }}</div>
      <div v-for="draft in failedImages" :key="draft.id" class="image-error" role="alert">
        {{ t(`common.chat.${draft.error}`) }}
      </div>
      <div
        v-if="store.agentDraft.submitError"
        class="image-error"
        role="alert"
        :title="t(getAgentErrorKey(store.agentDraft.submitError, 'common.chat.draftSubmitFailed'))"
      >
        {{ t('common.chat.draftSubmitFailed') }}
      </div>
      <div class="chat-input-main">
        <textarea
          v-model="inputMessage"
          class="chat-textarea"
          :placeholder="inputPlaceholder"
          :style="textareaStyle"
          autocomplete="off"
          :disabled="!store.agentDraftEditable"
          @input="adjustTextareaHeight"
          @keydown.enter="handleEnterKey"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
        />
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          @change="handleFileSelection"
        />
        <button
          type="button"
          class="attach-image"
          :title="t('common.chat.attachImage')"
          :aria-label="t('common.chat.attachImage')"
          :disabled="!store.agentDraftEditable || draftImages.length >= AGENT_IMAGE_LIMITS.count"
          @click="fileInput?.click()"
        >
          <component :is="IconComponents.IMAGE_SMALL" size="18px" />
        </button>
        <AgentUsageIndicator />
        <ChatSendButton
          :disabled="!hasProcessingMessage && !store.agentDraftSendable"
          :title="hasProcessingMessage ? t('common.chat.stop') : t('common.chat.send')"
          :icon="hasProcessingMessage ? IconComponents.STOP : IconComponents.SEND"
          @click="hasProcessingMessage ? handleStop() : handleSend()"
        />
      </div>
    </div>
    <MediaPreview
      v-if="selectedPreview"
      :show="true"
      :source="selectedPreview"
      @close="selectedPreview = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, onBeforeUnmount, watch } from 'vue'
import type { AgentDraftImage } from '@/core/modules/UnifiedAgentModule'
import {
  AGENT_IMAGE_LIMITS,
  createAgentImagePreview,
} from '@/core/agent/services/agentImageService'
import { IconComponents } from '@/constants/iconComponents'
import ChatSendButton from '@/components/base/ChatSendButton.vue'
import AgentUsageIndicator from './AgentUsageIndicator.vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from './agentErrorMessage'
import MediaPreview from '@/components/preview/MediaPreview.vue'
import type { MediaPreviewSource } from '@/components/preview/mediaPreview'

const { t } = useAppI18n()
const store = useUnifiedStore()
const selectedPreview = shallowRef<MediaPreviewSource | null>(null)
function openDraftPreview(draft: AgentDraftImage) {
  if (draft.status === 'ready' && draft.image)
    selectedPreview.value = {
      type: 'image',
      blob: draft.image.blob,
      name: draft.image.original.fileName,
    }
}
watch(
  () => store.agentSessionId,
  () => {
    selectedPreview.value = null
  },
)

const inputMessage = computed({
  get: () => store.agentDraft.text,
  set: (text: string) => store.setAgentDraftText(text),
})
const fileInput = ref<HTMLInputElement>()
const draftImages = computed(() => store.agentDraft.images)
const failedImages = computed(() => draftImages.value.filter((item) => item.status === 'failed'))
const previews = shallowRef(new Map<string, ReturnType<typeof createAgentImagePreview>>())
const imageErrorMessage = computed(() =>
  store.agentDraft.imageError
    ? t(`common.chat.${store.agentDraft.imageError}`, { count: AGENT_IMAGE_LIMITS.count })
    : '',
)
watch(
  draftImages,
  (images) => {
    const next = new Map(previews.value)
    for (const [id, preview] of next) {
      if (images.some((item) => item.id === id && item.status === 'ready')) continue
      preview.dispose()
      next.delete(id)
    }
    for (const item of images) {
      if (item.image && item.status === 'ready' && !next.has(item.id))
        next.set(item.id, createAgentImagePreview(item.image.blob))
    }
    previews.value = next
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  previews.value.forEach((preview) => preview.dispose())
})
function imageStatusLabel(draft: { status: AgentDraftImage['status']; error?: string }) {
  if (draft.error) return t(`common.chat.${draft.error}`)
  return t(draft.status === 'queued' ? 'common.chat.imageQueued' : 'common.processing')
}
function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement
  store.addAgentDraftImages(Array.from(input.files ?? []))
  input.value = ''
}
function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      return file ? [file] : []
    })
  if (files.length) {
    event.preventDefault()
    store.addAgentDraftImages(files)
  }
}
function handleDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
    event.stopPropagation()
  }
}
function handleDrop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  event.stopPropagation()
  store.addAgentDraftImages(Array.from(event.dataTransfer.files))
}
const isComposing = ref(false) // 跟踪输入法 composition 状态
const textareaHeight = ref(72) // 初始高度 72px (3行 × 24px)

// 检查是否有进行中的消息（使用响应式计算属性）
const hasProcessingMessage = computed(() => store.agentRunning)

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
  return t('common.chat.inputPlaceholder')
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
watch(inputMessage, adjustTextareaHeight, { immediate: true })

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
  if (store.agentDraftSendable) await store.sendAgentDraft()
}

// 停止当前进行中的消息
const handleStop = () => {
  // 中止当前进行中的消息请求
  store.stopAgent()
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
  padding: 10px 12px 54px;
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

.file-input {
  display: none;
}
.draft-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 0 10px;
}
.draft-image {
  position: relative;
  width: 80px;
  height: 80px;
  flex: 0 0 80px;
}
.draft-image-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 11px;
}
.draft-image-status span {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: center;
}
.draft-image-status--failed {
  box-sizing: border-box;
  padding-bottom: 40px;
}
.retry-image {
  position: absolute;
  left: 20px;
  bottom: 0;
}
.draft-preview-trigger,
.draft-preview-trigger img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
}
.draft-preview-trigger {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
.draft-preview-trigger:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
}
.draft-preview-trigger img {
  display: block;
  object-fit: cover;
}
.remove-image,
.attach-image,
.retry-image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-primary);
  background: var(--color-bg-secondary);
  transition:
    transform 120ms,
    background-color 120ms;
}
.remove-image {
  position: absolute;
  right: -4px;
  top: -4px;
  background: transparent;
  color: white;
}
.remove-image :deep(svg) {
  padding: 4px;
  box-sizing: content-box;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.75);
}
.attach-image {
  position: absolute;
  left: 10px;
  bottom: 10px;
}
.chat-input-main :deep(.agent-usage-anchor) {
  top: auto;
  right: 58px;
  bottom: 10px;
}
.attach-image:disabled,
.remove-image:disabled,
.retry-image:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.attach-image:active:not(:disabled),
.remove-image:active:not(:disabled),
.retry-image:active:not(:disabled) {
  transform: scale(0.96);
}
.image-error {
  color: var(--color-error);
  font-size: 12px;
  padding-bottom: 8px;
  overflow-wrap: anywhere;
}

.chat-textarea::placeholder {
  color: var(--color-text-secondary);
}
</style>
