<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

// 类型定义
export interface TagItem {
  label: string
  color: string
  [key: string]: unknown // 支持任意其他可选字段
}

// Props 定义
interface Props {
  availableTags: TagItem[]
  placeholder?: string
  maxHeight?: string
  minHeight?: string
  modelValue: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '在这里输入文本，按 @ 键添加标签...',
  maxHeight: '400px',
  minHeight: '160px',
})

// Emits 定义
interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'change', content: string): void
}

const emit = defineEmits<Emits>()

// 响应式状态
const showTagMenu = ref(false)
const filterText = ref('')
const selectedIndex = ref(0)
const editorRef = ref<HTMLDivElement | null>(null)
const savedRange = ref<Range | null>(null)

// 菜单位置（使用 reactive）
const menuPosition = reactive({ top: 0, left: 0 })

// 计算属性：过滤标签
const filteredTags = computed(() => {
  return props.availableTags.filter((tag) =>
    tag.label.toLowerCase().includes(filterText.value.toLowerCase()),
  )
})

// 获取光标位置
const getCaretCoordinates = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  const editorRect = editorRef.value?.getBoundingClientRect()

  if (!editorRect) return null

  return {
    top: rect.bottom - editorRect.top,
    left: rect.left - editorRect.left,
  }
}

// 插入标签
const insertTag = (tag: TagItem) => {
  if (!editorRef.value) return

  // 先恢复编辑器焦点
  editorRef.value.focus()

  const selection = window.getSelection()
  if (!selection) return

  // 使用保存的 range，如果存在的话
  let range = savedRange.value
  if (!range || !editorRef.value.contains(range.startContainer)) {
    // 如果保存的 range 不可用，使用当前的 selection
    if (selection.rangeCount === 0) return
    range = selection.getRangeAt(0)
  }

  // 删除 @ 和过滤文本
  const textNode = range.startContainer
  if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
    const text = textNode.textContent
    const atIndex = text.lastIndexOf('@', range.startOffset)
    if (atIndex !== -1) {
      const beforeAt = text.substring(0, atIndex)
      const afterCursor = text.substring(range.startOffset)
      textNode.textContent = beforeAt + afterCursor
      range.setStart(textNode, beforeAt.length)
      range.collapse(true)
    }
  }

  // 创建标签元素
  const tagElement = createTagElement(tag)

  // 插入标签和空格
  range.insertNode(tagElement)
  const spaceNode = document.createTextNode('\u00A0')
  range.setStartAfter(tagElement)
  range.insertNode(spaceNode)
  range.setStartAfter(spaceNode)
  range.collapse(true)

  selection.removeAllRanges()
  selection.addRange(range)

  showTagMenu.value = false
  filterText.value = ''
  savedRange.value = null
  updatePreview()
}

// 处理输入
const handleInput = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  const textNode = range.startContainer

  if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
    const text = textNode.textContent
    const cursorPos = range.startOffset
    const atIndex = text.lastIndexOf('@', cursorPos - 1)

    if (atIndex !== -1 && atIndex < cursorPos) {
      const searchText = text.substring(atIndex + 1, cursorPos)
      filterText.value = searchText

      // 保存当前的 range，用于鼠标点击时使用
      savedRange.value = range.cloneRange()

      const coords = getCaretCoordinates()
      if (coords) {
        menuPosition.top = coords.top
        menuPosition.left = coords.left
        showTagMenu.value = true
        selectedIndex.value = 0
      }
    } else {
      showTagMenu.value = false
      filterText.value = ''
      savedRange.value = null
    }
  }

  updatePreview()
}

// 处理键盘事件
const handleKeyDown = (e: KeyboardEvent) => {
  if (showTagMenu.value && filteredTags.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value + 1) % filteredTags.value.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex.value =
        (selectedIndex.value - 1 + filteredTags.value.length) % filteredTags.value.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedTag = filteredTags.value[selectedIndex.value]
      if (selectedTag) {
        insertTag(selectedTag)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      showTagMenu.value = false
      filterText.value = ''
      savedRange.value = null
    }
  }
}

// 获取纯文本内容（标签用 [[JSON字符串]] 表示）
const getTextContent = () => {
  if (!editorRef.value) return ''

  let result = ''
  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.dataset.tagData) {
        // 使用完整的 JSON 数据
        result += `[[${element.dataset.tagData}]]`
      } else {
        node.childNodes.forEach(traverse)
      }
    }
  }

  editorRef.value.childNodes.forEach(traverse)
  return result.trim()
}

// 更新预览
const updatePreview = () => {
  const content = getTextContent()
  emit('update:modelValue', content)
  emit('change', content)
}

// 聚焦编辑器
const focus = () => {
  editorRef.value?.focus()
}

// 创建标签元素的辅助函数
const createTagElement = (tag: TagItem): HTMLElement => {
  const tagElement = document.createElement('span')
  tagElement.contentEditable = 'false'
  tagElement.className = 'tag-input-tag'
  tagElement.style.backgroundColor = tag.color
  tagElement.dataset.tagLabel = tag.label
  // 存储完整的 JSON 数据
  tagElement.dataset.tagData = JSON.stringify(tag)

  const labelSpan = document.createElement('span')
  labelSpan.textContent = tag.label
  tagElement.appendChild(labelSpan)

  return tagElement
}

// 设置编辑器内容
const setContent = (content: string) => {
  if (!editorRef.value) return

  // 清空编辑器
  editorRef.value.innerHTML = ''

  // 如果内容为空，直接返回
  if (!content) return

  // 解析内容，查找 [[...]] 模式
  let lastIndex = 0
  const tagRegex = /\[\[(.*?)\]\]/g
  let match

  while ((match = tagRegex.exec(content)) !== null) {
    // 添加标签前的文本
    if (match.index > lastIndex) {
      const textNode = document.createTextNode(content.substring(lastIndex, match.index))
      editorRef.value.appendChild(textNode)
    }

    // 尝试解析 JSON
    try {
      if (match[1]) {
        const tagData = JSON.parse(match[1])
        // 验证必需字段
        if (tagData && typeof tagData === 'object' && tagData.label && tagData.color) {
          const tagElement = createTagElement(tagData as TagItem)
          editorRef.value.appendChild(tagElement)
        } else {
          // JSON 格式不正确，保留原始文本
          const textNode = document.createTextNode(match[0])
          editorRef.value.appendChild(textNode)
        }
      } else {
        // 没有捕获组内容，保留原始文本
        const textNode = document.createTextNode(match[0])
        editorRef.value.appendChild(textNode)
      }
    } catch {
      // JSON 解析失败，保留原始文本
      const textNode = document.createTextNode(match[0])
      editorRef.value.appendChild(textNode)
    }

    lastIndex = tagRegex.lastIndex
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    const textNode = document.createTextNode(content.substring(lastIndex))
    editorRef.value.appendChild(textNode)
  }

  updatePreview()
}

// 监听 modelValue 变化，同步到编辑器
watch(
  () => props.modelValue,
  (newValue) => {
    // 使用 nextTick 确保 DOM 已经渲染完成
    nextTick(() => {
      // 避免循环更新：只有当编辑器内容与 modelValue 不一致时才更新
      const currentContent = getTextContent()
      if (currentContent !== newValue) {
        setContent(newValue)
      }
    })
  },
  { immediate: true }, // 立即执行，确保初始化时同步
)

// 暴露方法给父组件
defineExpose({
  focus,
})

// 生命周期
onMounted(() => {
  const editor = editorRef.value
  if (editor) {
    editor.addEventListener('input', updatePreview)
  }
})

onUnmounted(() => {
  const editor = editorRef.value
  if (editor) {
    editor.removeEventListener('input', updatePreview)
  }
})
</script>

<template>
  <div class="tag-input-wrapper">
    <!-- 富文本编辑器 -->
    <div class="editor-container">
      <div
        ref="editorRef"
        contenteditable="true"
        @input="handleInput"
        @keydown="handleKeyDown"
        class="tag-input-editor"
        :data-placeholder="placeholder"
        :style="{
          maxHeight: maxHeight,
          minHeight: minHeight,
        }"
      ></div>

      <!-- 标签下拉菜单 -->
      <div
        v-if="showTagMenu && filteredTags.length > 0"
        class="tag-input-menu"
        :style="{
          top: `${menuPosition.top + 24}px`,
          left: `${menuPosition.left}px`,
        }"
      >
        <div class="tag-input-menu-list">
          <div
            v-for="(tag, index) in filteredTags"
            :key="index"
            :class="[
              'tag-input-menu-item',
              index === selectedIndex ? 'tag-input-menu-item-selected' : '',
            ]"
            @mouseenter="selectedIndex = index"
            @click="insertTag(tag)"
          >
            <span class="tag-input-menu-tag" :style="{ backgroundColor: tag.color }">
              {{ tag.label }}
            </span>
            <span v-if="index === selectedIndex" class="tag-input-menu-hint">Enter</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tag-input-wrapper {
  position: relative;
  width: 100%;
}

.editor-container {
  position: relative;
  width: 100%;
}

.tag-input-editor {
  width: 100%;
  padding: 1rem;
  border: 2px solid #374151;
  border-radius: 0.5rem;
  background: #1f2937;
  font-size: 0.875rem;
  line-height: 1.625;
  transition: border-color 0.2s;
  caret-color: #60a5fa;
  overflow-y: auto;
  color: #e5e7eb;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
}

.tag-input-editor:focus {
  outline: none;
  border-color: #60a5fa;
}

.tag-input-editor[data-placeholder]:empty:before {
  content: attr(data-placeholder);
  color: #6b7280;
  pointer-events: none;
  position: absolute;
}

/* 编辑器中的标签元素 */
:deep(.tag-input-tag) {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
  margin: 0 0.125rem;
  vertical-align: middle;
  transition: opacity 0.2s;
}

:deep(.tag-input-tag:hover) {
  opacity: 0.8;
}

/* 标签菜单 */
.tag-input-menu {
  position: absolute;
  z-index: 50;
  width: 16rem;
  background: #1f2937;
  border-radius: 0.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  border: 1px solid #374151;
  padding: 0.5rem 0;
}

.tag-input-menu-header {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  color: #9ca3af;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.tag-input-icon {
  width: 0.75rem;
  height: 0.75rem;
}

.tag-input-menu-list {
  max-height: 12rem;
  overflow-y: auto;
}

.tag-input-menu-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tag-input-menu-item:hover {
  background-color: #374151;
}

.tag-input-menu-item-selected {
  background-color: #1e3a8a;
  border-left: 2px solid #60a5fa;
}

.tag-input-menu-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
}

.tag-input-menu-hint {
  margin-left: auto;
  font-size: 0.75rem;
  color: #6b7280;
}

/* 自定义滚动条 */
.tag-input-editor::-webkit-scrollbar,
.tag-input-menu-list::-webkit-scrollbar {
  width: 6px;
}

.tag-input-editor::-webkit-scrollbar-track,
.tag-input-menu-list::-webkit-scrollbar-track {
  background: #111827;
  border-radius: 3px;
}

.tag-input-editor::-webkit-scrollbar-thumb,
.tag-input-menu-list::-webkit-scrollbar-thumb {
  background: #4b5563;
  border-radius: 3px;
}

.tag-input-editor::-webkit-scrollbar-thumb:hover,
.tag-input-menu-list::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}
</style>
