import { calculateRotationAngle } from '@/core/utils/transformMath'
import type {
  EllipseMaskConfig,
  LinearMaskConfig,
  MaskConfig,
  MirrorMaskConfig,
  RectangleMaskConfig,
} from '@/core/timelineitem/features/mask'
import {
  isEllipseMaskConfig,
  isLinearMaskConfig,
  isMirrorMaskConfig,
  isRectangleMaskConfig,
} from '@/core/timelineitem/features/mask'
import type {
  MaskDeferredPatch,
  MaskGuideDescriptor,
  MaskHandleDescriptor,
  MaskInteractionSession,
  MaskOverlayContext,
  Point2D,
} from './types'
import {
  canvasPointToDOMPoint,
  getHandleCanvasPoint,
  rotateLocalPoint,
  toLocalPoint,
} from './types'

export const HANDLE_OFFSET_PX = 40
export const HANDLE_HIT_RADIUS = 18
export const INTENSITY_SENSITIVITY = 200
export const MIN_MASK_SIZE = 10
export const INTENSITY_MIN_OFFSET_PX = 16
export const INTENSITY_RANGE_OFFSET_PX = 44
export const LINE_GUIDE_THICKNESS_PX = 10
export const MIN_LINE_BODY_THICKNESS = 6
export const MIN_MIRROR_SPAN = 24

export interface BaseMaskGeometry {
  center: Point2D
  rotation: number
  itemRotation: number
  displayScaleX: number
  displayScaleY: number
  displayOffsetX: number
  displayOffsetY: number
}

export interface BoxMaskGeometry extends BaseMaskGeometry {
  width: number
  height: number
  featherWidth: number
  featherHeight: number
}

export interface LinearMaskGeometry extends BaseMaskGeometry {
  span: number
  lineThickness: number
  featherWidth: number
  featherCenterOffsetX: number
}

export interface MirrorMaskGeometry extends BaseMaskGeometry {
  length: number
  featherLength: number
  spanHeight: number
}

export function getCanvasDisplayScale(context: MaskOverlayContext) {
  return {
    x: context.canvasDisplaySize.width / Math.max(context.canvasResolution.width, 1),
    y: context.canvasDisplaySize.height / Math.max(context.canvasResolution.height, 1),
  }
}

export function getMaskBaseGeometry(context: MaskOverlayContext): BaseMaskGeometry {
  const item = context.visualConfig
  const mask = context.maskConfig
  const localCenter = {
    x: mask.centerX,
    y: -mask.centerY,
  }
  const rotatedCenterOffset = rotateLocalPoint(localCenter, item.rotation)
  const displayScale = getCanvasDisplayScale(context)

  return {
    center: {
      x: item.x + rotatedCenterOffset.x,
      y: item.y + rotatedCenterOffset.y,
    },
    rotation: item.rotation + mask.rotation,
    itemRotation: item.rotation,
    displayScaleX: 1,
    displayScaleY: 1,
    displayOffsetX: HANDLE_OFFSET_PX / Math.max(displayScale.x, 0.0001),
    displayOffsetY: HANDLE_OFFSET_PX / Math.max(displayScale.y, 0.0001),
  }
}

export function getMappedRectangleGeometry(context: MaskOverlayContext): BoxMaskGeometry | null {
  if (!isRectangleMaskConfig(context.maskConfig)) return null

  const mask = context.maskConfig
  const base = getMaskBaseGeometry(context)
  return {
    ...base,
    width: mask.width * base.displayScaleX,
    height: mask.height * base.displayScaleY,
    featherWidth: (mask.width + mask.falloff.outerRange * 2) * base.displayScaleX,
    featherHeight: (mask.height + mask.falloff.outerRange * 2) * base.displayScaleY,
  }
}

export function getMappedEllipseGeometry(context: MaskOverlayContext): BoxMaskGeometry | null {
  if (!isEllipseMaskConfig(context.maskConfig)) return null

  const mask = context.maskConfig
  const base = getMaskBaseGeometry(context)
  return {
    ...base,
    width: mask.ellipseWidth * base.displayScaleX,
    height: mask.ellipseHeight * base.displayScaleY,
    featherWidth: (mask.ellipseWidth + mask.falloff.outerRange * 2) * base.displayScaleX,
    featherHeight: (mask.ellipseHeight + mask.falloff.outerRange * 2) * base.displayScaleY,
  }
}

export function getMappedLinearGeometry(context: MaskOverlayContext): LinearMaskGeometry | null {
  if (!isLinearMaskConfig(context.maskConfig)) return null

  const mask = context.maskConfig
  const base = getMaskBaseGeometry(context)
  const span = Math.max(
    Math.hypot(context.visualConfig.width, context.visualConfig.height),
    MIN_MIRROR_SPAN,
  )
  const lineThickness = Math.max(
    LINE_GUIDE_THICKNESS_PX / Math.max(getCanvasDisplayScale(context).x, 0.0001),
    MIN_LINE_BODY_THICKNESS / Math.max(base.displayScaleX, 0.0001),
  )

  return {
    ...base,
    span,
    lineThickness,
    featherWidth: Math.max(lineThickness, mask.falloff.outerRange * base.displayScaleX + lineThickness),
    featherCenterOffsetX: (mask.falloff.outerRange * base.displayScaleX) * 0.5,
  }
}

export function getMappedMirrorGeometry(context: MaskOverlayContext): MirrorMaskGeometry | null {
  if (!isMirrorMaskConfig(context.maskConfig)) return null

  const mask = context.maskConfig
  const base = getMaskBaseGeometry(context)
  const spanHeight = Math.max(
    Math.hypot(context.visualConfig.width, context.visualConfig.height),
    MIN_MIRROR_SPAN,
  )

  return {
    ...base,
    length: mask.length * base.displayScaleX,
    featherLength: (mask.length + mask.falloff.outerRange * 2) * base.displayScaleX,
    spanHeight,
  }
}

export function createGuideDescriptor(
  context: MaskOverlayContext,
  id: string,
  center: Point2D,
  width: number,
  height: number,
  rotation: number,
  variant: MaskGuideDescriptor['variant'],
): MaskGuideDescriptor {
  const centerDom = canvasPointToDOMPoint(
    center,
    context.canvasResolution,
    context.canvasDisplaySize,
    context.containerSize,
  )
  const displayScale = getCanvasDisplayScale(context)

  return {
    id,
    left: centerDom.x - (width * displayScale.x) / 2,
    top: centerDom.y - (height * displayScale.y) / 2,
    width: width * displayScale.x,
    height: height * displayScale.y,
    rotation: (rotation * Math.PI) / 180,
    variant,
  }
}

export function createHandleDescriptor(
  context: MaskOverlayContext,
  id: string,
  kind: MaskHandleDescriptor['kind'],
  position: string,
  axis: MaskHandleDescriptor['axis'],
  styleVariant: MaskHandleDescriptor['styleVariant'],
  canvasPoint: Point2D,
  cursor: string,
  anchorPoint?: Point2D,
): MaskHandleDescriptor {
  const domPoint = canvasPointToDOMPoint(
    canvasPoint,
    context.canvasResolution,
    context.canvasDisplaySize,
    context.containerSize,
  )
  const domAnchor = anchorPoint
    ? canvasPointToDOMPoint(
        anchorPoint,
        context.canvasResolution,
        context.canvasDisplaySize,
        context.containerSize,
      )
    : null

  return {
    id,
    kind,
    position,
    axis,
    visible: true,
    styleVariant,
    x: domPoint.x,
    y: domPoint.y,
    anchorX: domAnchor?.x,
    anchorY: domAnchor?.y,
    cursor,
  }
}

export function createMaskInteractionSession(
  context: MaskOverlayContext,
  handle: MaskHandleDescriptor,
  startPoint: Point2D,
  startGeometry: MaskInteractionSession['startGeometry'] = null,
): MaskInteractionSession {
  return {
    type: context.maskConfig.type,
    handle,
    startCanvasPoint: startPoint,
    startMaskConfig: { ...context.maskConfig, falloff: { ...context.maskConfig.falloff } },
    startGeometry,
  }
}

export function getMovePatch(
  geometry: BaseMaskGeometry,
  startMask: MaskConfig,
  point: Point2D,
  startCanvasPoint: Point2D,
): MaskDeferredPatch {
  const deltaX = point.x - startCanvasPoint.x
  const deltaY = point.y - startCanvasPoint.y
  const localDelta = toLocalPoint(
    {
      x: geometry.center.x + deltaX,
      y: geometry.center.y + deltaY,
    },
    geometry.center,
    geometry.itemRotation,
  )

  return {
    'mask.centerX': startMask.centerX + localDelta.x / Math.max(geometry.displayScaleX, 0.0001),
    'mask.centerY': startMask.centerY - localDelta.y / Math.max(geometry.displayScaleY, 0.0001),
  }
}

export function getRotationPatch(
  geometry: BaseMaskGeometry,
  context: MaskOverlayContext,
  point: Point2D,
): MaskDeferredPatch {
  return {
    'mask.rotation':
      calculateRotationAngle(point.x, point.y, geometry.center.x, geometry.center.y) -
      context.visualConfig.rotation,
  }
}

export function clampResizeBounds(
  left: number,
  right: number,
  bottom: number,
  top: number,
): { left: number; right: number; bottom: number; top: number } {
  let nextLeft = left
  let nextRight = right
  let nextBottom = bottom
  let nextTop = top

  if (nextRight - nextLeft < MIN_MASK_SIZE) {
    const centerX = (nextLeft + nextRight) * 0.5
    nextLeft = centerX - MIN_MASK_SIZE * 0.5
    nextRight = centerX + MIN_MASK_SIZE * 0.5
  }

  if (nextTop - nextBottom < MIN_MASK_SIZE) {
    const centerY = (nextTop + nextBottom) * 0.5
    nextBottom = centerY - MIN_MASK_SIZE * 0.5
    nextTop = centerY + MIN_MASK_SIZE * 0.5
  }

  return { left: nextLeft, right: nextRight, bottom: nextBottom, top: nextTop }
}

export function getResizeBoundsPatch(
  context: MaskOverlayContext,
  geometry: BoxMaskGeometry,
  left: number,
  right: number,
  bottom: number,
  top: number,
  widthPath: 'mask.width' | 'mask.ellipseWidth',
  heightPath: 'mask.height' | 'mask.ellipseHeight',
): MaskDeferredPatch {
  // `geometry` must be captured at drag start; passing a live, already-mutated geometry
  // causes the resize baseline to drift across successive mousemove events.
  const clamped = clampResizeBounds(left, right, bottom, top)
  const nextCenterLocal = {
    x: (clamped.left + clamped.right) * 0.5,
    y: (clamped.top + clamped.bottom) * 0.5,
  }
  const nextCenterGlobalOffset = rotateLocalPoint(nextCenterLocal, geometry.rotation)
  const nextCenterGlobal = {
    x: geometry.center.x + nextCenterGlobalOffset.x,
    y: geometry.center.y + nextCenterGlobalOffset.y,
  }
  const centerOffsetLocalToItem = toLocalPoint(
    nextCenterGlobal,
    { x: context.visualConfig.x, y: context.visualConfig.y },
    context.visualConfig.rotation,
  )

  return {
    'mask.centerX': centerOffsetLocalToItem.x / Math.max(geometry.displayScaleX, 0.0001),
    'mask.centerY': -centerOffsetLocalToItem.y / Math.max(geometry.displayScaleY, 0.0001),
    [widthPath]: (clamped.right - clamped.left) / Math.max(geometry.displayScaleX, 0.0001),
    [heightPath]: (clamped.top - clamped.bottom) / Math.max(geometry.displayScaleY, 0.0001),
  }
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

export function isPointInRotatedEllipse(
  point: Point2D,
  center: Point2D,
  width: number,
  height: number,
  rotation: number,
): boolean {
  const local = toLocalPoint(point, center, rotation)
  const rx = Math.max(width / 2, 0.0001)
  const ry = Math.max(height / 2, 0.0001)
  return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1
}

export function hitTestHandles(
  context: MaskOverlayContext,
  point: Point2D,
  handles: MaskHandleDescriptor[],
) {
  const pointDom = canvasPointToDOMPoint(
    point,
    context.canvasResolution,
    context.canvasDisplaySize,
    context.containerSize,
  )

  for (const handle of handles) {
    if (Math.hypot(pointDom.x - handle.x, pointDom.y - handle.y) <= HANDLE_HIT_RADIUS) {
      return { handleId: handle.id, target: 'handle' as const }
    }
  }

  return null
}

export function isRectangleMask(mask: MaskConfig): mask is RectangleMaskConfig {
  return isRectangleMaskConfig(mask)
}

export function isEllipseMask(mask: MaskConfig): mask is EllipseMaskConfig {
  return isEllipseMaskConfig(mask)
}

export function isLinearMask(mask: MaskConfig): mask is LinearMaskConfig {
  return isLinearMaskConfig(mask)
}

export function isMirrorMask(mask: MaskConfig): mask is MirrorMaskConfig {
  return isMirrorMaskConfig(mask)
}

export { getHandleCanvasPoint, rotateLocalPoint, toLocalPoint }
