<script setup lang="ts">
/**
 * BaseModal.vue - 基础模态框容器组件
 *
 * 职责:
 * - 提供基础的模态框容器样式
 * - 支持尺寸控制（width, height, maxWidth, maxHeight）
 * - 支持居中布局
 * - 阻止点击事件冒泡
 *
 * 不包含:
 * - header/footer 结构（由上层组件提供）
 * - 按钮逻辑（由上层组件提供）
 * - 任何业务逻辑（完全自定义的内容）
 */

import { computed } from 'vue'

interface BaseModalProps {
  /** 尺寸控制 */
  width?: string | number
  height?: string | number
  maxWidth?: string | number
  maxHeight?: string | number

  /** 布局控制 */
  centered?: boolean /** 是否居中（默认 true） */

  /** 样式控制 */
  className?: string
  customStyle?: Record<string, any>
}

const props = withDefaults(defineProps<BaseModalProps>(), {
  width: '500px',
  maxWidth: '90%',
  maxHeight: '90vh',
  centered: true,
  className: '',
  customStyle: () => ({}),
})

/**
 * 计算样式 - 处理尺寸单位转换
 */
const computedStyle = computed(() => {
  const style: Record<string, any> = { ...props.customStyle }

  // 处理 width
  if (props.width !== undefined) {
    style.width = typeof props.width === 'number' ? `${props.width}px` : props.width
  }

  // 处理 height
  if (props.height !== undefined) {
    style.height = typeof props.height === 'number' ? `${props.height}px` : props.height
  }

  // 处理 maxWidth
  if (props.maxWidth !== undefined) {
    style.maxWidth = typeof props.maxWidth === 'number' ? `${props.maxWidth}px` : props.maxWidth
  }

  // 处理 maxHeight
  if (props.maxHeight !== undefined) {
    style.maxHeight = typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
  }

  return style
})
</script>

<template>
  <div
    class="base-modal"
    :class="[className, { 'base-modal-centered': centered }]"
    :style="computedStyle"
    @click.stop
  >
    <!-- 完全自定义的内容 -->
    <slot />
  </div>
</template>

<style scoped>
/* 容器样式 */
.base-modal {
  background: var(--color-bg-secondary);
  border: 1px solid transparent;
  border-radius: var(--border-radius-xlarge);
  overflow: hidden;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 8px 20px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  transform: translateY(-1px);
}

.base-modal-centered {
  margin: auto;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .base-modal {
    width: 95%;
    max-width: 95%;
    margin: var(--spacing-lg);
  }
}
</style>
