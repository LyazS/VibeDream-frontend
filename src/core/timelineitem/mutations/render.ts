import type { MediaType } from '@/core/mediaitem'
import type {
  AudioProps,
  TextProps,
  UnifiedTimelineItemData,
  VisualProps,
} from '@/core/timelineitem/model/timelineItem'
import {
  getBaseAudioConfig,
  getBaseTextConfig,
  getBaseVisualConfig,
} from '@/core/timelineitem/queries/render'

export function patchBaseVisualConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: Partial<VisualProps>,
): void {
  const visualConfig = getBaseVisualConfig(item)
  if (!visualConfig) return
  Object.assign(visualConfig, patch)
}

export function patchBaseAudioConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: Partial<AudioProps>,
): void {
  const audioConfig = getBaseAudioConfig(item)
  if (!audioConfig) return
  Object.assign(audioConfig, patch)
}

export function patchBaseTextConfig(
  item: UnifiedTimelineItemData<MediaType>,
  patch: Partial<TextProps>,
): void {
  const textConfig = getBaseTextConfig(item)
  if (!textConfig) return
  Object.assign(textConfig, patch)
}
