<template>
  <div
    :class="overlayClasses"
    :style="overlayStyles"
    :data-transition-source-id="overlay.sourceItemId"
    :data-timeline-selection-id="overlay.selectionId"
    :data-transition-binding-state="overlay.bindingState"
    @click.stop="handleSelect"
    @contextmenu.stop.prevent="handleContextMenu"
  >
    <div class="timeline-transition-overlay__label">
      {{ overlay.preset }}
    </div>
    <div class="clip-content timeline-transition-overlay__content">
      <div class="timeline-transition-overlay__stripe"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { DEFAULT_TRACK_PADDING } from '@/constants/TrackConstants'
import { THUMBNAIL_CONSTANTS } from '@/constants/ThumbnailConstants'
import type { TimelineTransitionOverlayViewModel } from '@/core/timelineitem/transitionOverlay'

interface Props {
  overlay: TimelineTransitionOverlayViewModel
  timelineWidth: number
  trackHeight: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [event: MouseEvent, selectionId: string]
  contextMenu: [event: MouseEvent, sourceItemId: string]
}>()

const unifiedStore = useUnifiedStore()

const overlayClasses = computed(() => [
  'unified-timeline-clip',
  'unified-timeline-transition-overlay',
  {
    selected: unifiedStore.isTimelineSelectionSelected(props.overlay.selectionId),
  },
])

const overlayStyles = computed(() => {
  const left = unifiedStore.frameToPixel(props.overlay.displayStartFrame, props.timelineWidth)
  const right = unifiedStore.frameToPixel(props.overlay.displayEndFrame, props.timelineWidth)
  const overlayHeight = THUMBNAIL_CONSTANTS.HEIGHT
  const clipHeight = Math.max(props.trackHeight - DEFAULT_TRACK_PADDING * 2, 0)
  // Match VideoContent's actual vertical layout:
  // 1. center the thumbnail strip inside the clip body
  // 2. apply the additional thumbnail top offset
  const thumbnailTopInTrack = Math.max(
    DEFAULT_TRACK_PADDING +
      (clipHeight - overlayHeight) / 2 +
      THUMBNAIL_CONSTANTS.TOP_OFFSET,
    0,
  )

  return {
    height: `${overlayHeight}px`,
    top: `${thumbnailTopInTrack}px`,
    left: `${left}px`,
    width: `${Math.max(right - left, 20)}px`,
  }
})

function handleSelect(event: MouseEvent) {
  emit('select', event, props.overlay.selectionId)
}

function handleContextMenu(event: MouseEvent) {
  emit('contextMenu', event, props.overlay.sourceItemId)
}
</script>

<style scoped>
.timeline-transition-overlay__label {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: white;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-transition-overlay__content {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  opacity: 0.95;
}

.timeline-transition-overlay__stripe {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03)),
    repeating-linear-gradient(
      120deg,
      rgba(255, 255, 255, 0.3) 0px,
      rgba(255, 255, 255, 0.3) 1px,
      rgba(255, 255, 255, 0.1) 1px,
      rgba(255, 255, 255, 0.1) 2px
    );
}
</style>
