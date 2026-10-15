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
 * 生成媒体 ID，文件扩展名由媒体对象单独保存。
 */
export function generateMediaId(): string {
  return `media_${nanoid(12)}`
}

/**
 * 生成通用资产 ID
 */
export function generateAssetId(prefix: 'asset' | 'effect'): string {
  return `${prefix}_${nanoid(12)}`
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
