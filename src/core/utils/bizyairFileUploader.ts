/**
 * 文件上传工具
 * 封装BizyAir文件上传的完整流程
 * 支持代理模式和直接模式
 */

import { exportMediaItem, exportTimelineItem } from './mediaExporter'
import { fetchClient } from '@/utils/fetchClient'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem'
import type { ExportMediaItemOptions } from './mediaExporter'
import { cloneDeep } from 'lodash'
import { useUnifiedStore } from '@/core/unifiedStore'

// ==================== 类型定义 ====================

/**
 * 上传凭证
 */
interface UploadCredentials {
  object_key: string
  access_key_id: string
  access_key_secret: string
  security_token: string
  endpoint: string
  bucket: string
  region: string
}

/**
 * BizyAir API 响应格式
 */
interface BizyAirApiResponse<T> {
  code: number
  message: string
  status: boolean
  data: T
}

/**
 * 获取上传凭证响应
 */
interface UploadTokenResponse {
  file: {
    object_key: string
    access_key_id: string
    access_key_secret: string
    security_token: string
  }
  storage: {
    endpoint: string
    bucket: string
    region: string
  }
}

/**
 * 提交资源响应
 */
interface CommitResourceResponse {
  id: number
  name: string
  ext: string
  url: string
}

/**
 * 上传结果接口
 */
interface UploadResult {
  success: boolean
  url?: string
  object_key?: string
  error?: string
}

export interface UploadFileExportOptions {
  outputWidth?: ExportMediaItemOptions['outputWidth']
  outputHeight?: ExportMediaItemOptions['outputHeight']
  frameRate?: ExportMediaItemOptions['frameRate']
}

// ==================== 策略接口 ====================

/**
 * BizyAir 上传策略接口
 */
interface BizyAirUploadStrategy {
  /**
   * 获取上传凭证
   * @param fileName 文件名（包含扩展名）
   * @param apiKey API Key（直接模式需要）
   * @returns 上传凭证
   */
  getUploadToken(fileName: string, apiKey?: string): Promise<UploadCredentials>
  
  /**
   * 提交资源
   * @param fileName 文件名
   * @param objectKey OSS 对象键
   * @param apiKey API Key（直接模式需要）
   * @returns 资源 URL
   */
  commitResource(fileName: string, objectKey: string, apiKey?: string): Promise<string>
}

// ==================== 代理模式策略 ====================

/**
 * 代理模式上传策略
 * 通过后端代理接口调用 BizyAir API
 */
class ProxyUploadStrategy implements BizyAirUploadStrategy {
  async getUploadToken(fileName: string, apiKey?: string): Promise<UploadCredentials> {
    // apiKey 参数被忽略，使用后端配置的 Key
    const queryParams = new URLSearchParams({
      file_name: fileName,
      file_type: 'inputs',
    })

    const response = await fetchClient.get<{
      success: boolean
      data: {
        file: {
          object_key: string
          access_key_id: string
          access_key_secret: string
          security_token: string
        }
        storage: {
          endpoint: string
          bucket: string
          region: string
        }
      }
      error?: string
    }>(`/api/bizyairupload/token?${queryParams.toString()}`)

    if (!response.data.success) {
      throw new Error(response.data.error || '获取上传凭证失败')
    }

    const { file, storage } = response.data.data
    return {
      object_key: file.object_key,
      access_key_id: file.access_key_id,
      access_key_secret: file.access_key_secret,
      security_token: file.security_token,
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      region: storage.region,
    }
  }

  async commitResource(fileName: string, objectKey: string, apiKey?: string): Promise<string> {
    // apiKey 参数被忽略，使用后端配置的 Key
    const response = await fetchClient.post<{
      success: boolean
      data: { url: string }
      error?: string
    }>('/api/bizyairupload/commit', {
      name: fileName,
      object_key: objectKey,
    })

    if (!response.data.success) {
      throw new Error(response.data.error || '提交资源失败')
    }

    return response.data.data.url
  }
}

// ==================== 直接模式策略 ====================

/**
 * 直接模式上传策略
 * 直接调用 BizyAir API（使用用户的 API Key）
 */
class DirectUploadStrategy implements BizyAirUploadStrategy {
  private readonly apiUrl = 'https://api.bizyair.cn'

  async getUploadToken(fileName: string, apiKey?: string): Promise<UploadCredentials> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('直接模式需要提供 BizyAir API Key')
    }
    
    const url = new URL(`${this.apiUrl}/x/v1/upload/token`)
    url.searchParams.append('file_name', fileName)
    url.searchParams.append('file_type', 'inputs')

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`获取上传凭证失败: ${response.status} ${errorText}`)
    }

    const data: BizyAirApiResponse<UploadTokenResponse> = await response.json()

    if (data.code !== 20000) {
      throw new Error(data.message || '获取上传凭证失败')
    }

    const { file, storage } = data.data
    return {
      object_key: file.object_key,
      access_key_id: file.access_key_id,
      access_key_secret: file.access_key_secret,
      security_token: file.security_token,
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      region: storage.region,
    }
  }

  async commitResource(fileName: string, objectKey: string, apiKey?: string): Promise<string> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('直接模式需要提供 BizyAir API Key')
    }
    
    const response = await fetch(`${this.apiUrl}/x/v1/input_resource/commit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        object_key: objectKey,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`提交资源失败: ${response.status} ${errorText}`)
    }

    const data: BizyAirApiResponse<CommitResourceResponse> = await response.json()

    if (data.code !== 20000) {
      throw new Error(data.message || '提交资源失败')
    }

    return data.data.url
  }
}

// ==================== OSS 上传器 ====================

/**
 * OSS 上传器（两种模式共享）
 */
class OSSUploader {
  /**
   * 上传文件到 OSS
   */
  static async uploadToOSS(
    blob: Blob,
    credentials: UploadCredentials,
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    // 动态导入 OSS 库以实现懒加载
    const OSS = (await import('ali-oss')).default

    // 规范化 region（移除 oss- 前缀）
    const normalizedRegion = credentials.region.startsWith('oss-')
      ? credentials.region.slice(4)
      : credentials.region

    const client = new OSS({
      region: normalizedRegion,
      endpoint: credentials.endpoint,
      accessKeyId: credentials.access_key_id,
      accessKeySecret: credentials.access_key_secret,
      stsToken: credentials.security_token,
      bucket: credentials.bucket,
    })

    await client.put(credentials.object_key, blob)

    // OSS SDK 不支持 progress 回调，使用模拟进度
    if (onProgress) {
      onProgress(100)
    }
  }
}

// ==================== 主类 ====================

export class BizyairFileUploader {
  /**
   * 创建上传策略
   */
  private static createStrategy(apiKey: string | null): BizyAirUploadStrategy {
    if (apiKey && apiKey.trim().length > 0) {
      console.log('[BizyAir] 使用直接模式（用户 API Key）')
      return new DirectUploadStrategy()
    } else {
      console.log('[BizyAir] 使用代理模式（后端 API Key）')
      return new ProxyUploadStrategy()
    }
  }

  /**
   * 从 FileData 导出 Blob
   */
  private static async exportFileDataToBlob(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    exportOptions?: UploadFileExportOptions,
  ): Promise<Blob> {
    if (fileData.source === 'media-item') {
      const mediaItem = getMediaItem(fileData.mediaItemId!)
      if (!mediaItem) {
        throw new Error(`找不到媒体项: ${fileData.mediaItemId}`)
      }
      return await exportMediaItem({
        mediaItem,
        outputWidth: exportOptions?.outputWidth,
        outputHeight: exportOptions?.outputHeight,
        frameRate: exportOptions?.frameRate,
      })
    } else {
      const timelineItem = getTimelineItem(fileData.timelineItemId!)
      if (!timelineItem) {
        throw new Error(`找不到时间轴项: ${fileData.timelineItemId}`)
      }
      return await exportTimelineItem({
        timelineItem,
        getMediaItem,
        outputWidth: exportOptions?.outputWidth,
        outputHeight: exportOptions?.outputHeight,
        frameRate: exportOptions?.frameRate,
      })
    }
  }

  /**
   * 上传已准备好的 Blob
   */
  private static async uploadPreparedBlob(
    blob: Blob,
    fileName: string,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<UploadResult> {
    const unifiedStore = useUnifiedStore()
    const userApiKey = unifiedStore.getBizyAirApiKey()
    const strategy = this.createStrategy(userApiKey)

    onProgress?.('获取凭证', 20)
    const credentials = await strategy.getUploadToken(fileName, userApiKey)

    onProgress?.('上传中', 30)
    await OSSUploader.uploadToOSS(blob, credentials, (p) => {
      onProgress?.('上传中', 30 + Math.round(p * 0.5))
    })

    onProgress?.('提交资源', 80)
    const url = await strategy.commitResource(fileName, credentials.object_key, userApiKey)

    onProgress?.('完成', 100)

    return {
      success: true,
      url,
      object_key: credentials.object_key,
    }
  }

  /**
   * 完整的上传流程
   */
  static async uploadFile(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (stage: string, progress: number) => void,
    exportOptions?: UploadFileExportOptions,
  ): Promise<UploadResult> {
    try {
      // 1. 导出文件
      onProgress?.('导出文件', 0)
      const blob = await this.exportFileDataToBlob(
        fileData,
        getMediaItem,
        getTimelineItem,
        exportOptions,
      )

      // 2. 复用通用上传流程
      return await this.uploadPreparedBlob(blob, fileData.name, onProgress)
    } catch (error) {
      console.error('文件上传失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '上传失败',
      }
    }
  }

  static async uploadBlob(
    blob: Blob,
    fileName: string,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<UploadResult> {
    try {
      return await this.uploadPreparedBlob(blob, fileName, onProgress)
    } catch (error) {
      console.error('文件上传失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '上传失败',
      }
    }
  }

  /**
   * 批量上传文件（带重试）
   */
  static async uploadFiles(
    files: FileData[],
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (fileIndex: number, stage: string, progress: number) => void,
  ): Promise<Map<number, UploadResult>> {
    const results = new Map<number, UploadResult>()

    for (let i = 0; i < files.length; i++) {
      const result = await this.uploadFileWithRetry(
        files[i],
        getMediaItem,
        getTimelineItem,
        3,
        (stage, progress) => onProgress?.(i, stage, progress),
      )
      results.set(i, result)
    }

    return results
  }

  /**
   * 带重试的上传方法
   */
  static async uploadFileWithRetry(
    fileData: FileData,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    maxRetries: number = 3,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<UploadResult> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.uploadFile(
          fileData, 
          getMediaItem, 
          getTimelineItem, 
          onProgress
        )
      } catch (error) {
        lastError = error as Error
        console.warn(`上传失败(尝试 ${attempt}/${maxRetries}):`, error)

        if (attempt < maxRetries) {
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
   * 管道函数：处理配置中的文件上传
   */
  static async processConfigUploads(
    config: Record<string, any>,
    getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
    getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined,
    onProgress?: (fileIndex: number, stage: string, progress: number) => void,
    onSuccess?: () => void,
  ): Promise<Record<string, any>> {
    const newConfig = cloneDeep(config)
    const filesToUpload: FileData[] = []

    for (const [key, value] of Object.entries(newConfig)) {
      if (Array.isArray(value) && value.length > 0) {
        if (value[0] && typeof value[0] === 'object' && value[0].__type__ === 'FileData') {
          filesToUpload.push(...value)
        }
      }
    }

    if (filesToUpload.length === 0) {
      return newConfig
    }

    const uploadResults = await this.uploadFiles(
      filesToUpload,
      getMediaItem,
      getTimelineItem,
      onProgress,
    )

    for (const [index, result] of uploadResults.entries()) {
      if (!result.success) {
        throw new Error(`文件上传失败: ${result.error}`)
      }
    }

    if (uploadResults.size > 0 && onSuccess) {
      onSuccess()
    }

    let fileIndex = 0
    for (const [key, value] of Object.entries(newConfig)) {
      if (Array.isArray(value) && value.length > 0) {
        if (value[0] && typeof value[0] === 'object' && value[0].__type__ === 'FileData') {
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
}
