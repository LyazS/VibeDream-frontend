/**
 * 媒体类型检测工具
 * 提供统一的文件媒体类型检测功能
 */

/**
 * 媒体类型枚举
 */
export type DetectedMediaType = 'video' | 'image' | 'audio' | 'unknown'

// ==================== 文件验证类型定义 ====================

/**
 * 文件验证结果 - 使用条件类型确保类型安全
 */
export type FileValidationResult =
  | {
      isValid: true
      mediaType: 'video' | 'audio' | 'image'
      fileSize: number
    }
  | {
      isValid: false
      errorMessage: string
    }

// ==================== 支持的媒体类型配置 ====================

/**
 * 支持的媒体文件类型（MIME类型）
 */
export const SUPPORTED_MEDIA_TYPES = {
  video: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/avi',
    'video/mov',
    'video/wmv',
    'video/flv',
    'video/mkv',
    'video/quicktime', // .mov 的标准MIME类型
    'video/x-matroska', // .mkv 的标准MIME类型
    'video/x-ms-wmv', // .wmv 的标准MIME类型
    'video/x-flv', // .flv 的标准MIME类型
    'video/3gpp', // .3gp 的标准MIME类型
  ],
  audio: [
    'audio/mpeg', // .mp3
    'audio/wav', // .wav
    'audio/ogg', // .ogg
    'audio/aac', // .aac
    'audio/flac', // .flac
    'audio/mp4', // .m4a
    'audio/x-ms-wma', // .wma
  ],
  image: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
    'image/tiff',
  ],
} as const

/**
 * 文件大小限制（字节）
 */
export const FILE_SIZE_LIMITS = {
  video: 1 * 1024 * 1024 * 1024,
  audio: 512 * 1024 * 1024,
  image: 256 * 1024 * 1024,
} as const

type SupportedMimeType =
  | (typeof SUPPORTED_MEDIA_TYPES.video)[number]
  | (typeof SUPPORTED_MEDIA_TYPES.audio)[number]
  | (typeof SUPPORTED_MEDIA_TYPES.image)[number]

function isSupportedMimeInCategory<T extends readonly string[]>(
  mimeType: string,
  supportedTypes: T,
): mimeType is T[number] {
  return supportedTypes.includes(mimeType as T[number])
}

/**
 * 检测文件的媒体类型
 * @param file 文件对象
 * @returns 检测到的媒体类型
 */
export function detectFileMediaType(file: File): DetectedMediaType {
  const mimeType = file.type.toLowerCase()

  // 首先根据MIME类型精确检测
  if (isSupportedMimeInCategory(mimeType, SUPPORTED_MEDIA_TYPES.video)) {
    return 'video'
  } else if (isSupportedMimeInCategory(mimeType, SUPPORTED_MEDIA_TYPES.audio)) {
    return 'audio'
  } else if (isSupportedMimeInCategory(mimeType, SUPPORTED_MEDIA_TYPES.image)) {
    return 'image'
  } else {
    // 如果MIME类型不在支持列表中，根据文件扩展名进行二次检测
    const extension = file.name.toLowerCase().split('.').pop() || ''

    const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp']
    const audioExtensions = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma']
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff']

    if (videoExtensions.includes(extension)) {
      return 'video'
    } else if (audioExtensions.includes(extension)) {
      return 'audio'
    } else if (imageExtensions.includes(extension)) {
      return 'image'
    }

    return 'unknown'
  }
}

/**
 * 检查文件类型是否支持
 * @param file 文件对象
 * @returns 是否支持该文件类型
 */
export function isSupportedMediaType(file: File): boolean {
  const detectedType = detectFileMediaType(file)

  // 支持的媒体类型：video, audio, image
  // 不支持的类型：unknown
  return ['video', 'audio', 'image'].includes(detectedType)
}

/**
 * 检查MIME类型是否被支持
 * @param mimeType MIME类型字符串
 * @returns 是否支持该MIME类型
 */
export function isSupportedMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.toLowerCase()

  return (
    isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.video) ||
    isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.audio) ||
    isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.image)
  )
}

/**
 * 根据MIME类型获取媒体类型
 * @param mimeType MIME类型字符串
 * @returns 媒体类型
 */
export function getMediaTypeFromMimeType(mimeType: string): DetectedMediaType {
  const normalizedMimeType = mimeType.toLowerCase()

  if (isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.video)) {
    return 'video'
  } else if (isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.audio)) {
    return 'audio'
  } else if (isSupportedMimeInCategory(normalizedMimeType, SUPPORTED_MEDIA_TYPES.image)) {
    return 'image'
  }

  return 'unknown'
}

/**
 * 获取媒体类型的显示名称
 * @param mediaType 媒体类型
 * @returns 显示名称
 */
export function getMediaTypeDisplayName(mediaType: DetectedMediaType): string {
  const displayNames: Record<DetectedMediaType, string> = {
    video: '视频',
    audio: '音频',
    image: '图片',
    unknown: '未知',
  }

  return displayNames[mediaType]
}

/**
 * 根据媒体类型获取默认图标
 * @param mediaType 媒体类型
 * @returns 图标名称或URL
 */
export function getMediaTypeIcon(mediaType: DetectedMediaType): string {
  const icons: Record<DetectedMediaType, string> = {
    video: '🎬',
    audio: '🎵',
    image: '🖼️',
    unknown: '📄',
  }

  return icons[mediaType]
}

// ==================== 文件验证功能 ====================

/**
 * 验证文件
 * @param file 文件对象
 * @returns 验证结果
 */
export function validateFile(file: File): FileValidationResult {
  // 检查文件是否存在
  if (!file) {
    return {
      isValid: false,
      errorMessage: '文件不存在',
    }
  }

  // 检查文件是否为空
  if (file.size === 0) {
    return {
      isValid: false,
      errorMessage: '文件为空',
    }
  }

  // 检查文件类型 - 使用 detectFileMediaType
  const mediaType = detectFileMediaType(file)
  if (mediaType === 'unknown') {
    console.error(`❌ [validateFile] 不支持的文件类型: ${file.type || '未知'} (${file.name})`)
    return {
      isValid: false,
      errorMessage:
        '不支持的文件类型，支持的格式：视频(MP4、WebM、MOV、AVI、MKV、FLV)、音频(MP3、WAV、AAC、FLAC、OGG、M4A)、图片(JPG、PNG、GIF、WebP、BMP)',
    }
  }

  // 检查文件大小限制
  const sizeLimit = FILE_SIZE_LIMITS[mediaType]
  if (file.size > sizeLimit) {
    const sizeMB = Math.round(file.size / (1024 * 1024))
    const limitMB = Math.round(sizeLimit / (1024 * 1024))
    const typeNames = { video: '视频', audio: '音频', image: '图片' }
    return {
      isValid: false,
      errorMessage: `${typeNames[mediaType]}文件过大: ${sizeMB}MB，最大支持 ${limitMB}MB`,
    }
  }

  // 检查文件名
  if (!file.name || file.name.length === 0 || file.name.length > 255) {
    return {
      isValid: false,
      errorMessage: '文件名无效',
    }
  }

  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/
  if (invalidChars.test(file.name)) {
    return {
      isValid: false,
      errorMessage: '文件名包含非法字符',
    }
  }

  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(file.name)) {
    return {
      isValid: false,
      errorMessage: '文件名使用了系统保留名称',
    }
  }

  return {
    isValid: true,
    mediaType,
    fileSize: file.size,
  }
}
