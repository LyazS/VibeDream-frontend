/**
 * 旋转角度转换工具
 *
 * 存储与 UI：角度制 (degrees)，允许任意有限值，用于保留多圈关键帧旋转。
 * 渲染/计算：使用 degreesToRadians() 转换为等效弧度。
 */

/**
 * 将任意角度标准化到 -180 到 180 范围内
 * @param degrees 任意角度值
 * @returns 标准化后的角度值 (-180 到 180)
 */
export function normalizeAngle(degrees: number): number {
  // 将角度标准化到 -180 到 180 范围内
  let normalized = degrees % 360
  if (normalized > 180) {
    normalized -= 360
  } else if (normalized < -180) {
    normalized += 360
  }
  return normalized
}

/**
 * 将媒体顺时针旋转角度收敛到 0 / 90 / 180 / 270。
 * 非 90 度步进的值统一按 0 处理。
 */
export function normalizeClockwiseRotation(rotation: number): number {
  const normalized = normalizeAngle(rotation)
  if (normalized === 0 || normalized === 90) {
    return normalized
  }
  if (normalized === 180 || normalized === -180) {
    return 180
  }
  if (normalized === -90) {
    return 270
  }
  return 0
}

/**
 * 将角度转换为弧度（用于渲染/计算层）
 * @param degrees 角度值
 * @returns 弧度值
 */
export function degreesToRadians(degrees: number): number {
  const normalizedDegrees = normalizeAngle(degrees)
  return (normalizedDegrees * Math.PI) / 180
}

/**
 * 将弧度转换为角度（如有需要）
 * @param radians 弧度值
 * @returns 角度值 (-180 到 180)
 */
export function radiansToDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI
  return Math.max(-180, Math.min(180, degrees))
}

/**
 * 验证角度值是否在有效范围内
 * @param degrees 角度值
 * @returns 是否有效
 */
export function isValidDegrees(degrees: number): boolean {
  return degrees >= -180 && degrees <= 180 && !isNaN(degrees)
}
