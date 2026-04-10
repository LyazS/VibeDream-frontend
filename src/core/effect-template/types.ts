import type { EffectType } from '@/core/asset/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import type { MediaItemDragData, DropResult } from '@/core/types/drag'

export interface EffectTemplatePreviewData {
  kind: 'clip-tail'
  startFrame: number
  durationFrames: number
  seamFrame: number
  label: string
}

export interface EffectTemplateResolveContext {
  dragData: MediaItemDragData
  targetTrack: UnifiedTrackData
  trackItems: UnifiedTimelineItemData<MediaType>[]
  hoveredFrame: number
  thresholdFrames: number
}

export interface EffectTemplateDropCandidate {
  canDrop: boolean
  snappedFrame: number | null
  preview: EffectTemplatePreviewData | null
  invalidReason?: string
}

export interface EffectTemplateApplyContext<TCandidate extends EffectTemplateDropCandidate> {
  dragData: MediaItemDragData
  targetTrack: UnifiedTrackData
  candidate: TCandidate
}

export interface EffectTemplateHandler<TCandidate extends EffectTemplateDropCandidate = EffectTemplateDropCandidate> {
  readonly effectType: EffectType
  resolveDropCandidate(context: EffectTemplateResolveContext): TCandidate
  applyTemplate(context: EffectTemplateApplyContext<TCandidate>): Promise<DropResult>
}
