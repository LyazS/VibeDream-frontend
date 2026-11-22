/**
 * 图片文件解码工具。
 */

/**
 * Image File → ImageBitmap。
 */
export async function fileToImageBitmap(
  file: File,
  options?: {
    maxPixels?: number
    resizeWidth?: number
    resizeHeight?: number
    resizeQuality?: ImageSmoothingQuality
  },
): Promise<ImageBitmap> {
  const {
    maxPixels = 4096 * 4096,
    resizeWidth,
    resizeHeight,
    resizeQuality = 'high',
  } = options ?? {}

  const bitmap = await createImageBitmap(file, {
    resizeWidth,
    resizeHeight,
    resizeQuality,
  })

  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close()
    throw new Error('Decoded bitmap has invalid size')
  }

  if (bitmap.width * bitmap.height > maxPixels) {
    bitmap.close()
    throw new Error('Bitmap exceeds max pixel limit')
  }

  return bitmap
}
