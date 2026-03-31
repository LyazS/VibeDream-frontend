<template>
  <div class="mask-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.tabs.mask') }}</h4>

      <div class="property-item">
        <label>{{ t('properties.mask.enabled') }}</label>
        <div class="compact-boolean-control">
          <input
            :checked="maskConfig.enabled"
            type="checkbox"
            class="checkbox-input"
            @change="setEnabled(($event.target as HTMLInputElement).checked)"
          />
        </div>
      </div>

      <div class="property-item">
        <label>{{ t('properties.mask.type') }}</label>
        <select
          class="property-input mask-select"
          :value="maskConfig.type"
          @change="setType(($event.target as HTMLSelectElement).value as MaskType)"
        >
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="property-item">
        <label>{{ t('properties.mask.inverted') }}</label>
        <div class="compact-boolean-control">
          <input
            :checked="maskConfig.inverted"
            type="checkbox"
            class="checkbox-input"
            @change="setInverted(($event.target as HTMLInputElement).checked)"
          />
        </div>
      </div>

      <KeyframedDualNumberField
        :label="t('properties.mask.center')"
        :state="getMaskChannelButtonState('maskCenter')"
        :tooltip="getMaskKeyframeTooltip('maskCenter')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskCenter')"
        :has-next="hasNextMaskKeyframe('maskCenter')"
        :first-label="t('properties.transform.positionX')"
        :second-label="t('properties.transform.positionY')"
        :first-value="maskConfig.centerX"
        :second-value="maskConfig.centerY"
        :first-min="-itemLocalSize.width / 2"
        :first-max="itemLocalSize.width / 2"
        :second-min="-itemLocalSize.height / 2"
        :second-max="itemLocalSize.height / 2"
        :step="1"
        :precision="0"
        @first-change="(value) => setMaskProperty('mask.centerX', value)"
        @second-change="(value) => setMaskProperty('mask.centerY', value)"
        @previous="goToPreviousMaskKeyframe('maskCenter')"
        @toggle="toggleMaskKeyframe('maskCenter')"
        @next="goToNextMaskKeyframe('maskCenter')"
      />

      <KeyframedSliderField
        :label="t('properties.transform.rotation')"
        :state="getMaskChannelButtonState('maskRotation')"
        :tooltip="getMaskKeyframeTooltip('maskRotation')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskRotation')"
        :has-next="hasNextMaskKeyframe('maskRotation')"
        :value="maskConfig.rotation"
        :min="-180"
        :max="180"
        :step="1"
        :precision="0"
        @slider-input="setMaskRotationDeferred"
        @slider-change="commitDeferredUpdates"
        @number-change="(value) => setMaskProperty('mask.rotation', value)"
        @previous="goToPreviousMaskKeyframe('maskRotation')"
        @toggle="toggleMaskKeyframe('maskRotation')"
        @next="goToNextMaskKeyframe('maskRotation')"
      />

      <KeyframedSliderField
        :label="t('properties.mask.outerRange')"
        :state="getMaskChannelButtonState('maskOuterRange')"
        :tooltip="getMaskKeyframeTooltip('maskOuterRange')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskOuterRange')"
        :has-next="hasNextMaskKeyframe('maskOuterRange')"
        :value="maskConfig.falloff.outerRange"
        :min="0"
        :max="Math.max(itemLocalSize.width, itemLocalSize.height)"
        :step="1"
        :precision="0"
        @slider-input="setMaskOuterRangeDeferred"
        @slider-change="commitDeferredUpdates"
        @number-change="(value) => setMaskProperty('mask.outerRange', value)"
        @previous="goToPreviousMaskKeyframe('maskOuterRange')"
        @toggle="toggleMaskKeyframe('maskOuterRange')"
        @next="goToNextMaskKeyframe('maskOuterRange')"
      />

      <KeyframedSliderField
        :label="t('properties.mask.decayRate')"
        :state="getMaskChannelButtonState('maskDecayRate')"
        :tooltip="getMaskKeyframeTooltip('maskDecayRate')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskDecayRate')"
        :has-next="hasNextMaskKeyframe('maskDecayRate')"
        :value="maskConfig.falloff.decayRate"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        @slider-input="setMaskDecayRateDeferred"
        @slider-change="commitDeferredUpdates"
        @number-change="(value) => setMaskProperty('mask.decayRate', value)"
        @previous="goToPreviousMaskKeyframe('maskDecayRate')"
        @toggle="toggleMaskKeyframe('maskDecayRate')"
        @next="goToNextMaskKeyframe('maskDecayRate')"
      />
    </div>

    <div v-if="maskConfig.type === 'rectangle'" class="property-section">
      <h4>{{ t('properties.mask.types.rectangleUpper') }}</h4>

      <KeyframedDualNumberField
        :label="t('properties.mask.size')"
        :state="getMaskChannelButtonState('maskRectangleSize')"
        :tooltip="getMaskKeyframeTooltip('maskRectangleSize')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskRectangleSize')"
        :has-next="hasNextMaskKeyframe('maskRectangleSize')"
        :first-label="t('properties.mask.widthShort')"
        :second-label="t('properties.mask.heightShort')"
        :first-value="rectangleMaskConfig?.width ?? 0"
        :second-value="rectangleMaskConfig?.height ?? 0"
        :first-min="0"
        :first-max="itemLocalSize.width"
        :second-min="0"
        :second-max="itemLocalSize.height"
        :step="1"
        :precision="0"
        @first-change="(value) => setMaskProperty('mask.width', value)"
        @second-change="(value) => setMaskProperty('mask.height', value)"
        @previous="goToPreviousMaskKeyframe('maskRectangleSize')"
        @toggle="toggleMaskKeyframe('maskRectangleSize')"
        @next="goToNextMaskKeyframe('maskRectangleSize')"
      />

      <KeyframedSliderField
        :label="t('properties.mask.cornerRadius')"
        :state="getMaskChannelButtonState('maskRectangleCorner')"
        :tooltip="getMaskKeyframeTooltip('maskRectangleCorner')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskRectangleCorner')"
        :has-next="hasNextMaskKeyframe('maskRectangleCorner')"
        :value="rectangleMaskConfig?.cornerRadius ?? 0"
        :min="0"
        :max="rectangleCornerRadiusMax"
        :step="1"
        :precision="0"
        @slider-input="setMaskCornerRadiusDeferred"
        @slider-change="commitDeferredUpdates"
        @number-change="(value) => setMaskProperty('mask.cornerRadius', value)"
        @previous="goToPreviousMaskKeyframe('maskRectangleCorner')"
        @toggle="toggleMaskKeyframe('maskRectangleCorner')"
        @next="goToNextMaskKeyframe('maskRectangleCorner')"
      />
    </div>

    <div v-if="maskConfig.type === 'ellipse'" class="property-section">
      <h4>{{ t('properties.mask.types.ellipseUpper') }}</h4>

      <KeyframedDualNumberField
        :label="t('properties.mask.size')"
        :state="getMaskChannelButtonState('maskEllipseSize')"
        :tooltip="getMaskKeyframeTooltip('maskEllipseSize')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskEllipseSize')"
        :has-next="hasNextMaskKeyframe('maskEllipseSize')"
        :first-label="t('properties.mask.widthShort')"
        :second-label="t('properties.mask.heightShort')"
        :first-value="ellipseMaskConfig?.ellipseWidth ?? 0"
        :second-value="ellipseMaskConfig?.ellipseHeight ?? 0"
        :first-min="0"
        :first-max="itemLocalSize.width"
        :second-min="0"
        :second-max="itemLocalSize.height"
        :step="1"
        :precision="0"
        @first-change="(value) => setMaskProperty('mask.ellipseWidth', value)"
        @second-change="(value) => setMaskProperty('mask.ellipseHeight', value)"
        @previous="goToPreviousMaskKeyframe('maskEllipseSize')"
        @toggle="toggleMaskKeyframe('maskEllipseSize')"
        @next="goToNextMaskKeyframe('maskEllipseSize')"
      />
    </div>

    <div v-if="maskConfig.type === 'mirror'" class="property-section">
      <h4>{{ t('properties.mask.types.mirrorUpper') }}</h4>

      <KeyframedSliderField
        :label="t('properties.mask.length')"
        :state="getMaskChannelButtonState('maskMirrorLength')"
        :tooltip="getMaskKeyframeTooltip('maskMirrorLength')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('maskMirrorLength')"
        :has-next="hasNextMaskKeyframe('maskMirrorLength')"
        :value="mirrorMaskConfig?.length ?? 0"
        :min="0"
        :max="itemLocalSize.width"
        :step="1"
        :precision="0"
        @slider-input="setMaskLengthDeferred"
        @slider-change="commitDeferredUpdates"
        @number-change="(value) => setMaskProperty('mask.length', value)"
        @previous="goToPreviousMaskKeyframe('maskMirrorLength')"
        @toggle="toggleMaskKeyframe('maskMirrorLength')"
        @next="goToNextMaskKeyframe('maskMirrorLength')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n, useUnifiedMaskKeyframeControls } from '@/core/composables'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MaskType } from '@/core/timelineitem/mask'
import KeyframedDualNumberField from '@/components/properties/common/KeyframedDualNumberField.vue'
import KeyframedSliderField from '@/components/properties/common/KeyframedSliderField.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData
  currentFrame: number
}

const props = defineProps<Props>()
const { t } = useAppI18n()

const typeOptions = computed<{ value: MaskType; label: string }[]>(() => [
  { value: 'rectangle', label: t('properties.mask.types.rectangle') },
  { value: 'ellipse', label: t('properties.mask.types.ellipse') },
  { value: 'linear', label: t('properties.mask.types.linear') },
  { value: 'mirror', label: t('properties.mask.types.mirror') },
])

const {
  itemLocalSize,
  maskConfig,
  rectangleMaskConfig,
  ellipseMaskConfig,
  mirrorMaskConfig,
  rectangleCornerRadiusMax,
  canOperateMaskNumbers,
  getMaskChannelButtonState,
  hasPreviousMaskKeyframe,
  hasNextMaskKeyframe,
  getMaskKeyframeTooltip,
  setMaskProperty,
  setEnabled,
  setType,
  setInverted,
  toggleMaskKeyframe,
  setMaskRotationDeferred,
  setMaskOuterRangeDeferred,
  setMaskDecayRateDeferred,
  setMaskCornerRadiusDeferred,
  setMaskLengthDeferred,
  commitDeferredUpdates,
  goToPreviousMaskKeyframe,
  goToNextMaskKeyframe,
} = useUnifiedMaskKeyframeControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

</script>

<style scoped>
.mask-properties-group {
  width: 100%;
}

.checkbox-input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-text-primary);
  cursor: pointer;
}

.mask-select {
  min-height: 30px;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 32px;
  background-color: var(--color-bg-quaternary);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--color-text-secondary) 50%),
    linear-gradient(135deg, var(--color-text-secondary) 50%, transparent 50%);
  background-position:
    calc(100% - 18px) calc(50% - 3px),
    calc(100% - 12px) calc(50% - 3px);
  background-size:
    6px 6px,
    6px 6px;
  background-repeat: no-repeat;
}

.compact-boolean-control {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 30px;
}

</style>
