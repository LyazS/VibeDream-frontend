import { degreesToRadians } from '@/core/utils/rotationTransform'
import { domToCanvasCoordinates } from '@/core/utils/canvasClickUtils'
import type { MaskConfig, MaskPropertyPath, MaskType, RectangleMaskConfig } from '@/core/timelineitem/features/mask'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

export interface Point2D {
  x: number
  y: number
}

export interface Size2D {
  width: number
  height: number
}

export interface PreviewTransformState {
  zoom: number
  offsetX: number
  offsetY: number
}

export interface MaskGuideDescriptor {
  id: string
  left: number
  top: number
  width: number
  height: number
  rotation: number
  variant: 'primary' | 'feather'
}

export interface MaskHandleDescriptor {
  id: string
  kind: 'move' | 'resize' | 'rotate' | 'feather' | 'intensity' | 'custom'
  position: string
  axis: 'x' | 'y' | 'xy' | 'radial' | 'custom'
  visible: boolean
  styleVariant: 'corner' | 'edge' | 'rotation' | 'feather' | 'intensity' | 'custom'
  x: number
  y: number
  anchorX?: number
  anchorY?: number
  cursor?: string
}

export interface MaskHitResult {
  handleId: string
  target: 'handle' | 'body'
}

export interface MaskOverlayContext {
  item: UnifiedTimelineItemData
  maskConfig: MaskConfig
  visualConfig: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }
  itemLocalSize: Size2D
  canvasResolution: Size2D
  canvasDisplaySize: Size2D
  containerSize: Size2D
  previewTransform: PreviewTransformState
}

export interface MaskInteractionGeometry {
  center: Point2D
  rotation: number
  itemRotation: number
  displayScaleX: number
  displayScaleY: number
  displayOffsetX: number
  displayOffsetY: number
  width?: number
  height?: number
  featherWidth?: number
  featherHeight?: number
  span?: number
  lineThickness?: number
  featherCenterOffsetX?: number
  length?: number
  featherLength?: number
  spanHeight?: number
}

export interface MaskInteractionSession {
  type: MaskType
  handle: MaskHandleDescriptor
  startCanvasPoint: Point2D
  startMaskConfig: MaskConfig
  startGeometry: MaskInteractionGeometry | null
}

export type MaskDeferredPatch = Partial<Record<MaskPropertyPath, number>>

export interface MaskOverlayAdapter {
  type: MaskType | 'default'
  getHandles(context: MaskOverlayContext): MaskHandleDescriptor[]
  getGuides(context: MaskOverlayContext): MaskGuideDescriptor[]
  hitTest(context: MaskOverlayContext, point: Point2D): MaskHitResult | null
  beginInteraction(
    context: MaskOverlayContext,
    handle: MaskHandleDescriptor,
    startPoint: Point2D,
  ): MaskInteractionSession | null
  updateInteraction(
    context: MaskOverlayContext,
    session: MaskInteractionSession,
    point: Point2D,
  ): MaskDeferredPatch
  getCursor(handle: MaskHandleDescriptor): string
}

export function canvasPointToDOMPoint(
  point: Point2D,
  canvasResolution: Size2D,
  canvasDisplaySize: Size2D,
  containerSize: Size2D,
): Point2D {
  const scaleX = canvasDisplaySize.width / Math.max(canvasResolution.width, 1)
  const scaleY = canvasDisplaySize.height / Math.max(canvasResolution.height, 1)
  const offsetX = (containerSize.width - canvasDisplaySize.width) / 2
  const offsetY = (containerSize.height - canvasDisplaySize.height) / 2

  return {
    x: (point.x + canvasResolution.width / 2) * scaleX + offsetX,
    y: (canvasResolution.height / 2 - point.y) * scaleY + offsetY,
  }
}

export function canvasRectToDOMRect(
  center: Point2D,
  size: Size2D,
  rotation: number,
  canvasResolution: Size2D,
  canvasDisplaySize: Size2D,
  containerSize: Size2D,
): MaskGuideDescriptor {
  const centerDom = canvasPointToDOMPoint(
    center,
    canvasResolution,
    canvasDisplaySize,
    containerSize,
  )
  const scaleX = canvasDisplaySize.width / Math.max(canvasResolution.width, 1)
  const scaleY = canvasDisplaySize.height / Math.max(canvasResolution.height, 1)
  const width = size.width * scaleX
  const height = size.height * scaleY

  return {
    id: 'rect',
    left: centerDom.x - width / 2,
    top: centerDom.y - height / 2,
    width,
    height,
    rotation: degreesToRadians(rotation),
    variant: 'primary',
  }
}

export function rotateLocalPoint(local: Point2D, rotation: number): Point2D {
  const radians = degreesToRadians(-rotation)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: local.x * cos - local.y * sin,
    y: local.x * sin + local.y * cos,
  }
}

export function toLocalPoint(globalPoint: Point2D, center: Point2D, rotation: number): Point2D {
  const dx = globalPoint.x - center.x
  const dy = globalPoint.y - center.y
  const radians = degreesToRadians(rotation)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

export function getHandleCanvasPoint(
  center: Point2D,
  localPoint: Point2D,
  rotation: number,
): Point2D {
  const rotated = rotateLocalPoint(localPoint, rotation)
  return {
    x: center.x + rotated.x,
    y: center.y + rotated.y,
  }
}

export function clientPointToCanvasPoint(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  context: MaskOverlayContext,
): Point2D {
  const mouseX = clientX - containerRect.left
  const mouseY = clientY - containerRect.top
  const stageX =
    context.containerSize.width / 2 +
    (mouseX - context.containerSize.width / 2 - context.previewTransform.offsetX) /
      context.previewTransform.zoom
  const stageY =
    context.containerSize.height / 2 +
    (mouseY - context.containerSize.height / 2 - context.previewTransform.offsetY) /
      context.previewTransform.zoom

  return domToCanvasCoordinates(
    stageX,
    stageY,
    context.canvasResolution,
    context.canvasDisplaySize,
    context.containerSize,
  )
}

export function isPointInRotatedRect(
  point: Point2D,
  center: Point2D,
  width: number,
  height: number,
  rotation: number,
): boolean {
  const local = toLocalPoint(point, center, rotation)
  return Math.abs(local.x) <= width / 2 && Math.abs(local.y) <= height / 2
}

export function isRectangleMaskConfig(mask: MaskConfig): mask is RectangleMaskConfig {
  return mask.type === 'rectangle'
}
