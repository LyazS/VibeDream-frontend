<template>
  <div class="searchable-select" ref="selectRef" :class="{ 'is-disabled': disabled }">
    <!-- 选择框触发器 -->
    <div
      class="select-trigger"
      :class="{ 'is-open': isOpen, 'is-disabled': disabled }"
      @click="toggleDropdown"
    >
      <span class="select-value" :class="{ 'is-placeholder': !selectedOption }">
        {{ displayValue }}
      </span>
      <RiArrowDownSLine class="select-arrow" :class="{ 'is-open': isOpen }" aria-hidden="true" />
    </div>

    <!-- 下拉菜单 -->
    <Transition name="dropdown">
      <div v-if="isOpen" class="select-dropdown">
        <!-- 搜索输入框 -->
        <div v-if="searchable" class="search-input-wrapper">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="searchPlaceholder"
            @keydown.down.prevent="navigateDown"
            @keydown.up.prevent="navigateUp"
            @keydown.enter.prevent="selectHighlighted"
            @keydown.esc="closeDropdown"
          />
        </div>

        <!-- 选项列表 -->
        <n-scrollbar class="options-list" :style="{ maxHeight: `${props.maxHeight}px` }">
          <div ref="optionsListRef">
            <div
              v-for="(option, index) in filteredOptions"
              :key="getOptionValue(option)"
              class="option-item"
              :class="{
                'is-selected': isSelected(option),
                'is-highlighted': highlightedIndex === index,
              }"
              @click="selectOption(option)"
              @mouseenter="highlightedIndex = index"
            >
              <slot name="option" :option="option" :index="index">
                {{ getOptionLabel(option) }}
              </slot>
            </div>

            <!-- 无结果提示 -->
            <div v-if="filteredOptions.length === 0" class="no-results">
              {{ noResultsText }}
            </div>
          </div>
        </n-scrollbar>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { NScrollbar } from 'naive-ui'
import { RiArrowDownSLine } from '@remixicon/vue'

interface Props {
  /** 当前选中的值 */
  modelValue: any
  /** 选项列表 */
  options: any[]
  /** 是否可搜索 */
  searchable?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 占位符文本 */
  placeholder?: string
  /** 搜索框占位符 */
  searchPlaceholder?: string
  /** 无结果提示文本 */
  noResultsText?: string
  /** 选项值的键名（当选项为对象时） */
  valueKey?: string
  /** 选项标签的键名（当选项为对象时） */
  labelKey?: string
  /** 下拉菜单最大高度 */
  maxHeight?: number
  /** 自定义过滤函数 */
  filterMethod?: (option: any, query: string) => boolean
}

interface Emits {
  (e: 'update:modelValue', value: any): void
  (e: 'change', value: any): void
}

const props = withDefaults(defineProps<Props>(), {
  searchable: true,
  disabled: false,
  placeholder: '请选择',
  searchPlaceholder: '搜索...',
  noResultsText: '无匹配结果',
  valueKey: 'value',
  labelKey: 'label',
  maxHeight: 300,
})

const emit = defineEmits<Emits>()

// 引用
const selectRef = ref<HTMLElement>()
const searchInputRef = ref<HTMLInputElement>()
const optionsListRef = ref<HTMLElement>()

// 状态
const isOpen = ref(false)
const searchQuery = ref('')
const highlightedIndex = ref(0)

// 获取选项的值
const getOptionValue = (option: any): any => {
  if (typeof option === 'object' && option !== null) {
    return option[props.valueKey]
  }
  return option
}

// 获取选项的标签
const getOptionLabel = (option: any): string => {
  if (typeof option === 'object' && option !== null) {
    return option[props.labelKey] || String(option[props.valueKey])
  }
  return String(option)
}

// 当前选中的选项
const selectedOption = computed(() => {
  return props.options.find((option) => getOptionValue(option) === props.modelValue)
})

// 显示值
const displayValue = computed(() => {
  if (selectedOption.value) {
    return getOptionLabel(selectedOption.value)
  }
  return props.placeholder
})

// 过滤后的选项
const filteredOptions = computed(() => {
  if (!searchQuery.value) {
    return props.options
  }

  const query = searchQuery.value.toLowerCase()

  if (props.filterMethod) {
    return props.options.filter((option) => props.filterMethod!(option, searchQuery.value))
  }

  return props.options.filter((option) => {
    const label = getOptionLabel(option).toLowerCase()
    return label.includes(query)
  })
})


// 判断选项是否被选中
const isSelected = (option: any): boolean => {
  return getOptionValue(option) === props.modelValue
}

// 切换下拉菜单
const toggleDropdown = () => {
  if (props.disabled) return

  if (isOpen.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

// 打开下拉菜单
const openDropdown = () => {
  if (props.disabled) return

  isOpen.value = true
  searchQuery.value = ''
  highlightedIndex.value = 0

  nextTick(() => {
    if (props.searchable && searchInputRef.value) {
      searchInputRef.value.focus()
    }

    // 滚动到选中项
    scrollToSelected()
  })
}

// 关闭下拉菜单
const closeDropdown = () => {
  isOpen.value = false
  searchQuery.value = ''
  highlightedIndex.value = 0
}

// 选择选项
const selectOption = (option: any) => {
  const value = getOptionValue(option)
  emit('update:modelValue', value)
  emit('change', value)
  closeDropdown()
}

// 选择高亮的选项
const selectHighlighted = () => {
  if (filteredOptions.value.length > 0) {
    selectOption(filteredOptions.value[highlightedIndex.value])
  }
}

// 向下导航
const navigateDown = () => {
  if (highlightedIndex.value < filteredOptions.value.length - 1) {
    highlightedIndex.value++
    scrollToHighlighted()
  }
}

// 向上导航
const navigateUp = () => {
  if (highlightedIndex.value > 0) {
    highlightedIndex.value--
    scrollToHighlighted()
  }
}

// 滚动到高亮项
const scrollToHighlighted = () => {
  nextTick(() => {
    if (!optionsListRef.value) return

    const highlightedElement = optionsListRef.value.children[
      highlightedIndex.value
    ] as HTMLElement
    if (highlightedElement) {
      highlightedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  })
}

// 滚动到选中项
const scrollToSelected = () => {
  nextTick(() => {
    if (!optionsListRef.value || !selectedOption.value) return

    const selectedIndex = filteredOptions.value.findIndex(
      (option) => getOptionValue(option) === props.modelValue
    )

    if (selectedIndex !== -1) {
      highlightedIndex.value = selectedIndex
      const selectedElement = optionsListRef.value.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
        })
      }
    }
  })
}

// 点击外部关闭
const handleClickOutside = (event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

// 监听搜索查询变化，重置高亮索引
watch(searchQuery, () => {
  highlightedIndex.value = 0
})

// 生命周期
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
/* 选择器容器 */
.searchable-select {
  position: relative;
  width: 100%;
}

.searchable-select.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 选择框触发器 */
.select-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  cursor: pointer;
  min-height: 24px;
  transition-property: background-color, border-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.select-trigger:hover:not(.is-disabled) {
  background: var(--color-bg-hover);
}

.select-trigger.is-open {
  border-color: transparent;
  background: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.select-trigger.is-disabled {
  cursor: not-allowed;
}

/* 选择框值 */
.select-value {
  flex: 1;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-value.is-placeholder {
  color: var(--color-text-hint);
}

/* 箭头 */
.select-arrow {
  margin-left: var(--spacing-xs);
  color: var(--color-text-secondary);
  width: 14px;
  height: 14px;
  transition-property: color, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  flex-shrink: 0;
}

.select-arrow.is-open {
  transform: rotate(180deg);
}

/* 下拉菜单 */
.select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.35),
    0 8px 18px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  z-index: 1000;
}

/* 搜索输入框容器 */
.search-input-wrapper {
  padding: var(--spacing-xs);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* 搜索输入框 */
.search-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 24px;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  transition-property: background-color, border-color;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.search-input:focus {
  border-color: transparent;
  background: var(--color-bg-hover);
}

.search-input::placeholder {
  color: var(--color-text-hint);
}

/* 选项列表 */
.options-list {
  /* n-scrollbar 会处理滚动，不需要 overflow-y */
}

/* 选项项 */
.option-item {
  margin: var(--spacing-xxs) var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-small);
  cursor: pointer;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  transition-property: background-color, color;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.option-item:hover,
.option-item.is-highlighted {
  background: var(--color-bg-hover);
}

.option-item.is-selected {
  background: var(--color-bg-active);
  color: var(--color-accent-secondary);
  font-weight: 500;
  box-shadow: inset 2px 0 0 var(--color-accent-secondary);
}

/* 无结果提示 */
.no-results {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--color-text-hint);
  font-size: var(--font-size-sm);
}

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition-property: opacity, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  transform-origin: top;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scaleY(0.8);
}

.dropdown-enter-to,
.dropdown-leave-from {
  opacity: 1;
  transform: scaleY(1);
}

/* 滚动条样式由 n-scrollbar 组件处理，移除原生滚动条样式 */
</style>
