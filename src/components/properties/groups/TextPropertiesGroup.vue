<template>
  <div class="text-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.text.textProperties') }}</h4>
      
      <!-- 文本内容 -->
      <div class="property-item">
        <label>{{ t('properties.basic.textContent') }}</label>
        <textarea
          :value="localText"
          @blur="updateTextContent"
          @keyup.ctrl.enter="updateTextContent"
          :disabled="!canOperateTransforms"
          class="text-content-input"
          :placeholder="t('properties.placeholders.enterText')"
          rows="3"
        />
      </div>

      <!-- 字体设置 -->
      <div class="property-item">
        <label>{{ t('properties.basic.fontFamily') }}</label>
        <div class="font-controls">
          <select
            :value="localStyle.fontFamily"
            @change="handleFontFamilyChange"
            :disabled="!canOperateTransforms"
            class="font-family-select"
          >
            <option value="Arial, sans-serif">{{ t('properties.fonts.fontFamilyArial') }}</option>
            <option value="'Microsoft YaHei', sans-serif">
              {{ t('properties.fonts.fontFamilyMicrosoftYaHei') }}
            </option>
            <option value="'SimHei', sans-serif">
              {{ t('properties.fonts.fontFamilySimHei') }}
            </option>
            <option value="'SimSun', serif">{{ t('properties.fonts.fontFamilySimSun') }}</option>
            <option value="'KaiTi', serif">{{ t('properties.fonts.fontFamilyKaiTi') }}</option>
            <option value="'Times New Roman', serif">
              {{ t('properties.fonts.fontFamilyTimesNewRoman') }}
            </option>
            <option value="'Courier New', monospace">
              {{ t('properties.fonts.fontFamilyCourierNew') }}
            </option>
          </select>
        </div>
      </div>

      <!-- 字体大小 -->
      <div class="property-item">
        <label>{{ t('properties.basic.fontSize') }}</label>
        <div class="font-size-controls">
          <SliderInput
            :model-value="localStyle.fontSize"
            @input="updateFontSize"
            :disabled="!canOperateTransforms"
            :min="12"
            :max="200"
            :step="1"
            slider-class="font-size-slider"
          />
          <NumberInput
            :model-value="localStyle.fontSize"
            @change="updateFontSize"
            :disabled="!canOperateTransforms"
            :min="12"
            :max="200"
            :step="1"
            :precision="0"
            :show-controls="false"
            :placeholder="t('properties.placeholders.fontSize')"
            :input-style="{ maxWidth: '60px', textAlign: 'center' }"
          />
        </div>
      </div>

      <!-- 字体样式 -->
      <div class="property-item">
        <label>{{ t('properties.basic.fontStyle') }}</label>
        <div class="font-style-controls">
          <select
            :value="localStyle.fontWeight"
            @change="handleFontWeightChange"
            :disabled="!canOperateTransforms"
            class="font-weight-select"
          >
            <option value="normal">{{ t('properties.effects.normal') }}</option>
            <option value="bold">{{ t('properties.effects.bold') }}</option>
            <option value="lighter">{{ t('properties.effects.lighter') }}</option>
          </select>
          <select
            :value="localStyle.fontStyle"
            @change="handleFontStyleChange"
            :disabled="!canOperateTransforms"
            class="font-style-select"
          >
            <option value="normal">{{ t('properties.fonts.fontStyleNormal') }}</option>
            <option value="italic">{{ t('properties.fonts.fontStyleItalic') }}</option>
          </select>
        </div>
      </div>

      <!-- 文字颜色 -->
      <div class="property-item">
        <label>{{ t('properties.effects.textColor') }}</label>
        <div class="color-controls">
          <input
            type="color"
            :value="localStyle.color"
            @change="handleColorChange"
            :disabled="!canOperateTransforms"
            class="color-picker"
          />
        </div>
      </div>

      <!-- 背景颜色 -->
      <div class="property-item">
        <label>{{ t('properties.effects.backgroundColor') }}</label>
        <div class="background-color-controls">
          <input
            type="color"
            :value="localStyle.backgroundColor || '#000000'"
            @change="handleBackgroundColorChange"
            class="color-picker"
            :disabled="!backgroundColorEnabled || !canOperateTransforms"
          />
          <label class="checkbox-wrapper">
            <input
              type="checkbox"
              :checked="backgroundColorEnabled"
              @change="toggleBackgroundColor"
              :disabled="!canOperateTransforms"
              class="background-color-checkbox"
            />
          </label>
        </div>
      </div>

      <!-- 文本对齐 -->
      <div class="property-item">
        <label>{{ t('properties.effects.textAlign') }}</label>
        <div class="text-align-controls">
          <button
            v-for="align in textAlignOptions"
            :key="align.value"
            @click="updateTextAlign"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :class="{ active: localStyle.textAlign === align.value }"
            :title="
              t(
                `properties.effects.textAlign${align.value.charAt(0).toUpperCase() + align.value.slice(1)}`,
              )
            "
            :data-align="align.value"
          >
            <component
              :is="
                align.value === 'left'
                  ? IconComponents.ALIGN_LEFT
                  : align.value === 'center'
                    ? IconComponents.ALIGN_CENTER
                    : IconComponents.ALIGN_RIGHT
              "
              size="16px"
            />
          </button>
        </div>
      </div>
      <!-- 阴影效果 -->
      <div class="property-item">
        <label>{{ t('properties.effects.shadow') }}</label>
        <div class="shadow-controls">
          <label class="checkbox-wrapper">
            <input
              type="checkbox"
              :checked="shadowEnabled"
              @change="toggleShadow"
              :disabled="!canOperateTransforms"
              class="effect-checkbox"
            />
          </label>
          <div v-if="shadowEnabled" class="shadow-settings">
            <div class="shadow-setting-row">
              <label class="setting-label">{{ t('properties.effects.effectColor') }}</label>
              <input
                type="color"
                :value="shadowColor"
                @change="handleShadowColorChange"
                :disabled="!canOperateTransforms"
                class="color-picker small"
              />
            </div>
            <div class="shadow-setting-row">
              <label class="setting-label">{{ t('properties.effects.blur') }}</label>
              <SliderInput
                :model-value="shadowBlur"
                @input="updateShadowBlur"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="20"
                :step="1"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="shadowBlur"
                @change="updateShadowBlur"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="20"
                :step="1"
                :precision="0"
                :show-controls="false"
                :placeholder="t('properties.placeholders.blur')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
            <div class="shadow-setting-row">
              <label class="setting-label">{{ t('properties.effects.shadowOffsetX') }}</label>
              <SliderInput
                :model-value="shadowOffsetX"
                @input="updateShadowOffsetX"
                :disabled="!canOperateTransforms"
                :min="-20"
                :max="20"
                :step="1"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="shadowOffsetX"
                @change="updateShadowOffsetX"
                :disabled="!canOperateTransforms"
                :min="-20"
                :max="20"
                :step="1"
                :precision="0"
                :show-controls="false"
                :placeholder="t('properties.placeholders.offsetX')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
            <div class="shadow-setting-row">
              <label class="setting-label">{{ t('properties.effects.shadowOffsetY') }}</label>
              <SliderInput
                :model-value="shadowOffsetY"
                @input="updateShadowOffsetY"
                :disabled="!canOperateTransforms"
                :min="-20"
                :max="20"
                :step="1"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="shadowOffsetY"
                @change="updateShadowOffsetY"
                :disabled="!canOperateTransforms"
                :min="-20"
                :max="20"
                :step="1"
                :precision="0"
                :show-controls="false"
                :placeholder="t('properties.placeholders.offsetY')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 描边效果 -->
      <div class="property-item">
        <label>{{ t('properties.effects.stroke') }}</label>
        <div class="stroke-controls">
          <label class="checkbox-wrapper">
            <input
              type="checkbox"
              :checked="strokeEnabled"
              @change="toggleStroke"
              :disabled="!canOperateTransforms"
              class="effect-checkbox"
            />
          </label>
          <div v-if="strokeEnabled" class="stroke-settings">
            <div class="stroke-setting-row">
              <label class="setting-label">{{ t('properties.effects.effectColor') }}</label>
              <input
                type="color"
                :value="strokeColor"
                @change="handleStrokeColorChange"
                :disabled="!canOperateTransforms"
                class="color-picker small"
              />
            </div>
            <div class="stroke-setting-row">
              <label class="setting-label">{{ t('properties.effects.width') }}</label>
              <SliderInput
                :model-value="strokeWidth"
                @input="updateStrokeWidth"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="10"
                :step="0.5"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="strokeWidth"
                @change="updateStrokeWidth"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="10"
                :step="0.5"
                :precision="1"
                :show-controls="false"
                :placeholder="t('properties.placeholders.width')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 发光效果 -->
      <div class="property-item">
        <label>{{ t('properties.effects.glow') }}</label>
        <div class="glow-controls">
          <label class="checkbox-wrapper">
            <input
              type="checkbox"
              :checked="glowEnabled"
              @change="toggleGlow"
              :disabled="!canOperateTransforms"
              class="effect-checkbox"
            />
          </label>
          <div v-if="glowEnabled" class="glow-settings">
            <div class="glow-setting-row">
              <label class="setting-label">{{ t('properties.effects.effectColor') }}</label>
              <input
                type="color"
                :value="glowColor"
                @change="handleGlowColorChange"
                :disabled="!canOperateTransforms"
                class="color-picker small"
              />
            </div>
            <div class="glow-setting-row">
              <label class="setting-label">{{ t('properties.effects.blur') }}</label>
              <SliderInput
                :model-value="glowBlur"
                @input="updateGlowBlur"
                :disabled="!canOperateTransforms"
                :min="1"
                :max="30"
                :step="1"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="glowBlur"
                @change="updateGlowBlur"
                :disabled="!canOperateTransforms"
                :min="1"
                :max="30"
                :step="1"
                :precision="0"
                :show-controls="false"
                :placeholder="t('properties.placeholders.blur')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
            <div class="glow-setting-row">
              <label class="setting-label">{{ t('properties.effects.spread') }}</label>
              <SliderInput
                :model-value="glowSpread"
                @input="updateGlowSpread"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="20"
                :step="1"
                slider-class="effect-slider"
              />
              <NumberInput
                :model-value="glowSpread"
                @change="updateGlowSpread"
                :disabled="!canOperateTransforms"
                :min="0"
                :max="20"
                :step="1"
                :precision="0"
                :show-controls="false"
                :placeholder="t('properties.placeholders.spread')"
                :input-style="{ maxWidth: '50px', textAlign: 'center' }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { isTextTimelineItem } from '@/core/timelineitem/queries'
import { useUnifiedKeyframeTransformControls } from '@/core/composables'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { TextStyleConfig } from '@/core/timelineitem/texttype'
import { IconComponents } from '@/constants/iconComponents'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData<'text'> | null
  currentFrame: number
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 TextPropertiesGroup 内部实现提交分流或样式组装，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

// 获取禁用状态（当播放头不在播放范围内时禁用）
const { canOperateTransforms } = useUnifiedKeyframeTransformControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

// 获取当前文本内容
const localText = computed(() => {
  if (props.selectedTimelineItem && isTextTimelineItem(props.selectedTimelineItem)) {
    return props.selectedTimelineItem.config.text
  }
  return ''
})

// 获取当前文本样式
const localStyle = computed<TextStyleConfig>(() => {
  if (props.selectedTimelineItem && isTextTimelineItem(props.selectedTimelineItem)) {
    return { ...props.selectedTimelineItem.config.style }
  }
  return {
    fontSize: 48,
    fontFamily: 'Arial, sans-serif',
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 1.2,
    backgroundColor: '#000000',
  }
})

// 背景颜色启用状态
const backgroundColorEnabled = computed(() => !!localStyle.value.backgroundColor)

// 阴影效果状态
const shadowEnabled = computed(() => !!localStyle.value.textShadow)

const shadowColor = computed(() => {
  if (localStyle.value.textShadow) {
    const shadowMatch = localStyle.value.textShadow.match(
      /#[0-9a-fA-F]{6}|rgba?\([^)]+\)|[a-zA-Z]+$/,
    )
    return shadowMatch ? shadowMatch[0] : '#000000'
  }
  return '#000000'
})

const shadowOffsetX = computed(() => {
  if (localStyle.value.textShadow) {
    const shadowMatch = localStyle.value.textShadow.match(/(-?\d+)px/)
    return shadowMatch ? parseInt(shadowMatch[1]) : 2
  }
  return 2
})

const shadowOffsetY = computed(() => {
  if (localStyle.value.textShadow) {
    const shadowMatch = localStyle.value.textShadow.match(/(-?\d+)px\s+(-?\d+)px/)
    return shadowMatch ? parseInt(shadowMatch[2]) : 2
  }
  return 2
})

const shadowBlur = computed(() => {
  if (localStyle.value.textShadow) {
    const shadowMatch = localStyle.value.textShadow.match(/^(-?\d+)px\s+(-?\d+)px\s+(\d+)px/)
    return shadowMatch ? parseInt(shadowMatch[3]) : 4
  }
  return 4
})

// 描边效果状态
const strokeEnabled = computed(() => !!localStyle.value.textStroke)
const strokeColor = computed(() => localStyle.value.textStroke?.color || '#000000')
const strokeWidth = computed(() => localStyle.value.textStroke?.width || 1)

// 发光效果状态
const glowEnabled = computed(() => !!localStyle.value.textGlow)
const glowColor = computed(() => localStyle.value.textGlow?.color || '#ffffff')
const glowBlur = computed(() => localStyle.value.textGlow?.blur || 10)
const glowSpread = computed(() => localStyle.value.textGlow?.spread || 0)

// 文本对齐选项
const textAlignOptions = [
  { value: 'left' as const, label: '左对齐' },
  { value: 'center' as const, label: '居中对齐' },
  { value: 'right' as const, label: '右对齐' },
]

// 更新文本内容
const updateTextContent = async (event: Event) => {
  throwClipPropertyPhase0Todo('text.content.update')
  const target = event.target as HTMLTextAreaElement
  const textValue = target.value.trim()

  if (!props.selectedTimelineItem || !isTextTimelineItem(props.selectedTimelineItem) || !textValue) {
    return
  }

  try {
    await unifiedStore.updateTextContentWithHistory(props.selectedTimelineItem.id, textValue, {})
  } catch (error) {
    console.error('更新文本内容失败:', error)
    unifiedStore.messageError(t('properties.errors.textContentUpdateFailed'))
  }
}

// 更新文本样式
const updateTextStyle = async (styleUpdates: Partial<TextStyleConfig> = {}) => {
  throwClipPropertyPhase0Todo('text.style.update')
  if (!props.selectedTimelineItem || !isTextTimelineItem(props.selectedTimelineItem)) {
    return
  }

  try {
    await unifiedStore.updateTextStyleWithHistory(props.selectedTimelineItem.id, styleUpdates)
  } catch (error) {
    console.error('更新文本样式失败:', error)
    unifiedStore.messageError(t('properties.errors.textStyleUpdateFailed'))
  }
}

// 字体相关处理
const updateFontSize = (size: number) => {
  updateTextStyle({ fontSize: Math.max(12, Math.min(200, size)) })
}

const handleFontFamilyChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  updateTextStyle({ fontFamily: target.value })
}

const handleFontWeightChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  updateTextStyle({ fontWeight: target.value })
}

const handleFontStyleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  updateTextStyle({ fontStyle: target.value as 'normal' | 'italic' })
}

// 颜色相关处理
const handleColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  updateTextStyle({ color: target.value })
}

const handleBackgroundColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  updateTextStyle({ backgroundColor: target.value })
}

const toggleBackgroundColor = () => {
  const newEnabled = !backgroundColorEnabled.value
  if (newEnabled) {
    updateTextStyle({ backgroundColor: localStyle.value.backgroundColor || '#000000' })
  } else {
    updateTextStyle({ backgroundColor: undefined })
  }
}

// 文本对齐
const updateTextAlign = (event: Event) => {
  const align = (event.target as HTMLButtonElement).dataset.align as 'left' | 'center' | 'right'
  if (align) {
    updateTextStyle({ textAlign: align })
  }
}

// 阴影效果
const toggleShadow = () => {
  if (shadowEnabled.value) {
    updateTextStyle({ textShadow: undefined })
  } else {
    updateTextStyle({ textShadow: '2px 2px 4px #000000' })
  }
}

const updateShadowBlur = (blur: number) => {
  const clampedBlur = Math.max(0, Math.min(20, blur))
  if (shadowEnabled.value) {
    updateTextStyle({
      textShadow: `${shadowOffsetX.value}px ${shadowOffsetY.value}px ${clampedBlur}px ${shadowColor.value}`,
    })
  }
}

const updateShadowOffsetX = (offsetX: number) => {
  const clampedOffsetX = Math.max(-20, Math.min(20, offsetX))
  if (shadowEnabled.value) {
    updateTextStyle({
      textShadow: `${clampedOffsetX}px ${shadowOffsetY.value}px ${shadowBlur.value}px ${shadowColor.value}`,
    })
  }
}

const updateShadowOffsetY = (offsetY: number) => {
  const clampedOffsetY = Math.max(-20, Math.min(20, offsetY))
  if (shadowEnabled.value) {
    updateTextStyle({
      textShadow: `${shadowOffsetX.value}px ${clampedOffsetY}px ${shadowBlur.value}px ${shadowColor.value}`,
    })
  }
}

const handleShadowColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (shadowEnabled.value) {
    updateTextStyle({
      textShadow: `${shadowOffsetX.value}px ${shadowOffsetY.value}px ${shadowBlur.value}px ${target.value}`,
    })
  }
}

// 描边效果
const toggleStroke = () => {
  if (strokeEnabled.value) {
    updateTextStyle({ textStroke: undefined })
  } else {
    updateTextStyle({ textStroke: { width: 1, color: '#000000' } })
  }
}

const updateStrokeWidth = (width: number) => {
  const clampedWidth = Math.max(0, Math.min(10, width))
  if (strokeEnabled.value) {
    updateTextStyle({ textStroke: { width: clampedWidth, color: strokeColor.value } })
  }
}

const handleStrokeColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (strokeEnabled.value) {
    updateTextStyle({ textStroke: { width: strokeWidth.value, color: target.value } })
  }
}

// 发光效果
const toggleGlow = () => {
  if (glowEnabled.value) {
    updateTextStyle({ textGlow: undefined })
  } else {
    updateTextStyle({ textGlow: { color: '#ffffff', blur: 10, spread: 0 } })
  }
}

const updateGlowBlur = (blur: number) => {
  const clampedBlur = Math.max(1, Math.min(30, blur))
  if (glowEnabled.value) {
    updateTextStyle({
      textGlow: { color: glowColor.value, blur: clampedBlur, spread: glowSpread.value },
    })
  }
}

const updateGlowSpread = (spread: number) => {
  const clampedSpread = Math.max(0, Math.min(20, spread))
  if (glowEnabled.value) {
    updateTextStyle({
      textGlow: { color: glowColor.value, blur: glowBlur.value, spread: clampedSpread },
    })
  }
}

const handleGlowColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (glowEnabled.value) {
    updateTextStyle({
      textGlow: { color: target.value, blur: glowBlur.value, spread: glowSpread.value },
    })
  }
}
</script>

<style scoped>
.text-properties-group {
  width: 100%;
}

/* 文本内容输入框 */
.text-content-input {
  width: 100%;
  min-height: 60px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  resize: vertical;
  transition: border-color 0.2s ease;
}

.text-content-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  background: var(--color-bg-primary);
}

.text-content-input::placeholder {
  color: var(--color-text-hint);
  font-style: italic;
}

/* 字体控制样式 */
.font-controls {
  display: flex;
  align-items: center;
  flex: 1;
}

.font-family-select,
.font-weight-select,
.font-style-select {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.font-family-select:focus,
.font-weight-select:focus,
.font-style-select:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.font-size-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 1;
}

.font-style-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
}

.font-weight-select,
.font-style-select {
  flex: 1;
}

/* 颜色控制样式 */
.color-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
}

.color-picker {
  width: 40px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--border-radius-small);
  cursor: pointer;
  background: transparent;
  transition: border-color 0.2s ease;
}

.color-picker:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.color-picker:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.color-picker.small {
  width: 32px;
  height: 24px;
}

.background-color-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  cursor: pointer;
}

.background-color-checkbox,
.effect-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* 文本对齐控制 */
.text-align-controls {
  display: flex;
  gap: var(--spacing-xs);
}

.align-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.align-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-focus);
  color: var(--color-text-primary);
}

.align-btn.active {
  background: var(--color-accent-primary);
  border-color: var(--color-accent-primary);
  color: var(--color-bg-primary);
}

.align-btn.active:hover {
  background: var(--color-accent-secondary);
  border-color: var(--color-accent-secondary);
}

/* 文本效果样式 */
.shadow-controls,
.stroke-controls,
.glow-controls {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  flex: 1;
}

.shadow-settings,
.stroke-settings,
.glow-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  background: var(--color-bg-tertiary);
  border-radius: var(--border-radius-small);
  border: 1px solid var(--color-border-secondary);
}

.shadow-setting-row,
.stroke-setting-row,
.glow-setting-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.setting-label {
  min-width: 40px;
  font-size: 12px;
  color: var(--color-text-secondary);
  text-align: right;
}

.effect-slider {
  flex: 1;
  min-width: 80px;
}
</style>
