/**
 * ID生成器工具
 * 提供统一的唯一ID生成方法
 */

import { nanoid } from 'nanoid'

/**
 * 生成唯一ID
 * 使用时间戳和nanoid组合，确保唯一性
 * @returns 唯一ID字符串（格式：timestamp_nanoid）
 */
export function generateId(): string {
  return `${Date.now()}_${nanoid(12)}`
}

/**
 * 生成带前缀的唯一ID
 * @param prefix ID前缀
 * @returns 带前缀的唯一ID字符串
 */
export function generateIdWithPrefix(prefix: string): string {
  return `${prefix}_${generateId()}`
}

/**
 * 生成命令ID
 * 专门用于历史记录命令的ID生成
 * @returns 命令ID字符串
 */
export function generateCommandId(): string {
  return generateIdWithPrefix('cmd')
}

/**
 * 生成UUID4格式的唯一ID
 * 使用crypto.randomUUID()或回退到自定义实现
 * @returns UUID4格式的字符串
 */
export function generateUUID4(): string {
  // 优先使用浏览器原生的crypto.randomUUID()
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // 回退到自定义UUID4实现
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * 生成轨道ID
 * 使用nanoid确保短小且唯一
 * @returns 带 'track_' 前缀的12字符nanoid字符串
 */
export function generateTrackId(): string {
  return `track_${nanoid(12)}`
}

/**
 * 生成带扩展名的媒体 ID
 * @param extension 文件扩展名（如 ".mp4"）
 * @returns 完整 ID（如 "media_V1StGXR8_Z5j.mp4"）
 */
export function generateMediaId(extension: string): string {
  const nanoId = nanoid(12) // 生成12字符的 nanoid
  // 确保扩展名以 . 开头
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  return `media_${nanoId}${ext}`
}

/**
 * 生成通用资产 ID
 */
export function generateAssetId(prefix: 'asset' | 'effect', extension?: string): string {
  const nanoId = nanoid(12)
  if (!extension) {
    return `${prefix}_${nanoId}`
  }

  const ext = extension.startsWith('.') ? extension : `.${extension}`
  return `${prefix}_${nanoId}${ext}`
}

/**
 * 从文件名提取扩展名
 * @param fileName 文件名
 * @returns 扩展名（包含点，如 ".mp4"）
 */
export function extractExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : ''
}

/**
 * 从 ID 提取扩展名
 * @param id 媒体 ID（如 "V1StGXR8_Z5j.mp4"）
 * @returns 扩展名（如 ".mp4"）
 */
export function extractExtensionFromId(id: string): string {
  return extractExtension(id)
}

/**
 * 从 ID 提取纯 nanoid 部分
 * @param id 媒体 ID（如 "V1StGXR8_Z5j.mp4"）
 * @returns nanoid 部分（如 "V1StGXR8_Z5j"）
 */
export function extractNanoId(id: string): string {
  const lastDotIndex = id.lastIndexOf('.')
  return lastDotIndex !== -1 ? id.substring(0, lastDotIndex) : id
}

/**
 * 解析 ID 为 nanoid 和扩展名
 * @param id 媒体 ID
 * @returns { nanoid, extension }
 */
export function parseMediaId(id: string): { nanoid: string; extension: string } {
  return {
    nanoid: extractNanoId(id),
    extension: extractExtensionFromId(id),
  }
}

/**
 * 生成时间轴项目ID
 * 使用nanoid确保短小且唯一
 * @returns 带 'item_' 前缀的12字符nanoid字符串
 */
export function generateTimelineItemId(): string {
  return `item_${nanoid(12)}`
}

/**
 * 生成批量命令ID
 * 用于批量操作的唯一标识
 * 使用时间戳+随机数确保唯一性
 * @returns 批量命令ID字符串
 */
export function generateBatchCommandId(): string {
  return generateIdWithPrefix('batch')
}

/**
 * 生成目录ID
 * 使用nanoid确保短小且唯一
 * @returns 带 'dir_' 前缀的12字符nanoid字符串
 */
export function generateDirectoryId(): string {
  return `dir_${nanoid(12)}`
}

/**
 * 生成标签页ID
 * 使用nanoid确保短小且唯一
 * @returns 带 'tab_' 前缀的12字符nanoid字符串
 */
export function generateTabId(): string {
  return `tab_${nanoid(12)}`
}

/**
 * 生成 Agent 消息 ID
 * 使用时间戳确保按时间排序
 * @param type 消息类型前缀
 * @returns Agent 消息 ID 字符串
 */
export function generateAgentMessageId(type: string): string {
  return `${type}-${Date.now()}`
}
