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

export interface ContainerPoint {
  x: number
  y: number
}

export type TransformScaleHandleType = 'corner' | 'edge'

export type TransformScaleHandlePosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'

export interface ScaleStartEventPayload {
  handleType: TransformScaleHandleType
  handlePosition: TransformScaleHandlePosition
  isProportional: boolean
  clientX: number
  clientY: number
}

export interface RotateStartEventPayload {
  centerPoint: Point2D
  clientX: number
  clientY: number
}

export interface TransformDragSession {
  isDragging: boolean
  startX: number
  startY: number
  initialCanvasX: number
  initialCanvasY: number
  hasMoved: boolean
}

export interface TransformScaleSession {
  isScaling: boolean
  handleType: TransformScaleHandleType | null
  handlePosition: TransformScaleHandlePosition | null
  isProportional: boolean
  startX: number
  startY: number
  initialWidth: number
  initialHeight: number
  initialX: number
  initialY: number
  initialRotation: number
  hasMoved: boolean
}

export interface TransformRotationSession {
  isRotating: boolean
  startX: number
  startY: number
  initialRotation: number
  centerPoint: Point2D | null
  hasMoved: boolean
}
