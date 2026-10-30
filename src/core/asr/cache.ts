import type { AsrMetadata, AsrRange, AsrSegment } from './types'

export const ASR_CONTEXT_PADDING_MS = 2_000

export function normalizeRange(range: AsrRange): AsrRange {
  const start = Math.max(0, Math.floor(range.start_ms))
  const end = Math.max(start + 1, Math.ceil(range.end_ms))
  return { start_ms: start, end_ms: end }
}

export function expandAsrRange(requestedRange: AsrRange, durationMs: number): AsrRange {
  const normalized = normalizeRange(requestedRange)
  const boundedDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : normalized.end_ms
  return {
    start_ms: Math.max(0, normalized.start_ms - ASR_CONTEXT_PADDING_MS),
    end_ms: Math.max(normalized.start_ms + 1, Math.min(normalized.end_ms + ASR_CONTEXT_PADDING_MS, boundedDuration)),
  }
}

export function rangeContains(outer: AsrRange, inner: AsrRange): boolean {
  return outer.start_ms <= inner.start_ms && outer.end_ms >= inner.end_ms
}

export function mergeRanges(ranges: AsrRange[]): AsrRange[] {
  const sorted = ranges.map(normalizeRange).sort((a, b) => a.start_ms - b.start_ms)
  const merged: AsrRange[] = []
  for (const range of sorted) {
    const current = merged[merged.length - 1]
    if (!current || range.start_ms > current.end_ms) merged.push({ ...range })
    else current.end_ms = Math.max(current.end_ms, range.end_ms)
  }
  return merged
}

export function isRangeCovered(metadata: AsrMetadata | undefined, range: AsrRange): boolean {
  return metadata?.completedRanges.some((completed) => rangeContains(completed, range)) ?? false
}

export function mergeAsrResult(
  current: AsrMetadata | undefined,
  range: AsrRange,
  segments: AsrSegment[],
): AsrMetadata {
  const normalized = normalizeRange(range)
  const kept = (current?.segments ?? []).filter(
    (segment) => segment.end_ms <= normalized.start_ms || segment.start_ms >= normalized.end_ms,
  )
  const nextSegments = [...kept, ...segments]
    .map((segment) => ({ ...segment, start_ms: Math.max(segment.start_ms, normalized.start_ms) }))
    .filter((segment) => segment.end_ms > segment.start_ms && segment.text.trim())
    .sort((a, b) => a.start_ms - b.start_ms)
  return {
    completedRanges: mergeRanges([...(current?.completedRanges ?? []), normalized]),
    segments: nextSegments,
    tasks: current?.tasks ?? [],
  }
}

export function segmentsForRange(segments: AsrSegment[], requestedRange: AsrRange): AsrSegment[] {
  return segments
    .filter((segment) => segment.end_ms > requestedRange.start_ms && segment.start_ms < requestedRange.end_ms)
    .map((segment) => ({
      ...segment,
      start_ms: Math.max(segment.start_ms, requestedRange.start_ms),
      end_ms: Math.min(segment.end_ms, requestedRange.end_ms),
    }))
    .filter((segment) => segment.end_ms > segment.start_ms)
}

