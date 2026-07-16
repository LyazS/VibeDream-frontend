import type { MaskHandleDescriptor, MaskOverlayAdapter } from './types'
import {
  INTENSITY_MIN_OFFSET_PX,
  INTENSITY_RANGE_OFFSET_PX,
  MIN_MASK_SIZE,
  createGuideDescriptor,
  createHandleDescriptor,
  createMaskInteractionSession,
  getCanvasDisplayScale,
  getHandleCanvasPoint,
  getMappedMirrorGeometry,
  getMovePatch,
  getRotationPatch,
  hitTestHandles,
  isMirrorMask,
  isPointInRotatedRect,
  toLocalPoint,
} from './geometry'

export const mirrorMaskAdapter: MaskOverlayAdapter = {
  type: 'mirror',
  getGuides(context) {
    const geometry = getMappedMirrorGeometry(context)
    if (!geometry) return []

    return [
      createGuideDescriptor(
        context,
        'primary',
        geometry.center,
        geometry.length,
        geometry.spanHeight,
        geometry.rotation,
        'primary',
      ),
      createGuideDescriptor(
        context,
        'feather',
        geometry.center,
        geometry.featherLength,
        geometry.spanHeight,
        geometry.rotation,
        'feather',
      ),
    ]
  },
  getHandles(context) {
    const geometry = getMappedMirrorGeometry(context)
    if (!geometry) return []

    const displayScale = getCanvasDisplayScale(context)
    const handles: MaskHandleDescriptor[] = []

    handles.push(
      createHandleDescriptor(
        context,
        'resize-left',
        'resize',
        'left',
        'x',
        'edge',
        getHandleCanvasPoint(geometry.center, { x: -geometry.length / 2, y: 0 }, geometry.rotation),
        'ew-resize',
      ),
    )

    handles.push(
      createHandleDescriptor(
        context,
        'resize-right',
        'resize',
        'right',
        'x',
        'edge',
        getHandleCanvasPoint(geometry.center, { x: geometry.length / 2, y: 0 }, geometry.rotation),
        'ew-resize',
      ),
    )

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
          { x: 0, y: geometry.spanHeight / 2 + geometry.displayOffsetY },
          geometry.rotation,
        ),
        'grab',
        getHandleCanvasPoint(geometry.center, { x: 0, y: geometry.spanHeight / 2 }, geometry.rotation),
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
          { x: geometry.featherLength / 2 + geometry.displayOffsetX, y: 0 },
          geometry.rotation,
        ),
        'ew-resize',
        getHandleCanvasPoint(geometry.center, { x: geometry.featherLength / 2, y: 0 }, geometry.rotation),
      ),
    )

    handles.push(
      createHandleDescriptor(
        context,
        'intensity',
        'intensity',
        'left',
        'x',
        'intensity',
        getHandleCanvasPoint(
          geometry.center,
          {
            x:
              -(geometry.featherLength / 2) -
              geometry.displayOffsetX -
              INTENSITY_MIN_OFFSET_PX / Math.max(displayScale.x, 0.0001) -
              (INTENSITY_RANGE_OFFSET_PX * context.maskConfig.falloff.decayRate) /
                Math.max(displayScale.x, 0.0001),
            y: 0,
          },
          geometry.rotation,
        ),
        'ew-resize',
        getHandleCanvasPoint(geometry.center, { x: -geometry.featherLength / 2, y: 0 }, geometry.rotation),
      ),
    )

    return handles
  },
  hitTest(context, point) {
    const handleHit = hitTestHandles(context, point, this.getHandles(context))
    if (handleHit) return handleHit

    const geometry = getMappedMirrorGeometry(context)
    if (
      geometry &&
      isPointInRotatedRect(point, geometry.center, geometry.length, geometry.spanHeight, geometry.rotation)
    ) {
      return { handleId: 'move-body', target: 'body' }
    }

    return null
  },
  beginInteraction(context, handle, startPoint) {
    if (!isMirrorMask(context.maskConfig)) return null
    const startGeometry = getMappedMirrorGeometry(context)
    if (!startGeometry) return null
    return createMaskInteractionSession(context, handle, startPoint, startGeometry)
  },
  updateInteraction(context, session, point) {
    const geometry = getMappedMirrorGeometry(context)
    if (!geometry || !isMirrorMask(session.startMaskConfig)) return {}

    const startMask = session.startMaskConfig

    if (session.handle.kind === 'move') {
      return getMovePatch(geometry, startMask, point, session.startCanvasPoint)
    }

    if (session.handle.kind === 'resize') {
      const currentLocal = toLocalPoint(point, geometry.center, geometry.rotation)
      return {
        'mask.length': Math.max(
          MIN_MASK_SIZE / Math.max(geometry.itemWidth, 0.0001),
          (Math.max(0, Math.abs(currentLocal.x)) * 2) / Math.max(geometry.itemWidth, 0.0001),
        ),
      }
    }

    if (session.handle.kind === 'rotate') {
      return getRotationPatch(geometry, context, point)
    }

    if (session.handle.kind === 'feather') {
      const localPoint = toLocalPoint(point, geometry.center, geometry.rotation)
      return {
        'mask.outerRange': Math.max(
          0,
          (Math.abs(localPoint.x) - geometry.length / 2 - geometry.displayOffsetX) /
            Math.max(geometry.shortSide, 0.0001),
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
            startMask.falloff.decayRate + (startLocal.x - currentLocal.x) / 200,
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
