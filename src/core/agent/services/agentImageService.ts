import type { AgentImage, AgentImageRecord, AgentSession } from '../types'
import { MessagePartType } from '../types'
import type { AgentSessionStore } from '../runtime/AgentSessionStore'
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'

export const AGENT_IMAGE_LIMITS = {
  count: 4,
  originalBytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  edge: 2048,
  encodedBytes: 2 * 1024 * 1024,
} as const

/** Read dimensions before allocating a decoded bitmap, independently of media import. */
export function inspectAgentImage(bytes: Uint8Array): {
  mimeType: string
  width: number
  height: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + count))
  let width = 0
  let height = 0
  let mimeType = ''
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 7) === 'PNG\r\n\x1a\n' &&
    ascii(12, 4) === 'IHDR'
  ) {
    mimeType = 'image/png'
    width = view.getUint32(16)
    height = view.getUint32(20)
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    mimeType = 'image/webp'
    const chunk = ascii(12, 4)
    if (chunk === 'VP8X') {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16)
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16)
    } else if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (chunk === 'VP8L' && bytes[20] === 47) {
      const dimensions = view.getUint32(21, true)
      width = (dimensions & 0x3fff) + 1
      height = ((dimensions >>> 14) & 0x3fff) + 1
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg'
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]!
      if (marker === 218 || marker === 217) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
  }
  if (!width || !height) throw new Error('请选择有效的 JPEG、PNG 或 WebP 图片')
  if (width * height > AGENT_IMAGE_LIMITS.pixels) throw new Error('图片不能超过 4000 万像素')
  return { mimeType, width, height }
}

export async function processAgentImage(file: Blob): Promise<AgentImage> {
  if (file.size > AGENT_IMAGE_LIMITS.originalBytes) throw new Error('每张原图不能超过 10 MiB')
  const metadata = inspectAgentImage(new Uint8Array(await file.arrayBuffer()))
  const bitmap = await createImageBitmap(new Blob([file], { type: metadata.mimeType }), {
    imageOrientation: 'from-image',
  })
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > AGENT_IMAGE_LIMITS.pixels)
      throw new Error('图片尺寸无效或超过 4000 万像素')
    const scale = Math.min(1, AGENT_IMAGE_LIMITS.edge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理图片')
    for (let attempt = 0; attempt < 8; attempt++) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('图片编码失败'))),
          'image/webp',
          Math.max(0.55, 0.9 - attempt * 0.1),
        )
      })
      if (blob.size <= AGENT_IMAGE_LIMITS.encodedBytes)
        return {
          id: crypto.randomUUID(),
          blob,
          mimeType: blob.type,
          width: canvas.width,
          height: canvas.height,
        }
      canvas.width = Math.max(1, Math.round(canvas.width * 0.8))
      canvas.height = Math.max(1, Math.round(canvas.height * 0.8))
    }
    throw new Error('处理后的图片超过 2 MiB')
  } finally {
    bitmap.close()
  }
}

export function createAgentImagePreview(blob: Blob) {
  const url = URL.createObjectURL(blob)
  return { url, dispose: () => URL.revokeObjectURL(url) }
}

export async function prepareAgentImages(
  session: AgentSession,
  store: AgentSessionStore,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<Map<string, string>> {
  const check = () => {
    signal.throwIfAborted()
    if (!isCurrent()) throw new DOMException('图片准备已取消', 'AbortError')
  }
  const ids = new Set(
    session.messages.flatMap((message) =>
      message.role === 'user'
        ? message.parts.flatMap((part) =>
            part.type === MessagePartType.IMAGE ? [part.imageId] : [],
          )
        : [],
    ),
  )
  const urls = new Map<string, string>()
  for (const id of ids) {
    check()
    const image = await store.readImage(session, id)
    check()
    let upload = image.upload
    if (
      !upload ||
      Date.parse(upload.expiresAt) <= Date.now() + 60_000 ||
      !Number.isFinite(Date.parse(upload.expiresAt))
    ) {
      const result = await CloudflareTemporaryFileUploader.uploadBlob(
        image.blob,
        {
          capability: 'agent',
          purpose: 'agent-image',
          projectId: session.projectId,
          fileName: `${crypto.randomUUID()}.${image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`,
          mimeType: image.mimeType,
          byteSize: image.blob.size,
          width: image.width,
          height: image.height,
        },
        undefined,
        signal,
      )
      check()
      if (!result.success || !result.url || !result.expiresAt)
        throw new Error(`对话图片上传失败：${result.error || '上传服务未返回有效地址'}`)
      upload = { url: result.url, expiresAt: result.expiresAt }
      await store.updateImageUpload(image, upload, () => !signal.aborted && isCurrent())
      check()
    }
    urls.set(id, upload.url)
  }
  return urls
}

export async function invalidateAgentImageUploads(
  session: AgentSession,
  store: AgentSessionStore,
  isCurrent: () => boolean,
) {
  const ids = new Set(
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => (part.type === MessagePartType.IMAGE ? [part.imageId] : [])),
    ),
  )
  for (const id of ids) {
    if (!isCurrent()) return
    const image: AgentImageRecord = await store.readImage(session, id)
    await store.updateImageUpload(image, undefined, isCurrent)
  }
}
