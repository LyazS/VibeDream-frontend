import { reactive } from 'vue'

interface TransitionParamOverlayEntry {
  params: Record<string, unknown>
}

const transitionParamOverlays = reactive(new Map<string, TransitionParamOverlayEntry>())

export function setTransitionParamOverlay(timelineItemId: string, parameterKey: string, value: unknown): void {
  const current = transitionParamOverlays.get(timelineItemId)?.params ?? {}
  transitionParamOverlays.set(timelineItemId, {
    params: {
      ...current,
      [parameterKey]: value,
    },
  })
}

export function getTransitionParamOverlay(timelineItemId: string): TransitionParamOverlayEntry | undefined {
  return transitionParamOverlays.get(timelineItemId)
}

export function clearTransitionParamOverlay(timelineItemId: string, parameterKey?: string): void {
  if (!parameterKey) {
    transitionParamOverlays.delete(timelineItemId)
    return
  }

  const current = transitionParamOverlays.get(timelineItemId)
  if (!current) return

  const nextParams = { ...current.params }
  delete nextParams[parameterKey]

  if (Object.keys(nextParams).length === 0) {
    transitionParamOverlays.delete(timelineItemId)
    return
  }

  transitionParamOverlays.set(timelineItemId, { params: nextParams })
}
