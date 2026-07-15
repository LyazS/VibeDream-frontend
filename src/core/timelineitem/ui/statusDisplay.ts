/**
 * 时间轴项目状态显示工具函数
 * 基于媒体项目状态直接计算UI显示信息，替代原有的复杂上下文模板系统
 */

import type { UnifiedMediaItemData } from '@/core/mediaitem'

export interface StatusDisplayInfo {
  text: string
  hasProgress: boolean
  percent: number
  speed?: string
  hasError: boolean
  errorMessage?: string
  recoverable?: boolean
}

export class TimelineStatusDisplayUtils {
  static getStatusText(mediaData: UnifiedMediaItemData): string {
    switch (mediaData.mediaStatus) {
      case 'pending':
        return '等待处理'
      case 'asyncprocessing':
        // 检查是否正在获取数据源（通过进度判断）
        if (mediaData.source.progress > 0 && mediaData.source.progress < 100) {
          const progress = mediaData.source.progress || 0
          return `获取中... ${progress.toFixed(2)}%`
        }
        return '解析中...'
      case 'decoding':
        return '解析中...'
      case 'ready':
        return '就绪'
      case 'error':
        return '错误'
      case 'cancelled':
        return '已取消'
      case 'missing':
        return '文件缺失'
      default:
        return '处理中'
    }
  }

  static getProgressInfo(mediaData: UnifiedMediaItemData): {
    hasProgress: boolean
    percent: number
    speed?: string
  } {
    switch (mediaData.mediaStatus) {
      case 'asyncprocessing':
        // 检查是否正在获取数据源（通过进度判断）
        if (mediaData.source.progress > 0 && mediaData.source.progress < 100) {
          return {
            hasProgress: true,
            percent: mediaData.source.progress || 0,
          }
        }
        return { hasProgress: true, percent: 50 }
      case 'decoding':
        return { hasProgress: true, percent: 75 }
      default:
        return { hasProgress: false, percent: 0 }
    }
  }

  static getErrorInfo(mediaData: UnifiedMediaItemData): {
    hasError: boolean
    message?: string
    recoverable?: boolean
  } {
    if (mediaData.mediaStatus !== 'error') {
      return { hasError: false }
    }

    return {
      hasError: true,
      message: mediaData.source?.errorMessage || '处理失败',
      recoverable: true, // 大部分错误都可以重试
    }
  }

  static hasProgress(mediaData: UnifiedMediaItemData): boolean {
    return this.getProgressInfo(mediaData).hasProgress
  }

  static hasError(mediaData: UnifiedMediaItemData): boolean {
    return this.getErrorInfo(mediaData).hasError
  }

  static getProgressPercent(mediaData: UnifiedMediaItemData): number {
    return this.getProgressInfo(mediaData).percent
  }

  static getErrorMessage(mediaData: UnifiedMediaItemData): string | null {
    const errorInfo = this.getErrorInfo(mediaData)
    return errorInfo.hasError ? errorInfo.message || null : null
  }

  static isRecoverable(mediaData: UnifiedMediaItemData): boolean {
    const errorInfo = this.getErrorInfo(mediaData)
    return errorInfo.hasError ? errorInfo.recoverable || false : false
  }
}

export const createStatusDisplayComputeds = (getMediaData: () => UnifiedMediaItemData | null) => {
  return {
    statusText: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.getStatusText(mediaData) : '未知状态'
    },
    hasProgress: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.hasProgress(mediaData) : false
    },
    progressPercent: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.getProgressPercent(mediaData) : 0
    },
    progressText: () => {
      const mediaData = getMediaData()
      if (!mediaData) return ''
      const progressInfo = TimelineStatusDisplayUtils.getProgressInfo(mediaData)
      if (!progressInfo.hasProgress) return ''
      return progressInfo.speed
        ? `${progressInfo.percent.toFixed(2)}% (${progressInfo.speed})`
        : `${progressInfo.percent.toFixed(2)}%`
    },
    hasError: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.hasError(mediaData) : false
    },
    errorMessage: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.getErrorMessage(mediaData) : null
    },
    canRetry: () => {
      const mediaData = getMediaData()
      return mediaData ? TimelineStatusDisplayUtils.isRecoverable(mediaData) : false
    },
  }
}
