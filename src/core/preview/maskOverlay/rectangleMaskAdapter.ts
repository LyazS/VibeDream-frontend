import type {
  MaskGuideDescriptor,
  MaskHandleDescriptor,
  MaskOverlayAdapter,
  MaskOverlayContext,
  Point2D,
} from './types'
import {
  createGuideDescriptor,
  createHandleDescriptor,
  createMaskInteractionSession,
  getMappedRectangleGeometry,
  getMovePatch,
  getResizeBoundsPatch,
  getRotationPatch,
  hitTestHandles,
  isRectangleMask,
  getHandleCanvasPoint,
  isPointInRotatedRect,
  toLocalPoint,
  INTENSITY_SENSITIVITY,
  INTENSITY_MIN_OFFSET_PX,
  INTENSITY_RANGE_OFFSET_PX,
} from './geometry'

function getRectangleGuides(context: MaskOverlayContext): MaskGuideDescriptor[] {
  const geometry = getMappedRectangleGeometry(context)
  if (!geometry) return []

  return [
    createGuideDescriptor(
      context,
      'primary',
      geometry.center,
      geometry.width,
      geometry.height,
      geometry.rotation,
      'primary',
    ),
    createGuideDescriptor(
      context,
      'feather',
      geometry.center,
      geometry.featherWidth,
      geometry.featherHeight,
      geometry.rotation,
      'feather',
    ),
  ]
}

export const rectangleMaskAdapter: MaskOverlayAdapter = {
  type: 'rectangle',
  getGuides(context) {
    return getRectangleGuides(context)
  },
  getHandles(context) {
    const geometry = getMappedRectangleGeometry(context)
    if (!geometry) return []

    const center = geometry.center
    const handles: MaskHandleDescriptor[] = []
    const resizeDefs: Array<{
      id: string
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'left' | 'right'
      local: Point2D
      axis: MaskHandleDescriptor['axis']
      styleVariant: MaskHandleDescriptor['styleVariant']
      cursor: string
    }> = [
      {
        id: 'resize-top-left',
        position: 'top-left',
        local: { x: -geometry.width / 2, y: geometry.height / 2 },
        axis: 'xy',
        styleVariant: 'corner',
        cursor: 'nwse-resize',
      },
      {
        id: 'resize-top-right',
        position: 'top-right',
        local: { x: geometry.width / 2, y: geometry.height / 2 },
        axis: 'xy',
        styleVariant: 'corner',
        cursor: 'nesw-resize',
      },
      {
        id: 'resize-bottom-left',
        position: 'bottom-left',
        local: { x: -geometry.width / 2, y: -geometry.height / 2 },
        axis: 'xy',
        styleVariant: 'corner',
        cursor: 'nesw-resize',
      },
      {
        id: 'resize-bottom-right',
        position: 'bottom-right',
        local: { x: geometry.width / 2, y: -geometry.height / 2 },
        axis: 'xy',
        styleVariant: 'corner',
        cursor: 'nwse-resize',
      },
      {
        id: 'resize-top',
        position: 'top',
        local: { x: 0, y: geometry.height / 2 },
        axis: 'y',
        styleVariant: 'edge',
        cursor: 'ns-resize',
      },
      {
        id: 'resize-bottom',
        position: 'bottom',
        local: { x: 0, y: -geometry.height / 2 },
        axis: 'y',
        styleVariant: 'edge',
        cursor: 'ns-resize',
      },
      {
        id: 'resize-left',
        position: 'left',
        local: { x: -geometry.width / 2, y: 0 },
        axis: 'x',
        styleVariant: 'edge',
        cursor: 'ew-resize',
      },
      {
        id: 'resize-right',
        position: 'right',
        local: { x: geometry.width / 2, y: 0 },
        axis: 'x',
        styleVariant: 'edge',
        cursor: 'ew-resize',
      },
    ]

    for (const def of resizeDefs) {
      handles.push(
        createHandleDescriptor(
          context,
          def.id,
          'resize',
          def.position,
          def.axis,
          def.styleVariant,
          getHandleCanvasPoint(center, def.local, geometry.rotation),
          def.cursor,
        ),
      )
    }

    handles.push(
      createHandleDescriptor(
        context,
        'rotate',
        'rotate',
        'top',
        'radial',
        'rotation',
        getHandleCanvasPoint(
          center,
          { x: 0, y: geometry.height / 2 + geometry.displayOffsetY },
          geometry.rotation,
        ),
        'grab',
        getHandleCanvasPoint(center, { x: 0, y: geometry.height / 2 }, geometry.rotation),
      ),
    )

    handles.push(
      createHandleDescriptor(
        context,
        'feather',
        'feather',
        'bottom',
        'y',
        'feather',
        getHandleCanvasPoint(
          center,
          { x: 0, y: -(geometry.featherHeight / 2 + geometry.displayOffsetY) },
          geometry.rotation,
        ),
        'ns-resize',
        getHandleCanvasPoint(center, { x: 0, y: -geometry.featherHeight / 2 }, geometry.rotation),
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
          center,
          {
            x:
              geometry.featherWidth / 2 +
              INTENSITY_MIN_OFFSET_PX / Math.max(context.canvasDisplaySize.width / Math.max(context.canvasResolution.width, 1), 0.0001) +
              (INTENSITY_RANGE_OFFSET_PX * context.maskConfig.falloff.decayRate) /
                Math.max(context.canvasDisplaySize.width / Math.max(context.canvasResolution.width, 1), 0.0001),
            y: 0,
          },
          geometry.rotation,
        ),
        'ew-resize',
        getHandleCanvasPoint(center, { x: geometry.featherWidth / 2, y: 0 }, geometry.rotation),
      ),
    )

    return handles
  },
  hitTest(context, point) {
    const handleHit = hitTestHandles(context, point, this.getHandles(context))
    if (handleHit) return handleHit

    const geometry = getMappedRectangleGeometry(context)
    if (
      geometry &&
      isPointInRotatedRect(point, geometry.center, geometry.width, geometry.height, geometry.rotation)
    ) {
      return { handleId: 'move-body', target: 'body' }
    }

    return null
  },
  beginInteraction(context, handle, startPoint) {
    if (!isRectangleMask(context.maskConfig)) return null
    const startGeometry = getMappedRectangleGeometry(context)
    if (!startGeometry) return null
    return createMaskInteractionSession(context, handle, startPoint, startGeometry)
  },
  updateInteraction(context, session, point) {
    const geometry = getMappedRectangleGeometry(context)
    if (!geometry || !isRectangleMask(session.startMaskConfig)) return {}

    const startMask = session.startMaskConfig

    if (session.handle.kind === 'move') {
      return getMovePatch(geometry, startMask, point, session.startCanvasPoint)
    }

    if (session.handle.kind === 'resize') {
      const startGeometry = session.startGeometry
      if (
        !startGeometry ||
        startGeometry.width === undefined ||
        startGeometry.height === undefined
      ) {
        return {}
      }
      const startBoxGeometry = startGeometry as typeof geometry

      const currentLocalPoint = toLocalPoint(
        point,
        startBoxGeometry.center,
        startBoxGeometry.rotation,
      )
      const initialLeft = -startBoxGeometry.width * 0.5
      const initialRight = startBoxGeometry.width * 0.5
      const initialBottom = -startBoxGeometry.height * 0.5
      const initialTop = startBoxGeometry.height * 0.5

      let left = initialLeft
      let right = initialRight
      let bottom = initialBottom
      let top = initialTop

      switch (session.handle.position) {
        case 'top-left':
          left = currentLocalPoint.x
          top = currentLocalPoint.y
          break
        case 'top-right':
          right = currentLocalPoint.x
          top = currentLocalPoint.y
          break
        case 'bottom-left':
          left = currentLocalPoint.x
          bottom = currentLocalPoint.y
          break
        case 'bottom-right':
          right = currentLocalPoint.x
          bottom = currentLocalPoint.y
          break
        case 'top':
          top = currentLocalPoint.y
          break
        case 'bottom':
          bottom = currentLocalPoint.y
          break
        case 'left':
          left = currentLocalPoint.x
          break
        case 'right':
          right = currentLocalPoint.x
          break
      }

      return getResizeBoundsPatch(
        context,
        startBoxGeometry,
        left,
        right,
        bottom,
        top,
        'mask.width',
        'mask.height',
      )
    }

    if (session.handle.kind === 'rotate') {
      return getRotationPatch(geometry, context, point)
    }

    if (session.handle.kind === 'feather') {
      const localPoint = toLocalPoint(point, geometry.center, geometry.rotation)
      return {
        'mask.outerRange': Math.max(
          0,
          (-localPoint.y - geometry.height / 2 - geometry.displayOffsetY) /
            Math.max(geometry.displayScaleY, 0.0001),
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
            startMask.falloff.decayRate + (currentLocal.x - startLocal.x) / INTENSITY_SENSITIVITY,
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

export const defaultMaskAdapter: MaskOverlayAdapter = {
  type: 'default',
  getHandles() {
    return []
  },
  getGuides() {
    return []
  },
  hitTest() {
    return null
  },
  beginInteraction() {
    return null
  },
  updateInteraction() {
    return {}
  },
  getCursor() {
    return 'default'
  },
}
