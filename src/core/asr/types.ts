import type {
  AsrMetadata,
  AsrRange,
  AsrSegment,
  AsrTaskRecord,
  UnifiedMediaItemData,
} from '@/core/mediaitem/types'
import type { TimelinePlaceholder } from '@/core/timelineitem/model/timelineItem'

export type { AsrMetadata, AsrRange, AsrSegment, AsrTaskRecord }

export interface AsrPlaceholderPayload {
  sourceMediaId: string
  sourceTimelineItemId: string
  requestedRange: AsrRange
  recognitionRange: AsrRange
  taskId?: string
}

export type AsrTimelinePlaceholder = TimelinePlaceholder<AsrPlaceholderPayload> & {
  kind: 'asr'
}

export interface MediaAsrTaskInput {
  media_id: string
  media_version: string
  media_kind: 'audio' | 'video'
  audio_url: string
  recognition_range: AsrRange
  requested_range?: AsrRange
  language?: string
  expires_at: string
}

export interface MediaAsrTask {
  task_id: string
  type: 'media.asr'
  project_id: string
  status:
    | 'pending'
    | 'processing'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'input_expired'
  revision: number
  progress?: number
  progress_message?: string
  error?: string
  message?: string
}

export interface MediaAsrRawResult {
  text?: string
  recognition_range?: AsrRange
  segments?: AsrSegment[]
  words?: Array<{ start_ms: number; end_ms: number; text: string }>
  raw_result?: unknown
  media_id?: string
  media_version?: string
}

export interface AsrModule {
  getMediaItem(mediaId: string): UnifiedMediaItemData | undefined
  getProjectId(): string
  ensureMediaReady(mediaId: string): Promise<unknown>
}

export interface MediaAsrInput {
  mediaId: string
  timelineItemId: string
  requestedRange: AsrRange
  recognitionRange: AsrRange
  language?: string
}

export interface MediaAsrResult {
  mediaId: string
  taskId?: string
  recognitionRange: AsrRange
  segments: AsrSegment[]
  fromCache: boolean
}
