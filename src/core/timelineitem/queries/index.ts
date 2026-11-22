export * from './guards'
export * from './status'
export * from './render'

import {
  isVideoTimelineItem,
  isImageTimelineItem,
  isAudioTimelineItem,
  hasTimelinePlaceholder,
  hasVisualProperties,
  hasAudioProperties,
} from './guards'
import {
  isReady,
  isLoading,
  hasError,
  canEdit,
  getStatusText,
  getProgressInfo,
  getErrorInfo,
} from './status'
import {
  getBaseRenderConfig,
  getBaseVisualConfig,
  getBaseAudioConfig,
  getMergedRenderConfig,
  getResolvedRenderConfig,
} from './render'

export const TimelineItemQueries = {
  isVideoTimelineItem,
  isImageTimelineItem,
  isAudioTimelineItem,
  hasTimelinePlaceholder,
  hasVisualProperties,
  hasAudioProperties,
  isReady,
  isLoading,
  hasError,
  canEdit,
  getStatusText,
  getProgressInfo,
  getErrorInfo,
  getBaseRenderConfig,
  getBaseVisualConfig,
  getBaseAudioConfig,
  getMergedRenderConfig,
  getResolvedRenderConfig,
}
