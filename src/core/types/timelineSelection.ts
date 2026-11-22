export type TimelineSelectionKind = 'clip'
export type TimelineSelectionId = `clip:${string}`

export interface ParsedTimelineSelectionId {
  kind: TimelineSelectionKind
  sourceId: string
}

export function buildClipSelectionId(timelineItemId: string): TimelineSelectionId {
  return `clip:${timelineItemId}`
}

export function parseTimelineSelectionId(
  selectionId: string | null | undefined,
): ParsedTimelineSelectionId | null {
  if (!selectionId || !selectionId.startsWith('clip:')) {
    return null
  }

  return {
    kind: 'clip',
    sourceId: selectionId.slice('clip:'.length),
  }
}

export function isClipSelectionId(
  selectionId: string | null | undefined,
): selectionId is `clip:${string}` {
  return selectionId?.startsWith('clip:') ?? false
}
