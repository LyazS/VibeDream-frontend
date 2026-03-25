/**
 * 变换数学计算工具
 * 提供缩放和旋转的数学计算功能
 */

import { degreesToRadians } from './rotationTransform'

export interface ScaleCalculationOptions {
  initialWidth: number
  initialHeight: number
  initialX: number
  initialY: number
  deltaX: number
  deltaY: number
  handlePosition: string
  isProportional?: boolean
  elementRotation?: number
}

export interface ScaleResult {
  width: number
  height: number
  x?: number
  y?: number
}

/**
 * 最小尺寸限制
 */
const MIN_SIZE = 10

/**
 * 计算缩放后的尺寸和位置
 */
export function calculateScaledSize(options: ScaleCalculationOptions): ScaleResult {
  const {
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    deltaX,
    deltaY,
    handlePosition,
    isProportional = false,
    elementRotation = 0,
  } = options

  // 如果元素有旋转，先将增量反向旋转到元素的局部坐标系
  let localDeltaX = deltaX
  let localDeltaY = deltaY

  if (elementRotation !== 0) {
    const rotated = scaleWithRotation(deltaX, deltaY, elementRotation)
    // elementRotation 现在是角度，scaleWithRotation 内部会转换
    localDeltaX = rotated.deltaX
    localDeltaY = rotated.deltaY
  }

  // 根据控制点位置计算新的尺寸和位置
  let newWidth = initialWidth
  let newHeight = initialHeight
  let localOffsetX = 0
  let localOffsetY = 0

  // 局部坐标系与项目坐标系一致：X 向右为正，Y 向上为正。
  // 角点缩放 - 保持对角点固定
  if (handlePosition === 'top-left') {
    // 拖拽左上角，右下角固定
    if (isProportional) {
      const scale = 1 - (localDeltaX - localDeltaY) / (initialWidth + initialHeight)
      newWidth = Math.max(MIN_SIZE, initialWidth * scale)
      newHeight = Math.max(MIN_SIZE, initialHeight * scale)
    } else {
      newWidth = Math.max(MIN_SIZE, initialWidth - localDeltaX * 2)
      newHeight = Math.max(MIN_SIZE, initialHeight + localDeltaY * 2)
    }
    // 右下角固定，所以中心向左上移动
    localOffsetX = -(newWidth - initialWidth) / 2
    localOffsetY = (newHeight - initialHeight) / 2
  } else if (handlePosition === 'top-right') {
    // 拖拽右上角，左下角固定
    if (isProportional) {
      const scale = 1 + (localDeltaX + localDeltaY) / (initialWidth + initialHeight)
      newWidth = Math.max(MIN_SIZE, initialWidth * scale)
      newHeight = Math.max(MIN_SIZE, initialHeight * scale)
    } else {
      newWidth = Math.max(MIN_SIZE, initialWidth + localDeltaX * 2)
      newHeight = Math.max(MIN_SIZE, initialHeight + localDeltaY * 2)
    }
    // 左下角固定，所以中心向右上移动
    localOffsetX = (newWidth - initialWidth) / 2
    localOffsetY = (newHeight - initialHeight) / 2
  } else if (handlePosition === 'bottom-left') {
    // 拖拽左下角，右上角固定
    if (isProportional) {
      const scale = 1 - (localDeltaX + localDeltaY) / (initialWidth + initialHeight)
      newWidth = Math.max(MIN_SIZE, initialWidth * scale)
      newHeight = Math.max(MIN_SIZE, initialHeight * scale)
    } else {
      newWidth = Math.max(MIN_SIZE, initialWidth - localDeltaX * 2)
      newHeight = Math.max(MIN_SIZE, initialHeight - localDeltaY * 2)
    }
    // 右上角固定，所以中心向左下移动
    localOffsetX = -(newWidth - initialWidth) / 2
    localOffsetY = -(newHeight - initialHeight) / 2
  } else if (handlePosition === 'bottom-right') {
    // 拖拽右下角，左上角固定
    if (isProportional) {
      const scale = 1 + (localDeltaX - localDeltaY) / (initialWidth + initialHeight)
      newWidth = Math.max(MIN_SIZE, initialWidth * scale)
      newHeight = Math.max(MIN_SIZE, initialHeight * scale)
    } else {
      newWidth = Math.max(MIN_SIZE, initialWidth + localDeltaX * 2)
      newHeight = Math.max(MIN_SIZE, initialHeight - localDeltaY * 2)
    }
    // 左上角固定，所以中心向右下移动
    localOffsetX = (newWidth - initialWidth) / 2
    localOffsetY = -(newHeight - initialHeight) / 2
  }
  // 边中点缩放 - 保持对边固定
  else if (handlePosition === 'top') {
    // 拖拽顶边，底边固定
    newHeight = Math.max(MIN_SIZE, initialHeight + localDeltaY * 2)
    localOffsetY = (newHeight - initialHeight) / 2
  } else if (handlePosition === 'bottom') {
    // 拖拽底边，顶边固定
    newHeight = Math.max(MIN_SIZE, initialHeight - localDeltaY * 2)
    localOffsetY = -(newHeight - initialHeight) / 2
  } else if (handlePosition === 'left') {
    // 拖拽左边，右边固定
    newWidth = Math.max(MIN_SIZE, initialWidth - localDeltaX * 2)
    localOffsetX = -(newWidth - initialWidth) / 2
  } else if (handlePosition === 'right') {
    // 拖拽右边，左边固定
    newWidth = Math.max(MIN_SIZE, initialWidth + localDeltaX * 2)
    localOffsetX = (newWidth - initialWidth) / 2
  }

  // 如果元素有旋转，需要将局部坐标系的位置偏移转换回全局坐标系
  let newX = initialX
  let newY = initialY

  if (elementRotation !== 0 && (localOffsetX !== 0 || localOffsetY !== 0)) {
    // `rotation` 继续维持现有用户体感：正值表现为顺时针。
    // 在 Y 向上的项目坐标系中，局部 -> 全局需要使用负角度做标准旋转。
    const rotationRadians = degreesToRadians(-elementRotation)
    const cos = Math.cos(rotationRadians)
    const sin = Math.sin(rotationRadians)
    const globalOffsetX = localOffsetX * cos - localOffsetY * sin
    const globalOffsetY = localOffsetX * sin + localOffsetY * cos

    newX = initialX + globalOffsetX
    newY = initialY + globalOffsetY
  } else {
    // 没有旋转时，直接使用局部偏移
    newX = initialX + localOffsetX
    newY = initialY + localOffsetY
  }

  return {
    width: newWidth,
    height: newHeight,
    x: newX,
    y: newY,
  }
}

/**
 * 考虑元素旋转的缩放计算
 * 将鼠标增量反向旋转，对齐到元素的局部坐标系
 */
export function scaleWithRotation(
  deltaX: number,
  deltaY: number,
  elementRotation: number
): { deltaX: number; deltaY: number } {
  // 这里要把全局增量逆变换到元素局部坐标系。
  // `rotation` 正值仍表示顺时针，因此逆变换使用正角度的标准旋转矩阵。
  const rotationRadians = degreesToRadians(elementRotation)
  const cos = Math.cos(rotationRadians)
  const sin = Math.sin(rotationRadians)

  const localDeltaX = deltaX * cos - deltaY * sin
  const localDeltaY = deltaX * sin + deltaY * cos

  return { deltaX: localDeltaX, deltaY: localDeltaY }
}

/**
 * 计算旋转角度
 * @param mouseX 鼠标X坐标（Canvas坐标系）
 * @param mouseY 鼠标Y坐标（Canvas坐标系）
 * @param centerX 旋转中心X坐标（Canvas坐标系）
 * @param centerY 旋转中心Y坐标（Canvas坐标系）
 * @returns 旋转角度（角度制，范围：-180° 到 180°）
 */
export function calculateRotationAngle(
  mouseX: number,
  mouseY: number,
  centerX: number,
  centerY: number
): number {
  // 项目坐标已切到 Y 向上为正，但用户仍期望正角是顺时针、0° 在正上方。
  const angleRadians = Math.atan2(mouseY - centerY, mouseX - centerX)
  const adjustedRadians = Math.PI / 2 - angleRadians

  // 转换为角度，不进行标准化，保持连续性
  const degrees = (adjustedRadians * 180) / Math.PI

  // 标准化到 -180 到 180 范围，但保持平滑过渡
  let normalized = degrees % 360
  if (normalized > 180) {
    normalized -= 360
  } else if (normalized < -180) {
    normalized += 360
  }

  return normalized
}

/**
 * 标准化角度到 -π 到 π 范围
 */
export function normalizeRadians(radians: number): number {
  let normalized = radians % (2 * Math.PI)
  if (normalized > Math.PI) {
    normalized -= 2 * Math.PI
  } else if (normalized < -Math.PI) {
    normalized += 2 * Math.PI
  }
  return normalized
}

/**
 * 计算旋转后的轴对齐边界框（AABB）
 * 用于某些特殊情况的碰撞检测
 */
export function getAABB(
  width: number,
  height: number,
  rotation: number  // 现在接收角度值
): { width: number; height: number } {
  const rotationRadians = degreesToRadians(rotation)
  const cos = Math.abs(Math.cos(rotationRadians))
  const sin = Math.abs(Math.sin(rotationRadians))

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}
