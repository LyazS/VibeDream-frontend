<template>
  <div class="timecode-input-wrapper">
    <input
      type="text"
      :value="displayValue"
      @blur="handleBlur"
      @keyup.enter="handleEnter"
      :placeholder="placeholder"
      :style="inputStyle"
      class="timecode-input"
      ref="inputRef"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { framesToTimecode, timecodeToFrames } from '@/core/utils/timeUtils'
import { useAppI18n } from '@/core/composables/useI18n'

interface Props {
  /** 当前帧数值 */
  modelValue: number
  /** 占位符文本 */
  placeholder?: string
  /** 自定义输入框样式 */
  inputStyle?: Record<string, string>
}

interface Emits {
  /** 当时间码值改变时触发，返回解析后的帧数 */
  (e: 'update:modelValue', frames: number): void
  /** 当时间码格式错误时触发 */
  (e: 'error', message: string): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  inputStyle: () => ({ maxWidth: '120px', textAlign: 'center' }),
})

const emit = defineEmits<Emits>()

const { t } = useAppI18n()
const inputRef = ref<HTMLInputElement>()

// 显示值：将帧数转换为时间码格式
const displayValue = computed(() => {
  return framesToTimecode(props.modelValue)
})

// 处理失焦事件
const handleBlur = (event: Event) => {
  updateTimecode(event)
}

// 处理回车键事件
const handleEnter = (event: Event) => {
  updateTimecode(event)
  // 失去焦点
  if (inputRef.value) {
    inputRef.value.blur()
  }
}

// 更新时间码
const updateTimecode = (event: Event) => {
  const input = event.target as HTMLInputElement
  const timecodeValue = input.value.trim()

  if (!timecodeValue) {
    // 如果输入为空，恢复到当前值
    input.value = displayValue.value
    return
  }

  try {
    // 解析时间码为帧数
    const newFrames = timecodeToFrames(timecodeValue)
    const alignedFrames = Math.max(1, newFrames) // 最少1帧

    // 触发更新事件
    emit('update:modelValue', alignedFrames)

    console.log('✅ [TimecodeInput] 时间码更新成功:', {
      inputTimecode: timecodeValue,
      parsedFrames: newFrames,
      alignedFrames: alignedFrames,
      finalTimecode: framesToTimecode(alignedFrames),
    })
  } catch (error) {
    console.warn('⚠️ [TimecodeInput] 时间码格式无效:', timecodeValue, error)

    // 根据错误类型提供具体的错误信息
    let errorMessage = t('properties.errors.invalidTimecodeFormat')
    const errorStr = error instanceof Error ? error.message : String(error)

    if (errorStr.includes('Invalid timecode format')) {
      // 格式错误
      errorMessage = `${t('properties.errors.formatError')}: ${t('properties.errors.invalidTimecodeFormat')}
${t('properties.errors.example')}: ${t('properties.errors.timecodeExample')}
${t('properties.errors.currentInput')}: ${timecodeValue}`
    } else if (errorStr.includes('Invalid timecode values')) {
      // 数值范围错误
      errorMessage = `${t('properties.errors.valueOutOfRange')}:
${t('properties.errors.minutesAndSecondsShouldBeLessThan60')}
${t('properties.errors.framesShouldBeLessThan30')}
${t('properties.errors.currentInput')}: ${timecodeValue}`
    } else {
      // 其他错误
      errorMessage = `${t('properties.errors.timecodeParsingFailed')}
${t('properties.errors.pleaseCheckFormat')}: ${t('properties.errors.timecodeFormat')}
${t('properties.errors.currentInput')}: ${timecodeValue}`
    }

    // 触发错误事件
    emit('error', `${t('properties.errors.timecodeFormatError')}: ${errorMessage}`)

    // 恢复到当前值
    input.value = displayValue.value
  }
}
</script>

<style scoped>
.timecode-input-wrapper {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.timecode-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 24px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  caret-color: var(--color-text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  transition-property: background-color, border-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.timecode-input:hover {
  background: var(--color-bg-hover);
}

.timecode-input:focus {
  outline: none;
  border-color: transparent;
  background: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.timecode-input::placeholder {
  color: var(--color-text-hint);
  font-variant-numeric: tabular-nums;
}
</style>
