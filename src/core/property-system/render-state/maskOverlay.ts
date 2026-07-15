import { reactive } from 'vue'

interface MaskRotationOverlayEntry {
  rotation: number
}

interface MaskFeatherOverlayEntry {
  outerRange: number
}

interface MaskIntensityOverlayEntry {
  decayRate: number
}

interface MaskRectangleCornerRadiusOverlayEntry {
  cornerRadius: number
}

interface MaskMirrorLengthOverlayEntry {
  length: number
}

const maskRotationOverlays = reactive(new Map<string, MaskRotationOverlayEntry>())
const maskFeatherOverlays = reactive(new Map<string, MaskFeatherOverlayEntry>())
const maskIntensityOverlays = reactive(new Map<string, MaskIntensityOverlayEntry>())
const maskRectangleCornerRadiusOverlays = reactive(
  new Map<string, MaskRectangleCornerRadiusOverlayEntry>(),
)
const maskMirrorLengthOverlays = reactive(new Map<string, MaskMirrorLengthOverlayEntry>())

function assertFiniteRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) {
    throw new Error('mask.rotation overlay requires a finite numeric value')
  }
  return rotation
}

function assertFiniteFeather(outerRange: number): number {
  if (!Number.isFinite(outerRange)) {
    throw new Error('mask.feather overlay requires a finite numeric value')
  }
  return outerRange
}

function clampIntensity(decayRate: number): number {
  if (!Number.isFinite(decayRate)) {
    throw new Error('mask.intensity overlay requires a finite numeric value')
  }
  return Math.min(1, Math.max(0, decayRate))
}

function clampCornerRadius(cornerRadius: number): number {
  if (!Number.isFinite(cornerRadius)) {
    throw new Error('mask.rectangle.cornerRadius overlay requires a finite numeric value')
  }
  return Math.min(1, Math.max(0, cornerRadius))
}

function clampMirrorLength(length: number): number {
  if (!Number.isFinite(length)) {
    throw new Error('mask.mirror.length overlay requires a finite numeric value')
  }
  return Math.max(0, length)
}

export function setMaskRotationOverlay(timelineItemId: string, rotation: number): void {
  maskRotationOverlays.set(timelineItemId, {
    rotation: assertFiniteRotation(rotation),
  })
}

export function getMaskRotationOverlay(timelineItemId: string): MaskRotationOverlayEntry | undefined {
  return maskRotationOverlays.get(timelineItemId)
}

export function clearMaskRotationOverlay(timelineItemId: string): void {
  maskRotationOverlays.delete(timelineItemId)
}

export function setMaskFeatherOverlay(timelineItemId: string, outerRange: number): void {
  maskFeatherOverlays.set(timelineItemId, {
    outerRange: assertFiniteFeather(outerRange),
  })
}

export function getMaskFeatherOverlay(timelineItemId: string): MaskFeatherOverlayEntry | undefined {
  return maskFeatherOverlays.get(timelineItemId)
}

export function clearMaskFeatherOverlay(timelineItemId: string): void {
  maskFeatherOverlays.delete(timelineItemId)
}

export function setMaskIntensityOverlay(timelineItemId: string, decayRate: number): void {
  maskIntensityOverlays.set(timelineItemId, {
    decayRate: clampIntensity(decayRate),
  })
}

export function getMaskIntensityOverlay(timelineItemId: string): MaskIntensityOverlayEntry | undefined {
  return maskIntensityOverlays.get(timelineItemId)
}

export function clearMaskIntensityOverlay(timelineItemId: string): void {
  maskIntensityOverlays.delete(timelineItemId)
}

export function setMaskRectangleCornerRadiusOverlay(
  timelineItemId: string,
  cornerRadius: number,
): void {
  maskRectangleCornerRadiusOverlays.set(timelineItemId, {
    cornerRadius: clampCornerRadius(cornerRadius),
  })
}

export function getMaskRectangleCornerRadiusOverlay(
  timelineItemId: string,
): MaskRectangleCornerRadiusOverlayEntry | undefined {
  return maskRectangleCornerRadiusOverlays.get(timelineItemId)
}

export function clearMaskRectangleCornerRadiusOverlay(timelineItemId: string): void {
  maskRectangleCornerRadiusOverlays.delete(timelineItemId)
}

export function setMaskMirrorLengthOverlay(timelineItemId: string, length: number): void {
  maskMirrorLengthOverlays.set(timelineItemId, {
    length: clampMirrorLength(length),
  })
}

export function getMaskMirrorLengthOverlay(
  timelineItemId: string,
): MaskMirrorLengthOverlayEntry | undefined {
  return maskMirrorLengthOverlays.get(timelineItemId)
}

export function clearMaskMirrorLengthOverlay(timelineItemId: string): void {
  maskMirrorLengthOverlays.delete(timelineItemId)
}
