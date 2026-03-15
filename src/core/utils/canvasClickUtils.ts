/**
 * Canvas 点击检测工具函数
 */

import { degreesToRadians } from './rotationTransform'

interface Point2D {
  x: number
  y: number
}

interface Size2D {
  width: number
  height: number
}

/**
 * DOM 坐标转 Canvas 坐标（逆向转换）
 *
 * 坐标系统说明：
 * - DOM 坐标：左上角为原点 (0, 0)，向右向下为正
 * - Canvas 坐标：中心为原点 (0, 0)，向右向下为正
 *
 * 转换步骤：
 * 1. DOM坐标 → Canvas显示坐标（减去居中偏移）
 * 2. Canvas显示坐标 → Canvas内部坐标（除以缩放比例）
 * 3. Canvas内部坐标 → Canvas中心坐标（减去中心点偏移）
 *
 * @param domX DOM 坐标 X（相对于容器左上角）
 * @param domY DOM 坐标 Y（相对于容器左上角）
 * @param canvasResolution Canvas 原始分辨率
 * @param canvasDisplaySize Canvas 显示尺寸
 * @param containerSize 容器尺寸
 * @returns Canvas 中心坐标系中的坐标
 */
export function domToCanvasCoordinates(
  domX: number,
  domY: number,
  canvasResolution: Size2D,
  canvasDisplaySize: Size2D,
  containerSize: Size2D,
): Point2D {
  // 边界检查
  if (canvasResolution.width === 0 || canvasResolution.height === 0) {
    return { x: 0, y: 0 }
  }

  // 1. 计算缩放比例
  const scaleX = canvasDisplaySize.width / canvasResolution.width
  const scaleY = canvasDisplaySize.height / canvasResolution.height

  // 2. 计算 Canvas 在容器中的居中偏移
  const offsetX = (containerSize.width - canvasDisplaySize.width) / 2
  const offsetY = (containerSize.height - canvasDisplaySize.height) / 2

  // 3. 转换到 Canvas 显示坐标（减去居中偏移）
  const canvasDisplayX = domX - offsetX
  const canvasDisplayY = domY - offsetY

  // 4. 转换到 Canvas 内部坐标（除以缩放比例）
  const canvasInternalX = canvasDisplayX / scaleX
  const canvasInternalY = canvasDisplayY / scaleY

  // 5. 转换到 Canvas 中心坐标（减去中心点偏移）
  // Canvas 内部坐标原点在左上角，中心坐标原点在画布中心
  const canvasCenterX = canvasInternalX - canvasResolution.width / 2
  const canvasCenterY = canvasInternalY - canvasResolution.height / 2

  return { x: canvasCenterX, y: canvasCenterY }
}

/**
 * 判断点是否在元素的边界框内（简化检测，不考虑旋转）
 *
 * @param point 点击点（Canvas 中心坐标）
 * @param elementBox 元素边界框（Canvas 中心坐标）
 * @returns 是否在边界框内
 */
export function isPointInBoundingBox(
  point: Point2D,
  elementBox: {
    x: number
    y: number
    width: number
    height: number
  },
): boolean {
  const halfW = elementBox.width / 2
  const halfH = elementBox.height / 2

  return (
    point.x >= elementBox.x - halfW &&
    point.x <= elementBox.x + halfW &&
    point.y >= elementBox.y - halfH &&
    point.y <= elementBox.y + halfH
  )
}

/**
 * 判断点是否在旋转后的矩形内
 *
 * 原理：将点击点坐标逆旋转到元素的局部坐标系，然后在局部坐标系中进行边界检测
 *
 * @param point 点击点（Canvas 中心坐标）
 * @param elementBox 元素边界框（Canvas 中心坐标），包含旋转角度（弧度）
 * @returns 是否在旋转后的边界框内
 */
export function isPointInRotatedBoundingBox(
  point: Point2D,
  elementBox: {
    x: number
    y: number
    width: number
    height: number
    rotation: number // 角度值
  },
): boolean {
  // 1. 计算点击点相对于元素中心的偏移
  const dx = point.x - elementBox.x
  const dy = point.y - elementBox.y

  // 2. 逆旋转：将点击点转换到元素的局部坐标系
  const rotationRadians = degreesToRadians(elementBox.rotation)
  const cos = Math.cos(-rotationRadians)
  const sin = Math.sin(-rotationRadians)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  // 3. 在局部坐标系中进行边界检测
  const halfW = elementBox.width / 2
  const halfH = elementBox.height / 2

  return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH
}

/**
 * 将 DOM 移动增量转换为 Canvas 位置增量
 *
 * @param domDeltaX DOM 坐标系 X 方向移动量
 * @param domDeltaY DOM 坐标系 Y 方向移动量
 * @param canvasDisplaySize Canvas 显示尺寸
 * @param canvasResolution Canvas 分辨率
 * @returns Canvas 中心坐标系中的位置增量
 */
export function domDeltaToCanvasDelta(
  domDeltaX: number,
  domDeltaY: number,
  canvasDisplaySize: Size2D,
  canvasResolution: Size2D,
): Point2D {
  // 边界检查
  if (canvasResolution.width === 0 || canvasResolution.height === 0) {
    return { x: 0, y: 0 }
  }

  // 计算缩放比例
  const scaleX = canvasDisplaySize.width / canvasResolution.width
  const scaleY = canvasDisplaySize.height / canvasResolution.height

  // 将 DOM 增量除以缩放比例得到 Canvas 增量
  return {
    x: domDeltaX / scaleX,
    y: domDeltaY / scaleY,
  }
}
