import { domDeltaToCanvasDelta, domToCanvasCoordinates } from '@/core/utils/canvasClickUtils'
import { calculateRotationAngle, calculateScaledSize } from '@/core/utils/transformMath'
import { screenDeltaToStageDelta, screenPointToStagePoint } from './geometry'
import type {
  PreviewTransformState,
  RotateStartEventPayload,
  ScaleStartEventPayload,
  Size2D,
  TransformDragSession,
  TransformRotationSession,
  TransformScaleSession,
} from './types'

export function createTransformDragSession(
  startEvent: MouseEvent,
  initialPosition: { x: number; y: number },
): TransformDragSession {
  return {
    isDragging: true,
    startX: startEvent.clientX,
    startY: startEvent.clientY,
    initialCanvasX: initialPosition.x,
    initialCanvasY: initialPosition.y,
    hasMoved: false,
  }
}

export function getDragPreviewPosition(
  session: TransformDragSession,
  event: MouseEvent,
  previewTransform: PreviewTransformState,
  canvasDisplaySize: Size2D,
  canvasResolution: Size2D,
) {
  const stageDelta = screenDeltaToStageDelta(
    event.clientX - session.startX,
    event.clientY - session.startY,
    previewTransform,
  )
  const canvasDelta = domDeltaToCanvasDelta(
    stageDelta.x,
    stageDelta.y,
    canvasDisplaySize,
    canvasResolution,
  )

  return {
    x: session.initialCanvasX + canvasDelta.x,
    y: session.initialCanvasY + canvasDelta.y,
  }
}

export function createTransformScaleSession(
  startEvent: ScaleStartEventPayload,
  initialGeometry: {
    width: number
    height: number
    x: number
    y: number
    rotation: number
  },
): TransformScaleSession {
  return {
    isScaling: true,
    handleType: startEvent.handleType,
    handlePosition: startEvent.handlePosition,
    isProportional: startEvent.isProportional,
    startX: startEvent.clientX,
    startY: startEvent.clientY,
    initialWidth: initialGeometry.width,
    initialHeight: initialGeometry.height,
    initialX: initialGeometry.x,
    initialY: initialGeometry.y,
    initialRotation: initialGeometry.rotation,
    hasMoved: false,
  }
}

export function getScalePreviewGeometry(
  session: TransformScaleSession,
  event: MouseEvent,
  previewTransform: PreviewTransformState,
  canvasDisplaySize: Size2D,
  canvasResolution: Size2D,
) {
  const stageDelta = screenDeltaToStageDelta(
    event.clientX - session.startX,
    event.clientY - session.startY,
    previewTransform,
  )
  const canvasDelta = domDeltaToCanvasDelta(
    stageDelta.x,
    stageDelta.y,
    canvasDisplaySize,
    canvasResolution,
  )

  return calculateScaledSize({
    initialWidth: session.initialWidth,
    initialHeight: session.initialHeight,
    initialX: session.initialX,
    initialY: session.initialY,
    deltaX: canvasDelta.x,
    deltaY: canvasDelta.y,
    handlePosition: session.handlePosition!,
    isProportional: session.isProportional,
    elementRotation: session.initialRotation,
  })
}

export function createTransformRotationSession(
  startEvent: RotateStartEventPayload,
  initialRotation: number,
): TransformRotationSession {
  return {
    isRotating: true,
    startX: startEvent.clientX,
    startY: startEvent.clientY,
    initialRotation,
    centerPoint: startEvent.centerPoint,
    hasMoved: false,
  }
}

export function getRotationPreviewAngle(
  session: TransformRotationSession,
  event: MouseEvent,
  containerRect: DOMRect,
  stageCenter: { x: number; y: number },
  previewTransform: PreviewTransformState,
  canvasResolution: Size2D,
  canvasDisplaySize: Size2D,
  containerSize: Size2D,
) {
  const stagePoint = screenPointToStagePoint(
    event.clientX - containerRect.left,
    event.clientY - containerRect.top,
    stageCenter,
    previewTransform,
  )

  const canvasPoint = domToCanvasCoordinates(
    stagePoint.x,
    stagePoint.y,
    canvasResolution,
    canvasDisplaySize,
    containerSize,
  )

  return calculateRotationAngle(
    canvasPoint.x,
    canvasPoint.y,
    session.centerPoint!.x,
    session.centerPoint!.y,
  )
}
