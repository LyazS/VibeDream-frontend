export type TimelineSelectionKind = 'clip' | 'transition'

export type TimelineSelectionId = `clip:${string}` | `transition:${string}`

export interface ParsedTimelineSelectionId {
  kind: TimelineSelectionKind
  sourceId: string
}

export function buildClipSelectionId(timelineItemId: string): TimelineSelectionId {
  return `clip:${timelineItemId}`
}

export function buildTransitionSelectionId(sourceTimelineItemId: string): TimelineSelectionId {
  return `transition:${sourceTimelineItemId}`
}

export function parseTimelineSelectionId(
  selectionId: string | null | undefined,
): ParsedTimelineSelectionId | null {
  if (!selectionId) {
    return null
  }

  if (selectionId.startsWith('clip:')) {
    return {
      kind: 'clip',
      sourceId: selectionId.slice('clip:'.length),
    }
  }

  if (selectionId.startsWith('transition:')) {
    return {
      kind: 'transition',
      sourceId: selectionId.slice('transition:'.length),
    }
  }

  return null
}

export function isClipSelectionId(selectionId: string | null | undefined): selectionId is `clip:${string}` {
  return selectionId?.startsWith('clip:') ?? false
}

export function isTransitionSelectionId(
  selectionId: string | null | undefined,
): selectionId is `transition:${string}` {
  return selectionId?.startsWith('transition:') ?? false
}
