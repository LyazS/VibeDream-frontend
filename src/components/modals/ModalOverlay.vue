<template>
  <Teleport to="body">
    <Transition :name="transitionName">
      <div
        v-if="show"
        class="modal-overlay"
        :class="overlayClass"
        :style="computedOverlayStyle"
        @click="handleOverlayClick"
      >
        <!-- 完全由外部控制的内容 -->
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch, nextTick } from 'vue'

/**
 * ModalOverlay 组件 Props
 * 只负责遮罩层和基础交互逻辑
 */
interface ModalOverlayProps {
  // 显示控制
  show: boolean

  // 关闭行为
  closable?: boolean          // 是否可关闭（默认 true）
  maskClosable?: boolean      // 点击遮罩关闭（默认 true）
  escClosable?: boolean       // ESC 键关闭（默认 true）

  // 样式控制
  zIndex?: number            // z-index（默认 1000）
  overlayClass?: string      // 自定义遮罩类名
  overlayStyle?: Record<string, any>  // 自定义遮罩样式

  // 动画控制
  transitionName?: string    // 过渡动画名称（默认 'modal-fade'）
}

const props = withDefaults(defineProps<ModalOverlayProps>(), {
  closable: true,
  maskClosable: true,
  escClosable: true,
  zIndex: 1000,
  overlayClass: '',
  overlayStyle: () => ({}),
  transitionName: 'modal-fade',
})

/**
 * ModalOverlay 组件 Emits
 */
interface ModalOverlayEmits {
  'update:show': [value: boolean]
  'close': []
  'open': []
  'overlay-click': []  // 点击遮罩时触发
}

const emit = defineEmits<ModalOverlayEmits>()

// 计算属性
const computedOverlayStyle = computed(() => ({
  zIndex: props.zIndex,
  ...props.overlayStyle,
}))

// 键盘事件处理
const handleKeydown = (event: KeyboardEvent) => {
  if (
    event.key === 'Escape' &&
    props.escClosable &&
    props.closable &&
    props.show
  ) {
    handleClose()
  }
}

// 事件处理函数
const handleOverlayClick = () => {
  emit('overlay-click')

  if (props.maskClosable && props.closable) {
    handleClose()
  }
}

const handleClose = () => {
  if (props.closable) {
    emit('update:show', false)
    emit('close')
  }
}

// 监听显示状态变化
watch(
  () => props.show,
  (newShow) => {
    if (newShow) {
      nextTick(() => {
        emit('open')
        // 防止背景滚动
        document.body.style.overflow = 'hidden'
      })
    } else {
      document.body.style.overflow = ''
    }
  },
  { immediate: true }
)

// 生命周期 - 全局键盘事件监听
const setupKeyboardListener = () => {
  document.addEventListener('keydown', handleKeydown)
}

const cleanupKeyboardListener = () => {
  document.removeEventListener('keydown', handleKeydown)
}

// 初始化键盘监听
setupKeyboardListener()

// 组件卸载时清理
onUnmounted(() => {
  cleanupKeyboardListener()
  document.body.style.overflow = ''
})
</script>

<style scoped>
/* 遮罩层样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

/* 过渡动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition-property: opacity;
  transition-duration: 0.2s;
  transition-timing-function: ease;
}

.modal-fade-enter-active :deep(.base-modal),
.modal-fade-leave-active :deep(.base-modal) {
  transition-property: opacity, transform;
  transition-duration: 0.2s;
  transition-timing-function: ease-out;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from :deep(.base-modal) {
  opacity: 0;
  transform: translateY(4px);
}

.modal-fade-leave-to :deep(.base-modal) {
  opacity: 0;
  transform: translateY(2px);
}

.modal-fade-enter-to,
.modal-fade-leave-from {
  opacity: 1;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .modal-overlay {
    padding: var(--spacing-lg);
  }
}
</style>
