import { isRecord } from '@/utils/typeGuards'
import type { FileData } from './types'

export function isFileData(value: unknown): value is FileData {
  if (!isRecord(value)) return false
  return (
    value.__type__ === 'FileData' &&
    typeof value.name === 'string' &&
    (value.mediaType === 'video' || value.mediaType === 'image' || value.mediaType === 'audio') &&
    (value.source === 'media-item' || value.source === 'timeline-item') &&
    (value.mediaItemId === undefined || typeof value.mediaItemId === 'string') &&
    (value.timelineItemId === undefined || typeof value.timelineItemId === 'string') &&
    (value.duration === undefined || typeof value.duration === 'number') &&
    (value.resolution === undefined ||
      (isRecord(value.resolution) &&
        typeof value.resolution.width === 'number' &&
        typeof value.resolution.height === 'number')) &&
    (value.timeRange === undefined ||
      (isRecord(value.timeRange) &&
        typeof value.timeRange.clipStartTime === 'number' &&
        typeof value.timeRange.clipEndTime === 'number' &&
        typeof value.timeRange.timelineStartTime === 'number' &&
        typeof value.timeRange.timelineEndTime === 'number'))
  )
}
