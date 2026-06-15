import { cloneDeep, isEqual } from 'lodash'
import type { TimelineJsonBundle } from './types'

export interface AgentApplyPayload {
  baseTimeline: TimelineJsonBundle
  targetTimeline: TimelineJsonBundle
  warnings?: unknown[]
}

export interface TimelineApplyDryRunResult {
  summary: string
  changes: string[]
  conflicts: string[]
  mergedTimeline?: CanonicalTimelineBundle
  mergedSummary?: TimelineApplyMergedSummary
  warnings: unknown[]
}

type TimelineEntity = Record<string, unknown> & { id: string }

export interface CanonicalTimelineBundle {
  projectId: string
  tracks: TimelineEntity[]
  timelineItems: TimelineEntity[]
}

export interface TimelineApplyMergedSummary {
  tracks: Array<{
    id: string
    type: unknown
    name: unknown
  }>
  timelineItems: Array<{
    id: string
    trackId: unknown
    mediaType: unknown
    startFrame: unknown
    endFrame: unknown
  }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function normalizeTrack(track: unknown): TimelineEntity {
  const record = asRecord(track)
  return {
    id: String(record.id ?? ''),
    type: record.type,
    name: record.name ?? '',
    visible: record.visible ?? record.isVisible ?? true,
    muted: record.muted ?? record.isMuted ?? false,
  }
}

function normalizeTransform(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const transform = asRecord(item.transform)
  const config = asRecord(item.config)
  const source = Object.keys(transform).length > 0 ? transform : config
  const normalized = {
    x: optionalNumber(source.x) ?? 0,
    y: optionalNumber(source.y) ?? 0,
    width: optionalNumber(source.width) ?? 1920,
    height: optionalNumber(source.height) ?? 1080,
    rotation: optionalNumber(source.rotation) ?? 0,
    opacity: optionalNumber(source.opacity) ?? 1,
  }
  const hasVisualFields = ['x', 'y', 'width', 'height', 'rotation', 'opacity'].some(
    (key) => source[key] !== undefined,
  )
  return hasVisualFields ? normalized : undefined
}

function normalizeText(item: Record<string, unknown>): Record<string, unknown> | string | undefined {
  if (item.text !== undefined) return item.text as Record<string, unknown> | string
  if (item.mediaType !== 'text') return undefined

  const config = asRecord(item.config)
  if (config.text === undefined && config.fontSize === undefined && config.color === undefined) {
    return undefined
  }
  return {
    content: config.text ?? '',
    fontSize: config.fontSize ?? 48,
    color: config.color ?? '#ffffff',
  }
}

function normalizeTimelineItem(item: unknown): TimelineEntity {
  const record = asRecord(item)
  const timeRange = asRecord(record.timeRange)
  const normalized: TimelineEntity = {
    id: String(record.id ?? ''),
    trackId: record.trackId,
    mediaType: record.mediaType,
    mediaItemId: optionalString(record.mediaItemId),
    startFrame: record.startFrame ?? timeRange.timelineStartTime,
    endFrame: record.endFrame ?? timeRange.timelineEndTime,
    clipStartFrame: record.clipStartFrame ?? timeRange.clipStartTime,
    clipEndFrame: record.clipEndFrame ?? timeRange.clipEndTime,
  }
  const transform = normalizeTransform(record)
  if (transform) normalized.transform = transform
  const text = normalizeText(record)
  if (text !== undefined) normalized.text = text
  return normalized
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(sortForJson(value))
  } catch {
    return String(value)
  }
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForJson(entry)]),
  )
}

function flattenKeys(value: unknown, prefix = '', output: Record<string, true> = {}): Record<string, true> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) output[prefix] = true
    return output
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    flattenKeys((value as Record<string, unknown>)[key], path, output)
  }
  return output
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function setValueAtPath(target: TimelineEntity, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor: Record<string, unknown> = target
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  const finalKey = parts[parts.length - 1]
  if (value === undefined) {
    delete cursor[finalKey]
  } else {
    cursor[finalKey] = cloneDeep(value)
  }
}

function byId(items: TimelineEntity[]): Map<string, TimelineEntity> {
  return new Map(items.map((item) => [item.id, item]))
}

function describeValue(value: unknown): string {
  const text = stableStringify(value)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function mergeEntityFields(params: {
  label: string
  id: string
  base: TimelineEntity
  current: TimelineEntity
  target: TimelineEntity
  changes: string[]
  conflicts: string[]
}): TimelineEntity | null {
  const { label, id, base, current, target, changes, conflicts } = params
  const merged = cloneDeep(current)
  const keys = {
    ...flattenKeys(base),
    ...flattenKeys(current),
    ...flattenKeys(target),
  }

  for (const path of Object.keys(keys).sort()) {
    if (path === 'id' || path.startsWith('runtime')) continue
    const baseValue = valueAtPath(base, path)
    const currentValue = valueAtPath(current, path)
    const targetValue = valueAtPath(target, path)
    const agentChanged = !isEqual(baseValue, targetValue)
    const userChanged = !isEqual(baseValue, currentValue)

    if (!agentChanged) continue

    if (!userChanged || isEqual(currentValue, targetValue)) {
      setValueAtPath(merged, path, targetValue)
      changes.push(`${label} ${id}: ${path} ${describeValue(baseValue)} -> ${describeValue(targetValue)}`)
      continue
    }

    conflicts.push(
      `${label} ${id}: ${path} conflict, base=${describeValue(baseValue)}, current=${describeValue(currentValue)}, target=${describeValue(targetValue)}`,
    )
  }

  return merged
}

function mergeEntityCollection(params: {
  label: string
  baseItems: TimelineEntity[]
  currentItems: TimelineEntity[]
  targetItems: TimelineEntity[]
  changes: string[]
  conflicts: string[]
}): Map<string, TimelineEntity> {
  const { label, baseItems, currentItems, targetItems, changes, conflicts } = params
  const baseById = byId(baseItems)
  const currentById = byId(currentItems)
  const targetById = byId(targetItems)
  const mergedById = new Map<string, TimelineEntity>()
  const ids = new Set([...baseById.keys(), ...currentById.keys(), ...targetById.keys()])

  for (const id of [...ids].sort()) {
    const base = baseById.get(id)
    const current = currentById.get(id)
    const target = targetById.get(id)

    if (!base && target && !current) {
      mergedById.set(id, cloneDeep(target))
      changes.push(`${label} ${id}: agent added`)
      continue
    }
    if (!base && !target && current) {
      mergedById.set(id, cloneDeep(current))
      continue
    }
    if (!base && target && current) {
      if (isEqual(current, target)) {
        mergedById.set(id, cloneDeep(current))
      } else {
        conflicts.push(`${label} ${id}: both added same id differently`)
      }
      continue
    }
    if (base && !target && !current) {
      continue
    }
    if (base && !target && current) {
      if (isEqual(base, current)) {
        changes.push(`${label} ${id}: agent deleted`)
      } else {
        conflicts.push(`${label} ${id}: agent deleted but current timeline modified it`)
        mergedById.set(id, cloneDeep(current))
      }
      continue
    }
    if (base && target && !current) {
      if (isEqual(base, target)) {
        continue
      }
      conflicts.push(`${label} ${id}: current timeline deleted it but agent modified it`)
      continue
    }
    if (base && current && target) {
      const merged = mergeEntityFields({ label, id, base, current, target, changes, conflicts })
      if (merged) mergedById.set(id, merged)
    }
  }

  return mergedById
}

function mergeOrder(params: {
  label: string
  baseOrder: string[]
  currentOrder: string[]
  targetOrder: string[]
  availableIds: Set<string>
  changes: string[]
  conflicts: string[]
}): string[] {
  const { label, baseOrder, currentOrder, targetOrder, availableIds, changes, conflicts } = params
  const agentChanged = !isEqual(baseOrder, targetOrder)
  const userChanged = !isEqual(baseOrder, currentOrder)
  let mergedOrder: string[]

  if (!agentChanged) {
    mergedOrder = currentOrder
  } else if (!userChanged || isEqual(currentOrder, targetOrder)) {
    mergedOrder = targetOrder
    changes.push(`${label}: order ${baseOrder.join(',')} -> ${targetOrder.join(',')}`)
  } else {
    mergedOrder = currentOrder
    conflicts.push(
      `${label}: order conflict, base=${baseOrder.join(',')}, current=${currentOrder.join(',')}, target=${targetOrder.join(',')}`,
    )
  }

  const result = mergedOrder.filter((id) => availableIds.has(id))
  for (const id of [...availableIds].sort()) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

function itemOrderByTrack(timeline: TimelineJsonBundle): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const item of timeline.timelineItems) {
    const order = result.get(item.trackId) ?? []
    order.push(item.id)
    result.set(item.trackId, order)
  }
  return result
}

function itemOrderByTrackFromItems(items: TimelineEntity[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const item of items) {
    const trackId = String(item.trackId ?? '')
    const order = result.get(trackId) ?? []
    order.push(item.id)
    result.set(trackId, order)
  }
  return result
}

function summarizeMergedTimeline(timeline: CanonicalTimelineBundle): TimelineApplyMergedSummary {
  return {
    tracks: timeline.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      name: track.name,
    })),
    timelineItems: timeline.timelineItems.map((item) => ({
      id: item.id,
      trackId: item.trackId,
      mediaType: item.mediaType,
      startFrame: item.startFrame,
      endFrame: item.endFrame,
    })),
  }
}

export function dryRunTimelineApplyPayload(
  payload: AgentApplyPayload,
  currentTimeline: TimelineJsonBundle,
): TimelineApplyDryRunResult {
  const changes: string[] = []
  const conflicts: string[] = []
  const { baseTimeline, targetTimeline } = payload
  const baseTracks = baseTimeline.tracks.map(normalizeTrack)
  const currentTracks = currentTimeline.tracks.map(normalizeTrack)
  const targetTracks = targetTimeline.tracks.map(normalizeTrack)
  const baseItems = baseTimeline.timelineItems.map(normalizeTimelineItem)
  const currentItems = currentTimeline.timelineItems.map(normalizeTimelineItem)
  const targetItems = targetTimeline.timelineItems.map(normalizeTimelineItem)

  const mergedTrackById = mergeEntityCollection({
    label: 'track',
    baseItems: baseTracks,
    currentItems: currentTracks,
    targetItems: targetTracks,
    changes,
    conflicts,
  })
  const mergedItemById = mergeEntityCollection({
    label: 'item',
    baseItems,
    currentItems,
    targetItems,
    changes,
    conflicts,
  })

  const mergedTrackOrder = mergeOrder({
    label: 'tracks',
    baseOrder: baseTimeline.tracks.map((track) => track.id),
    currentOrder: currentTimeline.tracks.map((track) => track.id),
    targetOrder: targetTimeline.tracks.map((track) => track.id),
    availableIds: new Set(mergedTrackById.keys()),
    changes,
    conflicts,
  })

  const baseItemOrder = itemOrderByTrack(baseTimeline)
  const currentItemOrder = itemOrderByTrack(currentTimeline)
  const targetItemOrder = itemOrderByTrack(targetTimeline)
  const mergedItemsByTrack = itemOrderByTrackFromItems([...mergedItemById.values()])
  const mergedTimelineItems: TimelineEntity[] = []
  const trackIds = new Set([
    ...baseItemOrder.keys(),
    ...currentItemOrder.keys(),
    ...targetItemOrder.keys(),
    ...mergedItemsByTrack.keys(),
  ])
  const itemOrderTrackIds = [
    ...mergedTrackOrder,
    ...[...trackIds].sort().filter((trackId) => !mergedTrackOrder.includes(trackId)),
  ]
  for (const trackId of itemOrderTrackIds) {
    const availableIds = new Set(mergedItemsByTrack.get(trackId) ?? [])
    const mergedItemOrder = mergeOrder({
      label: `items on track ${trackId}`,
      baseOrder: baseItemOrder.get(trackId) ?? [],
      currentOrder: currentItemOrder.get(trackId) ?? [],
      targetOrder: targetItemOrder.get(trackId) ?? [],
      availableIds,
      changes,
      conflicts,
    })
    for (const itemId of mergedItemOrder) {
      const item = mergedItemById.get(itemId)
      if (item) mergedTimelineItems.push(item)
    }
  }

  const mergedTimeline =
    conflicts.length === 0
      ? {
          projectId: currentTimeline.projectId || targetTimeline.projectId || baseTimeline.projectId,
          tracks: mergedTrackOrder
            .map((trackId) => mergedTrackById.get(trackId))
            .filter((track): track is TimelineEntity => Boolean(track)),
          timelineItems: mergedTimelineItems,
        }
      : undefined
  const mergedSummary = mergedTimeline ? summarizeMergedTimeline(mergedTimeline) : undefined
  const summary = `timeline_apply_request dry-run: ${changes.length} change(s), ${conflicts.length} conflict(s). Timeline was not modified.`
  return {
    summary,
    changes,
    conflicts,
    mergedTimeline,
    mergedSummary,
    warnings: payload.warnings ?? [],
  }
}
