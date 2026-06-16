<!-- TextContentTemplate.vue -->
<template>
  <div class="text-content" :class="{ selected: isSelected }">
    <!-- 文本预览区域 -->
    <div class="text-preview">
      <div class="text-preview-content">
        {{ previewText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ContentTemplateProps } from '@/core/types/clipRenderer'

const props = defineProps<ContentTemplateProps<'text'>>()

const previewText = computed(() => {
  const content = props.data.baseRenderConfig.text.text || '文本内容'

  if (!content || content.trim() === '') {
    return '文本内容'
  }

  // 限制预览文本长度
  const maxLength = 20
  if (content.length > maxLength) {
    return content.substring(0, maxLength) + '...'
  }

  return content
})
</script>

<style scoped>
.text-content {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 4px 8px;
  overflow: hidden;
  border-radius: var(--border-radius-medium);
}

.text-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.text-preview-content {
  display: block;
  text-align: center;
  line-height: 1.2;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  font-size: 11px;
  color: #ffffff;
  font-weight: normal;
  font-style: normal;
  font-family: 'Arial, sans-serif';
}

/* 选中状态样式 */
.text-content.selected {
  background: linear-gradient(135deg, var(--color-clip-selected), var(--color-clip-selected-dark));
}
</style>
