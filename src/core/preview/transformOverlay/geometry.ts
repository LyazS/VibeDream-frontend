import type { PreviewTransformState, Size2D } from './types'
import type { VisualProps } from '@/core/timelineitem/model/render'
import { degreesToRadians } from '@/core/utils/rotationTransform'

export function convertCanvasToDOM(
  config: VisualProps,
  canvasResolution: Size2D,
  canvasDisplaySize: Size2D,
  containerSize: Size2D,
) {
  if (canvasResolution.width === 0 || canvasResolution.height === 0) {
    return { left: 0, top: 0, width: 0, height: 0, rotation: 0 }
  }
  if (config.width === 0 || config.height === 0) {
    return { left: 0, top: 0, width: 0, height: 0, rotation: 0 }
  }

  const scaleX = canvasDisplaySize.width / canvasResolution.width
  const scaleY = canvasDisplaySize.height / canvasResolution.height

  const canvasX = (config.x + canvasResolution.width / 2) * scaleX
  const canvasY = (canvasResolution.height / 2 - config.y) * scaleY

  const offsetX = (containerSize.width - canvasDisplaySize.width) / 2
  const offsetY = (containerSize.height - canvasDisplaySize.height) / 2

  const domX = canvasX + offsetX
  const domY = canvasY + offsetY

  const domWidth = config.width * scaleX
  const domHeight = config.height * scaleY

  return {
    left: domX - domWidth / 2,
    top: domY - domHeight / 2,
    width: domWidth,
    height: domHeight,
    rotation: degreesToRadians(config.rotation),
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function screenPointToStagePoint(
  domX: number,
  domY: number,
  stageCenter: { x: number; y: number },
  previewTransform: PreviewTransformState,
) {
  return {
    x:
      stageCenter.x + (domX - stageCenter.x - previewTransform.offsetX) / previewTransform.zoom,
    y:
      stageCenter.y + (domY - stageCenter.y - previewTransform.offsetY) / previewTransform.zoom,
  }
}

export function screenDeltaToStageDelta(
  deltaX: number,
  deltaY: number,
  previewTransform: PreviewTransformState,
) {
  return {
    x: deltaX / previewTransform.zoom,
    y: deltaY / previewTransform.zoom,
  }
}
