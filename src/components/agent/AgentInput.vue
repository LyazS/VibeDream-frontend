<template>
  <div
    class="chat-input-wrapper"
    @paste="handlePaste"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div class="chat-input-shell">
      <div v-if="draftImages.length" class="draft-images">
        <div v-for="draft in draftImages" :key="draft.image.id" class="draft-image">
          <NImage :src="draft.preview.url" :alt="t('common.chat.image')" object-fit="cover" />
          <button
            type="button"
            class="remove-image"
            :title="t('common.chat.removeImage')"
            :aria-label="t('common.chat.removeImage')"
            @click="removeImage(draft.image.id)"
          >
            <component :is="IconComponents.CLOSE" size="16px" />
          </button>
        </div>
      </div>
      <div v-if="imageErrorMessage" class="image-error" role="alert">{{ imageErrorMessage }}</div>
      <div class="chat-input-main">
        <textarea
          v-model="inputMessage"
          class="chat-textarea"
          :placeholder="inputPlaceholder"
          :style="textareaStyle"
          autocomplete="off"
          :disabled="!store.agentReady || (store.agentBusy && !store.agentRunning)"
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
          :disabled="
            !store.agentReady ||
            (store.agentBusy && !store.agentRunning) ||
            draftImages.length + queuedImages >= AGENT_IMAGE_LIMITS.count
          "
          @click="fileInput?.click()"
        >
          <component :is="IconComponents.IMAGE_SMALL" size="18px" />
        </button>
        <AgentUsageIndicator />
        <ChatSendButton
          :disabled="!hasProcessingMessage && !canSend"
          :title="hasProcessingMessage ? t('common.chat.stop') : t('common.chat.send')"
          :icon="hasProcessingMessage ? IconComponents.STOP : IconComponents.SEND"
          @click="hasProcessingMessage ? handleStop() : handleSend()"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, onBeforeUnmount } from 'vue'
import { NImage } from 'naive-ui'
import type { AgentImage } from '@/core/agent/types'
import {
  AGENT_IMAGE_LIMITS,
  AgentImageProcessingError,
  type AgentImageErrorCode,
  processAgentImage,
  createAgentImagePreview,
} from '@/core/agent/services/agentImageService'
import { IconComponents } from '@/constants/iconComponents'
import ChatSendButton from '@/components/base/ChatSendButton.vue'
import AgentUsageIndicator from './AgentUsageIndicator.vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()
const store = useUnifiedStore()

// AgentInput 现在完全自主，不需要发射任何事件

const inputMessage = ref('')
const fileInput = ref<HTMLInputElement>()
type DraftImage = { image: AgentImage; preview: ReturnType<typeof createAgentImagePreview> }
const draftImages = shallowRef<DraftImage[]>([])
const imageError = ref<AgentImageErrorCode | 'imageCountLimit' | ''>('')
const imageErrorMessage = computed(() =>
  imageError.value ? t(`common.chat.${imageError.value}`, { count: AGENT_IMAGE_LIMITS.count }) : '',
)
let draftGeneration = 0
const queuedImages = ref(0)
let processing = Promise.resolve()
const canSend = computed(
  () =>
    store.agentReady &&
    !store.agentBusy &&
    queuedImages.value === 0 &&
    Boolean(inputMessage.value.trim() || draftImages.value.length),
)

function removeImage(id: string) {
  draftImages.value.find((draft) => draft.image.id === id)?.preview.dispose()
  draftImages.value = draftImages.value.filter((draft) => draft.image.id !== id)
}
function addFiles(files: File[]) {
  if (!store.agentReady || (store.agentBusy && !store.agentRunning)) return
  const generation = draftGeneration
  imageError.value = ''
  const available = Math.max(
    0,
    AGENT_IMAGE_LIMITS.count - draftImages.value.length - queuedImages.value,
  )
  if (files.length > available) imageError.value = 'imageCountLimit'
  const accepted = files.slice(0, available)
  queuedImages.value += accepted.length
  processing = processing.then(async () => {
    for (const file of accepted) {
      if (generation !== draftGeneration) return
      try {
        const image = await processAgentImage(file)
        if (generation !== draftGeneration) return
        draftImages.value = [
          ...draftImages.value,
          { image, preview: createAgentImagePreview(image.blob) },
        ]
      } catch (error) {
        if (generation === draftGeneration)
          imageError.value =
            error instanceof AgentImageProcessingError ? error.code : 'imageProcessingFailed'
      } finally {
        if (generation === draftGeneration) queuedImages.value--
      }
    }
  })
}
function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files ?? []))
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
    addFiles(files)
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
  addFiles(Array.from(event.dataTransfer.files))
}
function clearImages() {
  draftGeneration++
  queuedImages.value = 0
  draftImages.value.forEach((draft) => draft.preview.dispose())
  draftImages.value = []
  imageError.value = ''
}
onBeforeUnmount(clearImages)
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
  if (!canSend.value) return

  const message = inputMessage.value.trim()
  const images = draftImages.value.map((draft) => draft.image)

  // 清空输入框并重置高度
  inputMessage.value = ''
  clearImages()
  textareaHeight.value = MIN_LINES * LINE_HEIGHT // 重置为最小高度(3行)

  await store.sendAgentMessage(message, images)
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
}
.draft-image :deep(.n-image),
.draft-image :deep(img) {
  width: 100%;
  height: 100%;
  border-radius: 6px;
}
.draft-image :deep(img) {
  outline: 1px solid rgba(255, 255, 255, 0.1);
}
.remove-image,
.attach-image {
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
.attach-image:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.attach-image:active:not(:disabled),
.remove-image:active {
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
