/**
 * 旋转角度转换工具
 *
 * 内部使用弧度制 (radians)，范围：-π 到 π
 * UI界面使用角度制 (degrees)，范围：-180° 到 180°
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
 * 将角度转换为弧度
 * @param degrees 角度值（任意值，会自动标准化到 -180 到 180）
 * @returns 弧度值 (-π 到 π)
 */
export function degreesToRadians(degrees: number): number {
  // 先标准化角度，然后转换为弧度
  const normalizedDegrees = normalizeAngle(degrees)
  return (normalizedDegrees * Math.PI) / 180
}

/**
 * 将弧度转换为角度
 * @param radians 弧度值 (-π 到 π)
 * @returns 角度值 (-180 到 180)
 */
export function radiansToDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI
  // 限制角度范围在 -180 到 180 之间
  return Math.max(-180, Math.min(180, degrees))
}

/**
 * 将UI界面的角度值转换为内部弧度值
 * 用于：属性面板输入 → 内部旋转属性
 * @param uiDegrees 界面输入的角度值（任意值，如 450°、-270° 等）
 * @returns 内部使用的弧度值（自动标准化到 -π 到 π）
 */
export function uiDegreesToRotationRadians(uiDegrees: number): number {
  return degreesToRadians(uiDegrees)
}

/**
 * 将内部弧度值转换为UI界面的角度值
 * 用于：内部旋转属性 → 属性面板显示
 * @param rotationRadians 内部的弧度值
 * @returns 界面显示的角度值
 */
export function rotationRadiansToUIDegrees(rotationRadians: number): number {
  return radiansToDegrees(rotationRadians)
}

/**
 * 验证角度值是否在有效范围内
 * @param degrees 角度值
 * @returns 是否有效
 */
export function isValidDegrees(degrees: number): boolean {
  return degrees >= -180 && degrees <= 180 && !isNaN(degrees)
}

/**
 * 验证弧度值是否在有效范围内
 * @param radians 弧度值
 * @returns 是否有效
 */
export function isValidRadians(radians: number): boolean {
  return radians >= -Math.PI && radians <= Math.PI && !isNaN(radians)
}
