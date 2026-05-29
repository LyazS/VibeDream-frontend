/**
 * BLTCY文件上传工具
 * 封装BLTCY文件上传的流程
 */

import { cloneDeep } from 'lodash'
import { exportMediaItem, exportTimelineItem } from './itemExporter'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import type { MediaType } from '@/core/mediaitem'

// API 配置
// 无额度的key
const API_KEY = 'sk-VtfYTW3bkuY6F4gUwlDvZzjWFnnXXh9XQZUhzpHqDeWJlXkP'
const BASE_URL = 'https://api.bltcy.ai'

// 上传响应数据
interface UploadResponseData {
  id: string
  url?: string
  [key: string]: any
}

// 上传结果接口
interface UploadResult {
  success: boolean
  id?: string
  url?: string
  data?: UploadResponseData
  error?: string
}

// 上传选项
interface UploadOptions {
  onProgress?: (progress: number) => void
}

export class BltcyFileUploader {
  /**
   * 上传文件到BLTCY
   */
  private static async uploadToBltcy(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResponseData> {
    const formData = new FormData()
    formData.append('file', file)

    // 模拟进度（因为 fetch 不支持进度回调）
    if (onProgress) {
      onProgress(0)
    }

    const response = await fetch(`${BASE_URL}/v1/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      body: formData,
    })

    if (onProgress) {
      onProgress(100)
    }

    if (!response.ok) {
      throw new Error(`上传失败: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * 单个文件上传
   */
  static async uploadFile(file: File, options?: UploadOptions): Promise<UploadResult> {
    try {
      const data = await this.uploadToBltcy(file, options?.onProgress)

      return {
        success: true,
        id: data.id,
        url: data.url,
        data,
      }
    } catch (error) {
      console.error('文件上传失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '上传失败',
      }
    }
  }

  /**
   * 批量上传文件
   */
  static async uploadFiles(
    files: File[],
    onProgress?: (fileIndex: number, progress: number) => void,
  ): Promise<Map<number, UploadResult>> {
    const results = new Map<number, UploadResult>()

    for (let i = 0; i < files.length; i++) {
      const result = await this.uploadFileWithRetry(
        files[i],
        3, // 最多重试3次
        (progress) => onProgress?.(i, progress),
      )
      results.set(i, result)
    }

    return results
  }

  /**
   * 带重试的上传方法
   */
  static async uploadFileWithRetry(
    file: File,
    maxRetries: number = 3,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.uploadFile(file, { onProgress })
      } catch (error) {
        lastError = error as Error
        console.warn(`上传失败(尝试 ${attempt}/${maxRetries}):`, error)

        if (attempt < maxRetries) {
          // 等待后重试(指数退避)
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
        }
      }
    }

    return {
      success: false,
      error: `上传失败(已重试${maxRetries}次): ${lastError?.message}`,
    }
  }

  /**
   * 从URL上传文件
   */
  static async uploadFromUrl(
    url: string,
    fileName?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      // 获取文件内容
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`获取文件失败: ${response.status}`)
      }

      const blob = await response.blob()
      const name = fileName || url.split('/').pop() || 'file'
      const file = new File([blob], name, { type: blob.type })

      return this.uploadFile(file, options)
    } catch (error) {
      console.error('从URL上传失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '从URL上传失败',
      }
    }
  }

  /**
   * 从FileData导出Blob
   */
  private static async exportFileDataToBlob(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
  ): Promise<Blob> {
    if (fileData.source === 'media-item') {
      const mediaItem = getMediaItem(fileData.mediaItemId!)
      if (!mediaItem) {
        throw new Error(`找不到媒体项: ${fileData.mediaItemId}`)
      }
      return await exportMediaItem({ mediaItem })
    } else {
      // timeline-item
      const timelineItem = getTimelineItem(fileData.timelineItemId!)
      if (!timelineItem) {
        throw new Error(`找不到时间轴项: ${fileData.timelineItemId}`)
      }
      return await exportTimelineItem({
        timelineItem,
        getMediaItem,
      })
    }
  }

  /**
   * 上传FileData
   */
  static async uploadFileData(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    try {
      const blob = await this.exportFileDataToBlob(fileData, getMediaItem, getTimelineItem)
      const file = new File([blob], fileData.name, { type: blob.type })
      return this.uploadFile(file, { onProgress })
    } catch (error) {
      console.error('FileData上传失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'FileData上传失败',
      }
    }
  }

  /**
   * 管道函数：处理配置中的文件上传
   * 整合检测、上传和更新配置的完整流程
   *
   * @param config AI配置对象
   * @param getMediaItem 获取媒体项的函数
   * @param getTimelineItem 获取时间轴项的函数
   * @param onProgress 进度回调
   * @param onSuccess 上传成功回调
   * @returns 新配置对象
   */
  static async processConfigUploads(
    config: Record<string, any>,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (fileIndex: number, stage: string, progress: number) => void,
    onSuccess?: () => void,
  ): Promise<Record<string, any>> {
    // 1. 深度克隆配置，避免修改原对象
    const newConfig = cloneDeep(config)

    // 2. 检测需要上传的文件
    const filesToUpload: FileData[] = []

    for (const [key, value] of Object.entries(newConfig)) {
      if (Array.isArray(value) && value.length > 0) {
        // 使用 __type__ 字段检测 FileData
        if (value[0] && typeof value[0] === 'object' && value[0].__type__ === 'FileData') {
          filesToUpload.push(...value)
        }
      }
    }

    if (filesToUpload.length === 0) {
      return newConfig
    }

    // 3. 批量上传文件
    const uploadResults = await this.uploadFileDatas(
      filesToUpload,
      getMediaItem,
      getTimelineItem,
      onProgress,
    )

    // 4. 检查上传结果
    for (const [index, result] of uploadResults.entries()) {
      if (!result.success) {
        throw new Error(`文件上传失败: ${result.error}`)
      }
    }

    // 5. 如果有文件上传成功，调用成功回调
    if (uploadResults.size > 0 && onSuccess) {
      onSuccess()
    }

    // 6. 更新新配置中的URL
    let fileIndex = 0
    for (const [key, value] of Object.entries(newConfig)) {
      if (Array.isArray(value) && value.length > 0) {
        if (value[0] && typeof value[0] === 'object' && value[0].__type__ === 'FileData') {
          // 这是FileData数组,替换为URL数组
          newConfig[key] = value.map((_, index) => {
            const result = uploadResults.get(fileIndex + index)
            return result?.url || ''
          })
          fileIndex += value.length
        }
      }
    }

    return newConfig
  }

  /**
   * 批量上传FileData
   */
  static async uploadFileDatas(
    fileDatas: FileData[],
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (fileIndex: number, stage: string, progress: number) => void,
  ): Promise<Map<number, UploadResult>> {
    const results = new Map<number, UploadResult>()

    for (let i = 0; i < fileDatas.length; i++) {
      const result = await this.uploadFileDataWithRetry(
        fileDatas[i],
        getMediaItem,
        getTimelineItem,
        3, // 最多重试3次
        (progress) => onProgress?.(i, '上传中', progress),
      )
      results.set(i, result)
    }

    return results
  }

  /**
   * 带重试的FileData上传方法
   */
  static async uploadFileDataWithRetry(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    maxRetries: number = 3,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.uploadFileData(fileData, getMediaItem, getTimelineItem, onProgress)
      } catch (error) {
        lastError = error as Error
        console.warn(`上传失败(尝试 ${attempt}/${maxRetries}):`, error)

        if (attempt < maxRetries) {
          // 等待后重试(指数退避)
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
        }
      }
    }

    return {
      success: false,
      error: `上传失败(已重试${maxRetries}次): ${lastError?.message}`,
    }
  }
}
