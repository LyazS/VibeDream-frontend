<template>
  <ModalOverlay
    :show="show"
    :closable="closable && !loading"
    :mask-closable="maskClosable && !loading"
    :esc-closable="escClosable && !loading"
    :z-index="zIndex"
    :overlay-class="customClass"
    :overlay-style="overlayStyle"
    @update:show="handleUpdateShow"
    @close="emit('close')"
    @open="emit('open')"
  >
    <BaseModal
      :width="width"
      :height="height"
      :max-width="maxWidth"
      :max-height="maxHeight"
      :centered="centered"
      :class-name="className"
      :custom-style="customStyle"
    >
      <!-- 头部区域 -->
      <div v-if="showHeader" class="modal-header">
        <slot name="header">
          <h3 v-if="title" class="modal-title">{{ title }}</h3>
        </slot>
        <div v-if="showClose" class="modal-header-actions">
          <slot name="closeIcon">
            <button class="modal-close-btn" @click="handleClose">
              <component :is="IconComponents.CLOSE" size="16px" />
            </button>
          </slot>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="modal-content">
        <slot>
          <div class="modal-body">
            <slot name="body"></slot>
          </div>
        </slot>
      </div>

      <!-- 底部区域 -->
      <div v-if="showFooter" class="modal-footer">
        <slot name="footer">
          <div class="modal-actions">
            <slot name="actions">
              <HoverButton
                v-if="showCancel"
                variant="large"
                @click="handleCancel"
                :disabled="loading"
              >
                {{ props.cancelText }}
              </HoverButton>
              <HoverButton
                v-if="showConfirm"
                variant="large"
                @click="handleConfirm"
                :disabled="confirmDisabled || loading"
                :loading="loading"
              >
                {{ props.confirmText }}
              </HoverButton>
            </slot>
          </div>
        </slot>
      </div>
    </BaseModal>
  </ModalOverlay>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import ModalOverlay from './ModalOverlay.vue'
import BaseModal from './BaseModal.vue'

interface Props {
  show: boolean
  title?: string
  width?: string | number
  height?: string | number
  maxWidth?: string | number
  maxHeight?: string | number
  closable?: boolean
  maskClosable?: boolean
  escClosable?: boolean
  showClose?: boolean
  showHeader?: boolean
  showFooter?: boolean
  showCancel?: boolean
  showConfirm?: boolean
  centered?: boolean
  className?: string
  zIndex?: number
  loading?: boolean
  confirmDisabled?: boolean
  confirmText?: string
  cancelText?: string
  customClass?: string
  customStyle?: Record<string, any>
}

const props = withDefaults(defineProps<Props>(), {
  width: '500px',
  maxWidth: '90%',
  maxHeight: '90vh',
  closable: true,
  maskClosable: true,
  escClosable: true,
  showClose: true,
  showHeader: true,
  showFooter: true,
  showCancel: true,
  showConfirm: true,
  centered: true,
  zIndex: 1000,
  loading: false,
  confirmDisabled: false,
  confirmText: '',
  cancelText: '',
  customClass: '',
  customStyle: () => ({}),
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  close: []
  open: []
  confirm: []
  cancel: []
}>()

// 计算属性 - 映射到新组件的 props
const overlayStyle = computed(() => ({
  zIndex: props.zIndex,
}))

// 事件处理函数
const handleUpdateShow = (value: boolean) => {
  emit('update:show', value)
}

const handleClose = () => {
  if (props.closable && !props.loading) {
    emit('update:show', false)
    emit('close')
  }
}

const handleCancel = () => {
  if (!props.loading) {
    emit('cancel')
    handleClose()
  }
}

const handleConfirm = () => {
  emit('confirm')
}
</script>

<style scoped>
/* 头部样式 */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xl) var(--spacing-xxl);
  border-bottom: 1px solid var(--color-border-primary);
  flex-shrink: 0;
}

.modal-title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 600;
  text-wrap: balance;
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.modal-close-btn {
  position: relative;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-xs);
  border-radius: var(--border-radius-medium);
  transition-property: background-color, color, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close-btn::before {
  position: absolute;
  inset: -4px;
  content: '';
}

.modal-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.modal-close-btn:active {
  transform: scale(0.96);
}

/* 内容区域样式 */
.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xxl);
  text-wrap: pretty;
}

.modal-body {
  min-height: 0;
}

/* 底部样式 */
.modal-footer {
  flex-shrink: 0;
  padding: var(--spacing-lg) var(--spacing-xxl);
  border-top: 1px solid var(--color-border-primary);
}

.modal-actions {
  display: flex;
  gap: var(--spacing-lg);
  justify-content: flex-end;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .modal-header {
    padding: var(--spacing-xl) var(--spacing-lg);
  }

  .modal-content {
    padding: var(--spacing-lg);
  }

  .modal-footer {
    padding: var(--spacing-lg);
  }

  .modal-actions {
    flex-direction: column;
  }
}

/* 可访问性 */
.modal-close-btn:focus {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
}

/* 滚动条样式 */
.modal-content::-webkit-scrollbar {
  width: 6px;
}

.modal-content::-webkit-scrollbar-track {
  background: var(--color-bg-primary);
  border-radius: 3px;
}

.modal-content::-webkit-scrollbar-thumb {
  background: var(--color-border-primary);
  border-radius: 3px;
}

.modal-content::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}
</style>
