/**
 * 统一时间轴工具函数
 * 适配自旧架构的 timeUtils，支持统一类型系统
 */

import type { Ref, WritableComputedRef } from 'vue'
import { TimeConstants } from '@/constants/TimeConstants'

// ==================== 时间码系统常量 ====================
// 使用 TimeConstants.FRAME_RATE 替代

// ==================== 时间计算工具 ====================

/**
 * 计算每帧像素数（帧数版本）
 * @param timelineWidth 时间轴宽度（像素）
 * @param totalDurationFrames 总时长（帧数）
 * @param zoomLevel 缩放级别
 * @returns 每帧像素数
 */
export function calculatePixelsPerFrame(
  timelineWidth: number,
  totalDurationFrames: number,
  zoomLevel: number,
): number {
  return (timelineWidth * zoomLevel) / totalDurationFrames
}

/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @param precision 小数位数（默认为1）
 * @returns 格式化的文件大小字符串
 */
export function formatFileSize(bytes: number, precision: number = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(precision)) + ' ' + sizes[i]
}

// ==================== 时间码转换函数 ====================

/**
 * 帧数转换为秒数
 * @param frames 帧数
 * @returns 秒数
 */
export function framesToSeconds(frames: number): number {
  return frames / TimeConstants.FRAME_RATE
}

/**
 * 秒数转换为帧数
 * @param seconds 秒数
 * @returns 帧数（向下取整）
 */
export function secondsToFrames(seconds: number): number {
  return Math.floor(seconds * TimeConstants.FRAME_RATE)
}

/**
 * 帧数转换为微秒
 * @param frames 帧数
 * @returns 微秒数
 */
export function framesToMicroseconds(frames: number): number {
  // 使用更精确的计算，避免精度丢失
  return Math.floor((frames / TimeConstants.FRAME_RATE) * 1_000_000)
}

/**
 * 微秒转换为帧数
 * @param microseconds 微秒数
 * @returns 帧数（四舍五入到最近整数）
 */
export function microsecondsToFrames(microseconds: number): number {
  // 直接四舍五入，避免精度问题
  return Math.round((microseconds / 1_000_000) * TimeConstants.FRAME_RATE)
}

/**
 * 帧数转换为时间码字符串
 * @param frames 帧数
 * @returns 时间码字符串 "HH:MM:SS+FF"
 */
export function framesToTimecode(frames: number): string {
  const totalSeconds = Math.floor(frames / TimeConstants.FRAME_RATE)
  const remainingFrames = frames % TimeConstants.FRAME_RATE

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}+${remainingFrames.toString().padStart(2, '0')}`
}

/**
 * 帧数转换为压缩时间码字符串（小时为0时不显示小时）
 * @param frames 帧数
 * @returns 时间码字符串 "MM:SS+FF" 或 "HH:MM:SS+FF"
 */
export function framesToTimecodeCompact(frames: number): string {
  const totalSeconds = Math.floor(frames / TimeConstants.FRAME_RATE)
  const remainingFrames = frames % TimeConstants.FRAME_RATE

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}+${remainingFrames.toString().padStart(2, '0')}`
  }
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}+${remainingFrames.toString().padStart(2, '0')}`
}

/**
 * 时间码字符串转换为帧数
 * @param timecode 时间码字符串 "HH:MM:SS+FF"
 * @returns 帧数
 * @throws Error 如果时间码格式无效
 */
export function timecodeToFrames(timecode: string): number {
  const match = timecode.match(/^(\d{2}):(\d{2}):(\d{2})\+(\d{2})$/)
  if (!match) {
    throw new Error(`Invalid timecode format: ${timecode}. Expected format: HH:MM:SS+FF`)
  }

  const [, hours, minutes, seconds, frames] = match.map(Number)

  // 验证范围
  if (minutes >= 60 || seconds >= 60 || frames >= TimeConstants.FRAME_RATE) {
    throw new Error(`Invalid timecode values: ${timecode}`)
  }

  return (hours * 3600 + minutes * 60 + seconds) * TimeConstants.FRAME_RATE + frames
}

/**
 * 将帧数对齐到整数帧
 * @param frames 帧数
 * @returns 对齐后的帧数（整数）
 */
export function alignFramesToFrame(frames: number): number {
  return Math.floor(frames)
}

