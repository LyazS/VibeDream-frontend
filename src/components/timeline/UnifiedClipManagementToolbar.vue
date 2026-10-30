<template>
  <!-- 工具栏 -->
  <div class="clip-management-toolbar">
    <!-- 历史管理工具栏 -->
    <div class="toolbar-section">
      <HoverButton
        @click="undo"
        :disabled="!unifiedStore.canUndo"
        :title="t('toolbar.history.undoTooltip')"
      >
        <template #icon>
          <component :is="IconComponents.UNDO" size="14px" />
        </template>
      </HoverButton>
      <HoverButton
        @click="redo"
        :disabled="!unifiedStore.canRedo"
        :title="t('toolbar.history.redoTooltip')"
      >
        <template #icon>
          <component :is="IconComponents.REDO" size="14px" />
        </template>
      </HoverButton>
    </div>

    <div v-if="timelineItems.length > 0" class="toolbar-section">
      <template v-if="unifiedStore.selectedClipTimelineItemId">
        <HoverButton
          :disabled="!canToggleMarker"
          @click="toggleSelectedClipMarker"
          :title="markerButtonTooltip"
        >
          <template #icon>
            <span
              class="marker-action-icon"
              :class="{ 'marker-action-icon--remove': hasMarkerAtPlayhead }"
            >
              <RiFlagFill size="14px" class="marker-action-icon__mark" aria-hidden="true" />
              <RiFlagOffLine size="14px" class="marker-action-icon__remove" aria-hidden="true" />
            </span>
          </template>
        </HoverButton>

        <n-dropdown
          placement="bottom-start"
          trigger="click"
          :disabled="isAIMarkerButtonDisabled"
          :options="aiMarkModeOptions"
          @select="handleAIMarkModeSelect"
        >
          <HoverButton :disabled="isAIMarkerButtonDisabled" :title="aiMarkerButtonTooltip">
            <template #icon>
              <component :is="IconComponents.MUSIC" size="14px" aria-hidden="true" />
            </template>
            <component :is="IconComponents.DROPDOWN" size="14px" aria-hidden="true" />
          </HoverButton>
        </n-dropdown>
      </template>
      <HoverButton
        v-if="unifiedStore.selectedClipTimelineItemId"
        :disabled="isSplitButtonDisabled"
        @click="splitSelectedClip"
        :title="t('toolbar.clip.splitTooltip')"
      >
        <template #icon>
          <component :is="IconComponents.SPLIT" size="14px" />
        </template>
      </HoverButton>
      <HoverButton
        v-if="deletableSelectionId"
        @click="deleteSelectedSelection"
        :title="deleteButtonTooltip"
      >
        <template #icon>
          <component :is="IconComponents.DELETE" size="14px" color="#ef4444" />
        </template>
      </HoverButton>
      <span v-if="overlappingCount > 0" class="overlap-warning">
        {{ t('toolbar.clip.overlapping', { count: overlappingCount }) }}
      </span>
    </div>

    <!-- 调试按钮放在最右边 -->
    <div class="toolbar-section debug-section">
      <!-- 缩放控制 -->
      <div class="toolbar-section zoom-section">
        <SliderInput
          :model-value="zoomSliderValue"
          @input="handleZoomChange"
          :min="0"
          :max="100"
          :step="0.1"
          slider-class="zoom-slider"
        />
      </div>

      <!-- 边界编辑模式切换 -->
      <HoverButton @click="toggleEdgeEditMode" :title="edgeEditModeTooltip">
        <template #icon>
          <component :is="edgeEditModeIcon" size="14px" />
        </template>
      </HoverButton>

      <!-- 吸附开关按钮 -->
      <HoverButton
        @click="toggleSnap"
        :active="snapEnabled"
        :title="snapEnabled ? t('toolbar.snap.enabledTooltip') : t('toolbar.snap.disabledTooltip')"
      >
        <template #icon>
          <component :is="getSnapIcon(snapEnabled)" size="14px" />
        </template>
      </HoverButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NDropdown, type DropdownOption } from 'naive-ui'
import { RiFlagFill, RiFlagOffLine } from '@remixicon/vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { useBeatMarkDetection } from '@/core/composables/useBeatMarkDetection'
import { useMusicStructureAnalysis } from '@/core/composables/useMusicStructureAnalysis'
import type { AIMarkMode } from '@/core/timelineitem/model/timelineItem'
import { DeleteTimelinePlaceholderCommand } from '@/core/modules/commands/DeleteTimelinePlaceholderCommand'
import {
  MUSIC_ANALYSIS_MAX_DURATION_SECONDS,
  MUSIC_ANALYSIS_MIN_DURATION_SECONDS,
  MUSIC_ANALYSIS_PIPELINE_VERSION,
} from '@/core/utils/music-analysis'
import { countOverlappingItems } from '@/core/utils/timeOverlapUtils'
import {
  getAIMarksStatus,
  getTimelineMarkerSourceFramesAtTimelineFrame,
} from '@/core/utils/timelineMarkerUtils'
import HoverButton from '@/components/base/HoverButton.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import { IconComponents, getSnapIcon } from '@/constants/iconComponents'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()
const { isDetectingBeatMarks, detectBeatMarks } = useBeatMarkDetection()
const { isAnalyzingMusicStructure, analyzeMusicStructure } = useMusicStructureAnalysis()

const timelineItems = computed(() => unifiedStore.timelineItems)

// 缩放级别相关
const zoomLevel = computed(() => unifiedStore.zoomLevel)
const minZoomLevel = computed(() => unifiedStore.minZoomLevel)
const maxZoomLevel = computed(() =>
  unifiedStore.getMaxZoomLevelForTimeline(unifiedStore.TimelineContentWidth),
)

// 非线性映射强度参数
// 值越大，非线性越强（小范围更精细）
// 值为 1 时为线性映射
// 值为 2-4 时为中等非线性
// 值为 5+ 时为强非线性
const zoomExponent = 4

// 将 zoomLevel 映射到滑块值 (0-100)，使用幂函数映射
const zoomSliderValue = computed(() => {
  const min = minZoomLevel.value
  const max = maxZoomLevel.value
  const current = zoomLevel.value

  // 使用幂函数映射：sliderValue = 100 * ((current / min - 1) / (max / min - 1))^(1/zoomExponent)
  if (max <= min) return 50
  const ratio = current / min
  const maxRatio = max / min
  const normalizedRatio = (ratio - 1) / (maxRatio - 1)
  return 100 * Math.pow(normalizedRatio, 1 / zoomExponent)
})

// 处理缩放变化，使用幂函数映射将滑块值转换为 zoomLevel
function handleZoomChange(sliderValue: number) {
  const min = minZoomLevel.value
  const max = maxZoomLevel.value

  // 使用幂函数映射：zoomLevel = min * (1 + (max / min - 1) * (sliderValue / 100)^zoomExponent)
  if (max <= min) return
  const maxRatio = max / min
  const normalizedValue = sliderValue / 100
  const ratio = 1 + (maxRatio - 1) * Math.pow(normalizedValue, zoomExponent)
  const newZoomLevel = min * ratio

  unifiedStore.setZoomLevel(newZoomLevel)
}

// 吸附功能状态
const snapEnabled = computed(() => unifiedStore.snapConfig.enabled)

const edgeEditModeTooltip = computed(() =>
  unifiedStore.timelineEdgeEditMode === 'trim'
    ? t('toolbar.edgeEdit.trimTooltip')
    : t('toolbar.edgeEdit.resizeTooltip'),
)

const edgeEditModeIcon = computed(() =>
  unifiedStore.timelineEdgeEditMode === 'trim' ? IconComponents.TRIM : IconComponents.RESIZE_WIDTH,
)

// 切换吸附功能
function toggleSnap() {
  unifiedStore.updateSnapConfig({ enabled: !snapEnabled.value })
  console.log(
    `🧲 ${t('toolbar.feedback.snapToggled', { status: snapEnabled.value ? '已关闭' : '已开启' })}`,
  )
}

function toggleEdgeEditMode() {
  unifiedStore.setTimelineEdgeEditMode(
    unifiedStore.timelineEdgeEditMode === 'trim' ? 'resize' : 'trim',
  )
}

// 计算重叠时间轴项目数量（只计算同轨道内的重叠）
const overlappingCount = computed(() => {
  // 使用统一的重叠检测工具
  return countOverlappingItems(unifiedStore.timelineItems)
})

// 检查选中的项目是否支持裁剪（视频和音频支持，图片和文本不支持）
const selectedItemSupportsSplit = computed(() => {
  if (!unifiedStore.selectedClipTimelineItemId) return false
  const item = unifiedStore.getTimelineItem(unifiedStore.selectedClipTimelineItemId)
  if (!item) return false

  // 视频和音频支持裁剪，图片和文本不支持
  return item.mediaType === 'video' || item.mediaType === 'audio'
})

const selectedTimelineItem = computed(() => {
  const selectedId = unifiedStore.selectedClipTimelineItemId
  return selectedId ? unifiedStore.getTimelineItem(selectedId) : undefined
})

const aiMarkModeOptions = computed<DropdownOption[]>(() => [
  { label: t('toolbar.clip.aiMarkerModes.none'), key: 'none' },
  { label: t('toolbar.clip.aiMarkerModes.beat1'), key: 'beat1' },
  { label: t('toolbar.clip.aiMarkerModes.beat1234'), key: 'beat1234' },
  { type: 'divider', key: 'music-structure-divider' },
  {
    label: t('toolbar.clip.musicStructureAnalysis'),
    key: 'music-structure',
    disabled: isMusicStructureMenuDisabled.value,
  },
])

const supportsAIMarkDetection = computed(() => {
  const mediaType = selectedTimelineItem.value?.mediaType
  return mediaType === 'video' || mediaType === 'audio'
})

const isAIMarkDetectionReady = computed(() => {
  const item = selectedTimelineItem.value
  if (!item || item.timelineStatus !== 'ready') return false

  return unifiedStore.getMediaItem(item.mediaItemId)?.mediaStatus === 'ready'
})

const isAIMarkerButtonDisabled = computed(
  () =>
    !supportsAIMarkDetection.value ||
    !isAIMarkDetectionReady.value ||
    isDetectingBeatMarks.value ||
    isAnalyzingMusicStructure.value,
)

const aiMarksStatus = computed(() => {
  const item = selectedTimelineItem.value
  return item ? getAIMarksStatus(item) : 'unsupported'
})

const selectedMusicAnalysis = computed(() => {
  const mediaItemId = selectedTimelineItem.value?.mediaItemId
  const analysis =
    typeof mediaItemId === 'string'
      ? unifiedStore.getMediaItem(mediaItemId)?.metadata?.musicAnalysis
      : undefined
  return analysis?.pipelineVersion === MUSIC_ANALYSIS_PIPELINE_VERSION ? analysis : undefined
})

const supportsMusicStructureOverlay = computed(
  () => selectedTimelineItem.value?.mediaType === 'audio',
)

const canStartMusicStructureAnalysis = computed(() => {
  const item = selectedTimelineItem.value
  if (!item || item.timelineStatus !== 'ready' || item.mediaType !== 'audio') return false

  const mediaItem = unifiedStore.getMediaItem(item.mediaItemId)
  const bunnyMedia = mediaItem?.runtime.bunny?.bunnyMedia
  const duration = bunnyMedia?.duration
  return (
    mediaItem?.mediaStatus === 'ready' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration >= MUSIC_ANALYSIS_MIN_DURATION_SECONDS &&
    duration <= MUSIC_ANALYSIS_MAX_DURATION_SECONDS &&
    Boolean(bunnyMedia?.getAudioTrackInfo())
  )
})

const isMusicStructureMenuDisabled = computed(
  () =>
    !supportsMusicStructureOverlay.value ||
    (!selectedMusicAnalysis.value && !canStartMusicStructureAnalysis.value),
)

const aiMarkerButtonTooltip = computed(() =>
  !supportsAIMarkDetection.value
    ? t('toolbar.clip.aiMarkerUnsupportedTooltip')
    : !isAIMarkDetectionReady.value
      ? t('toolbar.clip.aiMarkerUnavailableTooltip')
      : aiMarksStatus.value === 'available'
        ? t('toolbar.clip.aiMarkerTooltip')
        : t('toolbar.clip.aiMarkerDetectTooltip'),
)

function isAIMarkMode(value: string | number): value is AIMarkMode {
  return value === 'none' || value === 'beat1' || value === 'beat1234'
}

async function handleAIMarkModeSelect(value: string | number) {
  if (value === 'music-structure') {
    await toggleSelectedClipMusicStructure()
    return
  }

  const selectedId = unifiedStore.selectedClipTimelineItemId
  if (!selectedId || !isAIMarkMode(value)) return

  if (value === 'none') {
    await unifiedStore.setTimelineAnchorSourceWithHistory(selectedId, 'none')
    return
  }

  if (aiMarksStatus.value === 'available') {
    await unifiedStore.setAIMarksModeWithHistory(selectedId, value)
    await unifiedStore.setTimelineAnchorSourceWithHistory(selectedId, 'beat-this')
    return
  }

  if (aiMarksStatus.value !== 'unsupported') {
    await detectBeatMarks(selectedId, value)
  }
}

async function toggleSelectedClipMusicStructure(): Promise<void> {
  const timelineItem = selectedTimelineItem.value
  if (!timelineItem || typeof timelineItem.mediaItemId !== 'string') return
  if (isMusicStructureMenuDisabled.value) return
  const analysis =
    selectedMusicAnalysis.value ?? (await analyzeMusicStructure(timelineItem.mediaItemId))
  if (!analysis) return

  const currentTimelineItem = unifiedStore.getTimelineItem(timelineItem.id)
  if (!currentTimelineItem || currentTimelineItem.mediaItemId !== timelineItem.mediaItemId) return

  await unifiedStore.setTimelineAnchorSourceWithHistory(timelineItem.id, 'music-structure')
  await unifiedStore.setMusicStructureOverlayVisibleWithHistory(timelineItem.id, true)
}

const markerOffsetAtPlayhead = computed(() => {
  const item = selectedTimelineItem.value
  if (!item) return null

  const currentFrame = unifiedStore.currentFrame
  if (
    currentFrame < item.timeRange.timelineStartTime ||
    currentFrame >= item.timeRange.timelineEndTime
  ) {
    return null
  }
  return currentFrame - item.timeRange.timelineStartTime
})

const canToggleMarker = computed(() => markerOffsetAtPlayhead.value !== null)

const hasMarkerAtPlayhead = computed(() => {
  const item = selectedTimelineItem.value
  const markerOffset = markerOffsetAtPlayhead.value
  return Boolean(
    item &&
      markerOffset !== null &&
      getTimelineMarkerSourceFramesAtTimelineFrame(item, unifiedStore.currentFrame).length > 0,
  )
})

const markerButtonTooltip = computed(() => {
  if (!canToggleMarker.value) {
    return t('toolbar.clip.markerOutOfRangeTooltip')
  }
  return hasMarkerAtPlayhead.value ? t('toolbar.clip.unmarkTooltip') : undefined
})

async function toggleSelectedClipMarker() {
  const selectedId = unifiedStore.selectedClipTimelineItemId
  if (!selectedId || !canToggleMarker.value) return

  await unifiedStore.toggleTimelineItemMarkerWithHistory(selectedId, unifiedStore.currentFrame)
}

// 检查选中的项目是否处于ready状态
const isSelectedItemReady = computed(() => {
  if (!unifiedStore.selectedClipTimelineItemId) return false
  const item = unifiedStore.getTimelineItem(unifiedStore.selectedClipTimelineItemId)
  if (!item) return false

  const mediaItem = unifiedStore.getMediaItem(item.mediaItemId)
  if (!mediaItem) return false

  // 只有ready状态的媒体项才能进行裁剪
  return mediaItem.mediaStatus === 'ready'
})

// 裁剪按钮是否禁用
const isSplitButtonDisabled = computed(() => {
  return !selectedItemSupportsSplit.value || !isSelectedItemReady.value
})

const selectedTransitionSourceItemId = computed(() => unifiedStore.selectedTransitionSourceItemId)

const deletableSelectionId = computed(() => {
  return unifiedStore.selectedClipTimelineItemId || selectedTransitionSourceItemId.value || null
})

const deleteButtonTooltip = computed(() => {
  return selectedTransitionSourceItemId.value
    ? t('toolbar.clip.deleteTooltip')
    : t('toolbar.clip.deleteTooltip')
})

async function splitSelectedClip() {
  if (unifiedStore.selectedClipTimelineItemId) {
    const item = unifiedStore.getTimelineItem(unifiedStore.selectedClipTimelineItemId)
    const mediaItem = item ? unifiedStore.getMediaItem(item.mediaItemId) : null
    console.log(
      `🔪 开始裁剪时间轴项目: ${mediaItem?.name || '未知'} (ID: ${unifiedStore.selectedClipTimelineItemId})`,
    )
    console.log(
      `📍 裁剪时间位置: ${unifiedStore.currentFrame}帧 (${unifiedStore.formattedCurrentTime})`,
    )

    // 使用带历史记录的分割方法（传入帧数数组）
    await unifiedStore.splitTimelineItemAtTimeWithHistory(unifiedStore.selectedClipTimelineItemId, [
      unifiedStore.currentFrame,
    ])
    console.log('✅ 时间轴项目分割成功')
  }
}

async function deleteSelectedSelection() {
  if (selectedTransitionSourceItemId.value) {
    await unifiedStore.updateTransitionConfigWithHistory(
      selectedTransitionSourceItemId.value,
      undefined,
    )
    console.log('✅ 转场删除成功')
    return
  }

  if (unifiedStore.selectedClipTimelineItemId) {
    const item = unifiedStore.getTimelineItem(unifiedStore.selectedClipTimelineItemId)
    const mediaItem = item ? unifiedStore.getMediaItem(item.mediaItemId) : null
    console.log(
      `🗑️ 删除时间轴项目: ${mediaItem?.name || '未知'} (ID: ${unifiedStore.selectedClipTimelineItemId})`,
    )

    if (item?.timelinePlaceholder) {
      const command = new DeleteTimelinePlaceholderCommand(item, {
        getTimelineItem: unifiedStore.getTimelineItem,
        addTimelineItem: unifiedStore.addTimelineItem,
        removeTimelineItem: unifiedStore.removeTimelineItem,
        onRestore: (restored) => unifiedStore.restoreMediaAsrPlaceholder(restored.id),
      })
      const batch = unifiedStore.startBatch(command.historyLabel)
      batch.addCommand(command)
      await unifiedStore.executeBatchCommand(batch.build())
    } else {
      await unifiedStore.removeTimelineItemWithHistory(unifiedStore.selectedClipTimelineItemId)
    }
    console.log('✅ 时间轴项目删除成功')
  }
}

// ==================== 历史管理方法 ====================

/**
 * 撤销上一个操作
 */
async function undo() {
  try {
    const success = await unifiedStore.undo()
    if (success) {
      console.log('↩️', t('toolbar.debug.undoSuccess'))
    } else {
      console.log('⚠️', t('toolbar.debug.undoFailed'))
    }
  } catch (error) {
    console.error('❌ 撤销操作失败:', error)
  }
}

/**
 * 重做下一个操作
 */
async function redo() {
  try {
    const success = await unifiedStore.redo()
    if (success) {
      console.log('↪️', t('toolbar.debug.redoSuccess'))
    } else {
      console.log('⚠️', t('toolbar.debug.redoFailed'))
    }
  } catch (error) {
    console.error('❌ 重做操作失败:', error)
  }
}
</script>

<style scoped>
.clip-management-toolbar {
  background-color: var(--color-bg-secondary);
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
  border-radius: 4px 4px 0 0;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-section {
  display: flex;
  align-items: center;
}

.debug-section {
  margin-left: auto;
}

.toolbar-label {
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
}

.toolbar-btn {
  background-color: #555;
  color: #ccc;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background-color 0.2s;
}

.toolbar-btn:hover {
  background-color: #666;
  color: white;
}

.toolbar-btn.debug-btn {
  background-color: #6c757d;
  border: 1px dashed #adb5bd;
}

.toolbar-btn.debug-btn:hover {
  background-color: #5a6268;
  border-color: #6c757d;
}

.toolbar-btn.split-btn {
  background-color: #555;
  color: #ccc;
}

.toolbar-btn.split-btn:hover {
  background-color: #666;
  color: white;
}

.toolbar-btn.delete-btn {
  background-color: #dc3545;
  color: white;
}

.toolbar-btn.delete-btn:hover {
  background-color: #c82333;
  color: white;
}

.toolbar-btn.undo-btn {
  background-color: #555;
  color: #ccc;
}

.toolbar-btn.undo-btn:hover {
  background-color: #666;
  color: white;
}

.toolbar-btn.redo-btn {
  background-color: #555;
  color: #ccc;
}

.toolbar-btn.redo-btn:hover {
  background-color: #666;
  color: white;
}

.toolbar-btn:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}

.toolbar-btn:disabled:hover {
  background-color: #6c757d;
}

.toolbar-btn svg {
  width: 14px;
  height: 14px;
}

.marker-action-icon {
  position: relative;
  width: 14px;
  height: 14px;
  display: inline-flex;
  flex: 0 0 14px;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.marker-action-icon__mark,
.marker-action-icon__remove {
  transition-property: opacity, transform, filter;
  transition-duration: 150ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.marker-action-icon__remove {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(0.25);
  filter: blur(4px);
}

.marker-action-icon--remove .marker-action-icon__mark {
  opacity: 0;
  transform: scale(0.25);
  filter: blur(4px);
}

.marker-action-icon--remove .marker-action-icon__remove {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.overlap-warning {
  color: #ff6b6b;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.split-hint {
  color: #ffd700;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
