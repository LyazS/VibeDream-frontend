import type { MaskHandleDescriptor, MaskOverlayAdapter } from './types'
import {
  INTENSITY_MIN_OFFSET_PX,
  INTENSITY_RANGE_OFFSET_PX,
  createGuideDescriptor,
  createHandleDescriptor,
  createMaskInteractionSession,
  getCanvasDisplayScale,
  getHandleCanvasPoint,
  getMappedLinearGeometry,
  getMovePatch,
  getRotationPatch,
  hitTestHandles,
  isLinearMask,
  isPointInRotatedRect,
  toLocalPoint,
} from './geometry'

export const linearMaskAdapter: MaskOverlayAdapter = {
  type: 'linear',
  getGuides(context) {
    const geometry = getMappedLinearGeometry(context)
    if (!geometry) return []

    return [
      createGuideDescriptor(
        context,
        'primary',
        geometry.center,
        geometry.lineThickness,
        geometry.span,
        geometry.rotation,
        'primary',
      ),
    ]
  },
  getHandles(context) {
    const geometry = getMappedLinearGeometry(context)
    if (!geometry) return []

    const displayScale = getCanvasDisplayScale(context)
    const featherEdge = geometry.featherWidth / 2 + geometry.featherCenterOffsetX
    const handles: MaskHandleDescriptor[] = []

    handles.push(
      createHandleDescriptor(
        context,
        'rotate',
        'rotate',
        'top',
        'radial',
        'rotation',
        getHandleCanvasPoint(
          geometry.center,
          { x: 0, y: geometry.span / 2 + geometry.displayOffsetY },
          geometry.rotation,
        ),
        'grab',
        getHandleCanvasPoint(geometry.center, { x: 0, y: geometry.span / 2 }, geometry.rotation),
      ),
    )

    handles.push(
      createHandleDescriptor(
        context,
        'feather',
        'feather',
        'right',
        'x',
        'feather',
        getHandleCanvasPoint(
          geometry.center,
          { x: featherEdge + geometry.displayOffsetX, y: 0 },
          geometry.rotation,
        ),
        'ew-resize',
        getHandleCanvasPoint(geometry.center, { x: geometry.lineThickness / 2, y: 0 }, geometry.rotation),
      ),
    )

    handles.push(
      createHandleDescriptor(
        context,
        'intensity',
        'intensity',
        'right',
        'x',
        'intensity',
        getHandleCanvasPoint(
          geometry.center,
          {
            x:
              -(geometry.lineThickness / 2) -
              geometry.displayOffsetX +
              INTENSITY_MIN_OFFSET_PX / Math.max(displayScale.x, 0.0001) -
              (INTENSITY_RANGE_OFFSET_PX * context.maskConfig.falloff.decayRate) /
                Math.max(displayScale.x, 0.0001),
            y: 0,
          },
          geometry.rotation,
        ),
        'ew-resize',
        getHandleCanvasPoint(geometry.center, { x: -geometry.lineThickness / 2, y: 0 }, geometry.rotation),
      ),
    )

    return handles
  },
  hitTest(context, point) {
    const handleHit = hitTestHandles(context, point, this.getHandles(context))
    if (handleHit) return handleHit

    const geometry = getMappedLinearGeometry(context)
    if (
      geometry &&
      isPointInRotatedRect(point, geometry.center, geometry.lineThickness, geometry.span, geometry.rotation)
    ) {
      return { handleId: 'move-body', target: 'body' }
    }

    return null
  },
  beginInteraction(context, handle, startPoint) {
    if (!isLinearMask(context.maskConfig)) return null
    const startGeometry = getMappedLinearGeometry(context)
    if (!startGeometry) return null
    return createMaskInteractionSession(context, handle, startPoint, startGeometry)
  },
  updateInteraction(context, session, point) {
    const geometry = getMappedLinearGeometry(context)
    if (!geometry || !isLinearMask(session.startMaskConfig)) return {}

    const startMask = session.startMaskConfig

    if (session.handle.kind === 'move') {
      return getMovePatch(geometry, startMask, point, session.startCanvasPoint)
    }

    if (session.handle.kind === 'rotate') {
      return getRotationPatch(geometry, context, point)
    }

    if (session.handle.kind === 'feather') {
      const localPoint = toLocalPoint(point, geometry.center, geometry.rotation)
      return {
        'mask.outerRange': Math.max(
          0,
          (localPoint.x - geometry.displayOffsetX) / Math.max(geometry.shortSide, 0.0001),
        ),
      }
    }

    if (session.handle.kind === 'intensity') {
      const startLocal = toLocalPoint(session.startCanvasPoint, geometry.center, geometry.rotation)
      const currentLocal = toLocalPoint(point, geometry.center, geometry.rotation)
      return {
        'mask.decayRate': Math.max(
          0,
          Math.min(
            1,
            startMask.falloff.decayRate + (currentLocal.x - startLocal.x) / 200,
          ),
        ),
      }
    }

    return {}
  },
  getCursor(handle) {
    return handle.cursor ?? 'pointer'
  },
}
