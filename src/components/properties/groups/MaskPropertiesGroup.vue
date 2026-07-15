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

      <div v-if="hasMaskConfig" class="property-item">
        <label>{{ t('properties.mask.type') }}</label>
        <SearchableSelect
          class="mask-select"
          :model-value="maskConfig.type"
          :options="typeOptions"
          :searchable="false"
          :placeholder="t('properties.mask.type')"
          @update:model-value="(value) => setType(value as MaskType)"
        />
      </div>

      <div v-if="hasMaskConfig" class="property-item">
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
        v-if="hasMaskConfig"
        :label="t('properties.mask.center')"
        :state="getMaskChannelButtonState('mask.center')"
        :tooltip="getMaskKeyframeTooltip('mask.center')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.center')"
        :has-next="hasNextMaskKeyframe('mask.center')"
        :first-label="t('properties.visual.positionX')"
        :second-label="t('properties.visual.positionY')"
        :first-value="maskConfig.centerX"
        :second-value="maskConfig.centerY"
        :first-min="-itemLocalSize.width / 2"
        :first-max="itemLocalSize.width / 2"
        :second-min="-itemLocalSize.height / 2"
        :second-max="itemLocalSize.height / 2"
        :step="1"
        :precision="0"
        @first-input="(value) => previewMaskCenterChange('centerX', value)"
        @second-input="(value) => previewMaskCenterChange('centerY', value)"
        @first-change="(value) => commitMaskCenterChange('centerX', value)"
        @second-change="(value) => commitMaskCenterChange('centerY', value)"
        @previous="goToPreviousMaskKeyframe('mask.center')"
        @toggle="toggleMaskKeyframe('mask.center')"
        @next="goToNextMaskKeyframe('mask.center')"
      />

      <KeyframedRotationField
        v-if="hasMaskConfig"
        :label="t('properties.visual.rotation')"
        :state="getMaskChannelButtonState('mask.rotation')"
        :tooltip="getMaskKeyframeTooltip('mask.rotation')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.rotation')"
        :has-next="hasNextMaskKeyframe('mask.rotation')"
        :value="maskConfig.rotation"
        :step="1"
        :precision="0"
        @rotation-input="setMaskRotationDeferred"
        @rotation-change="commitMaskRotationDeferredUpdate"
        @number-change="(value) => setMaskProperty('mask.rotation', value)"
        @previous="goToPreviousMaskKeyframe('mask.rotation')"
        @toggle="toggleMaskKeyframe('mask.rotation')"
        @next="goToNextMaskKeyframe('mask.rotation')"
      />

      <KeyframedSliderField
        v-if="hasMaskConfig"
        :label="t('properties.mask.outerRange')"
        :state="getMaskChannelButtonState('mask.feather')"
        :tooltip="getMaskKeyframeTooltip('mask.feather')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.feather')"
        :has-next="hasNextMaskKeyframe('mask.feather')"
        :value="maskConfig.falloff.outerRange"
        :min="0"
        :max="Math.max(itemLocalSize.width, itemLocalSize.height)"
        :step="1"
        :precision="0"
        @slider-input="setMaskOuterRangeDeferred"
        @slider-change="commitMaskFeatherDeferredUpdate"
        @number-change="(value) => setMaskProperty('mask.outerRange', value)"
        @previous="goToPreviousMaskKeyframe('mask.feather')"
        @toggle="toggleMaskKeyframe('mask.feather')"
        @next="goToNextMaskKeyframe('mask.feather')"
      />

      <KeyframedSliderField
        v-if="hasMaskConfig"
        :label="t('properties.mask.decayRate')"
        :state="getMaskChannelButtonState('mask.intensity')"
        :tooltip="getMaskKeyframeTooltip('mask.intensity')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.intensity')"
        :has-next="hasNextMaskKeyframe('mask.intensity')"
        :value="maskConfig.falloff.decayRate"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        @slider-input="setMaskDecayRateDeferred"
        @slider-change="commitMaskIntensityDeferredUpdate"
        @number-change="(value) => setMaskProperty('mask.decayRate', value)"
        @previous="goToPreviousMaskKeyframe('mask.intensity')"
        @toggle="toggleMaskKeyframe('mask.intensity')"
        @next="goToNextMaskKeyframe('mask.intensity')"
      />
    </div>

    <div v-if="hasMaskConfig && maskConfig.type === 'rectangle'" class="property-section">
      <h4>{{ t('properties.mask.types.rectangleUpper') }}</h4>

      <KeyframedDualNumberField
        :label="t('properties.mask.size')"
        :state="getMaskChannelButtonState('mask.rectangle.size')"
        :tooltip="getMaskKeyframeTooltip('mask.rectangle.size')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.rectangle.size')"
        :has-next="hasNextMaskKeyframe('mask.rectangle.size')"
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
        @first-input="(value) => previewRectangleMaskSizeChange('width', value)"
        @second-input="(value) => previewRectangleMaskSizeChange('height', value)"
        @first-change="(value) => commitRectangleMaskSizeChange('width', value)"
        @second-change="(value) => commitRectangleMaskSizeChange('height', value)"
        @previous="goToPreviousMaskKeyframe('mask.rectangle.size')"
        @toggle="toggleMaskKeyframe('mask.rectangle.size')"
        @next="goToNextMaskKeyframe('mask.rectangle.size')"
      />

      <KeyframedSliderField
        :label="t('properties.mask.cornerRadius')"
        :state="getMaskChannelButtonState('mask.rectangle.cornerRadius')"
        :tooltip="getMaskKeyframeTooltip('mask.rectangle.cornerRadius')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.rectangle.cornerRadius')"
        :has-next="hasNextMaskKeyframe('mask.rectangle.cornerRadius')"
        :value="rectangleMaskConfig?.cornerRadius ?? 0"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        @slider-input="setMaskRectangleCornerRadiusDeferred"
        @slider-change="commitMaskRectangleCornerRadiusDeferredUpdate"
        @number-change="(value) => setMaskProperty('mask.cornerRadius', value)"
        @previous="goToPreviousMaskKeyframe('mask.rectangle.cornerRadius')"
        @toggle="toggleMaskKeyframe('mask.rectangle.cornerRadius')"
        @next="goToNextMaskKeyframe('mask.rectangle.cornerRadius')"
      />
    </div>

    <div v-if="hasMaskConfig && maskConfig.type === 'ellipse'" class="property-section">
      <h4>{{ t('properties.mask.types.ellipseUpper') }}</h4>

      <KeyframedDualNumberField
        :label="t('properties.mask.size')"
        :state="getMaskChannelButtonState('mask.ellipse.size')"
        :tooltip="getMaskKeyframeTooltip('mask.ellipse.size')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.ellipse.size')"
        :has-next="hasNextMaskKeyframe('mask.ellipse.size')"
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
        @first-input="(value) => previewEllipseMaskSizeChange('ellipseWidth', value)"
        @second-input="(value) => previewEllipseMaskSizeChange('ellipseHeight', value)"
        @first-change="(value) => commitEllipseMaskSizeChange('ellipseWidth', value)"
        @second-change="(value) => commitEllipseMaskSizeChange('ellipseHeight', value)"
        @previous="goToPreviousMaskKeyframe('mask.ellipse.size')"
        @toggle="toggleMaskKeyframe('mask.ellipse.size')"
        @next="goToNextMaskKeyframe('mask.ellipse.size')"
      />
    </div>

    <div v-if="hasMaskConfig && maskConfig.type === 'mirror'" class="property-section">
      <h4>{{ t('properties.mask.types.mirrorUpper') }}</h4>

      <KeyframedSliderField
        :label="t('properties.mask.length')"
        :state="getMaskChannelButtonState('mask.mirror.length')"
        :tooltip="getMaskKeyframeTooltip('mask.mirror.length')"
        :disabled="!canOperateMaskNumbers"
        :has-previous="hasPreviousMaskKeyframe('mask.mirror.length')"
        :has-next="hasNextMaskKeyframe('mask.mirror.length')"
        :value="mirrorMaskConfig?.length ?? 0"
        :min="0"
        :max="itemLocalSize.width"
        :step="1"
        :precision="0"
        @slider-input="setMaskMirrorLengthDeferred"
        @slider-change="commitMaskMirrorLengthDeferredUpdate"
        @number-change="(value) => setMaskProperty('mask.length', value)"
        @previous="goToPreviousMaskKeyframe('mask.mirror.length')"
        @toggle="toggleMaskKeyframe('mask.mirror.length')"
        @next="goToNextMaskKeyframe('mask.mirror.length')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n, useUnifiedMaskKeyframeControls } from '@/core/composables'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MaskType } from '@/core/timelineitem/features/mask'
import SearchableSelect from '@/components/base/SearchableSelect.vue'
import KeyframedDualNumberField from '@/components/properties/common/KeyframedDualNumberField.vue'
import KeyframedSliderField from '@/components/properties/common/KeyframedSliderField.vue'
import KeyframedRotationField from '@/components/properties/common/KeyframedRotationField.vue'

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
  hasMaskConfig,
  rectangleMaskConfig,
  ellipseMaskConfig,
  mirrorMaskConfig,
  canOperateMaskNumbers,
  getMaskChannelButtonState,
  hasPreviousMaskKeyframe,
  hasNextMaskKeyframe,
  getMaskKeyframeTooltip,
  setMaskProperty,
  setEnabled,
  setType,
  setInverted,
  setMaskOuterRangeDeferred,
  commitMaskFeatherDeferredUpdate,
  setMaskDecayRateDeferred,
  commitMaskIntensityDeferredUpdate,
  setMaskCenterDeferred,
  commitMaskCenterDeferredUpdate,
  setMaskRectangleSizeDeferred,
  commitMaskRectangleSizeDeferredUpdate,
  setMaskEllipseSizeDeferred,
  commitMaskEllipseSizeDeferredUpdate,
  toggleMaskKeyframe,
  setMaskRotationDeferred,
  commitMaskRotationDeferredUpdate,
  setMaskRectangleCornerRadiusDeferred,
  commitMaskRectangleCornerRadiusDeferredUpdate,
  setMaskMirrorLengthDeferred,
  commitMaskMirrorLengthDeferredUpdate,
  goToPreviousMaskKeyframe,
  goToNextMaskKeyframe,
} = useUnifiedMaskKeyframeControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

function previewMaskCenterChange(axis: 'centerX' | 'centerY', value: number) {
  setMaskCenterDeferred(
    axis === 'centerX' ? value : maskConfig.value.centerX,
    axis === 'centerY' ? value : maskConfig.value.centerY,
  )
}

async function commitMaskCenterChange(axis: 'centerX' | 'centerY', value: number) {
  previewMaskCenterChange(axis, value)
  await commitMaskCenterDeferredUpdate()
}

function previewRectangleMaskSizeChange(axis: 'width' | 'height', value: number) {
  setMaskRectangleSizeDeferred(
    axis === 'width' ? value : rectangleMaskConfig.value?.width ?? 0,
    axis === 'height' ? value : rectangleMaskConfig.value?.height ?? 0,
  )
}

async function commitRectangleMaskSizeChange(axis: 'width' | 'height', value: number) {
  previewRectangleMaskSizeChange(axis, value)
  await commitMaskRectangleSizeDeferredUpdate()
}

function previewEllipseMaskSizeChange(axis: 'ellipseWidth' | 'ellipseHeight', value: number) {
  setMaskEllipseSizeDeferred(
    axis === 'ellipseWidth' ? value : ellipseMaskConfig.value?.ellipseWidth ?? 0,
    axis === 'ellipseHeight' ? value : ellipseMaskConfig.value?.ellipseHeight ?? 0,
  )
}

async function commitEllipseMaskSizeChange(axis: 'ellipseWidth' | 'ellipseHeight', value: number) {
  previewEllipseMaskSizeChange(axis, value)
  await commitMaskEllipseSizeDeferredUpdate()
}

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
  flex: 1;
  min-width: 0;
}

.compact-boolean-control {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 30px;
}

</style>
