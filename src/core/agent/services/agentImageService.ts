import {
  AGENT_MAX_IMAGE_EDGE,
  AGENT_MAX_IMAGE_ENCODED_BYTES,
  AGENT_MAX_IMAGE_ORIGINAL_BYTES,
  AGENT_MAX_IMAGE_PIXELS,
} from './agentImageValidation'
import { abortable } from '@/core/utils/abortable'
import type {
  AgentAttachment,
  AgentAttachmentRecord,
  AgentAttachmentScope,
  AgentImage,
  AgentImageConversionParams,
  AgentImageMimeType,
  AgentSession,
} from '../types'
import { MessagePartType } from '../types'
import type { AgentSessionStore } from '../runtime/AgentSessionStore'
import {
  CfBailianTempFileUploader,
  type CfBailianTempFileUploadRequest,
} from '@/core/utils/cfBailianTempFileUploader'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { FileSystemError } from '@/core/filesystem/errors/FileSystemError'
import { ErrorCode } from '@/core/filesystem/errors/ErrorCodes'

export {
  AGENT_MAX_IMAGE_COUNT,
  AGENT_MAX_IMAGE_EDGE,
  AGENT_MAX_IMAGE_ENCODED_BYTES,
  AGENT_MAX_IMAGE_ORIGINAL_BYTES,
  AGENT_MAX_IMAGE_PIXELS,
} from './agentImageValidation'

export type AgentImageErrorCode =
  | 'imageInvalid'
  | 'imagePixelLimit'
  | 'imageOriginalSizeLimit'
  | 'imageProcessingFailed'
  | 'imageEncodingFailed'
  | 'imageEncodedSizeLimit'
  | 'imageSaveFailed'

export class AgentImageProcessingError extends Error {
  constructor(readonly code: AgentImageErrorCode) {
    super(code)
    this.name = 'AgentImageProcessingError'
  }
}

export class AgentImageUploadError extends Error {
  readonly code = 'AGENT_IMAGE_UPLOAD_FAILED'

  constructor(detail?: string) {
    super(detail || 'Upload service did not return a valid image URL')
    this.name = 'AgentImageUploadError'
  }
}

export class AgentImageSourceError extends Error {
  constructor(readonly code: 'AGENT_IMAGE_SOURCE_MISSING' | 'AGENT_IMAGE_RECORD_MISSING') {
    super(code)
    this.name = 'AgentImageSourceError'
  }
}

export type ResolvedAgentImage =
  | ({
      kind: 'image'
      url: string
      fileName: string
    } & (
      | { recordKind: 'user_attachment'; source: 'available' | 'missing' }
      | { recordKind: 'tool_image'; source: 'available'; description: string }
    ))
  | { kind: 'unavailable'; reason: 'source_missing'; fileName: string }
  | { kind: 'unavailable'; reason: 'record_missing'; fileName?: never }

// 图片准备、共享草稿和本地提交期间都保护原图，避免被孤立文件清理误删。
const activeOriginals = new Set<string>()
const heldOriginals = new Map<string, number>()
const orphanSweepProtections = new Set<Set<string>>()
const originalKey = (projectId: string, id: string) => JSON.stringify([projectId, id])
const projectLockName = (projectId: string) => `lightcut:agent-attachments:${projectId}`

function protectOriginalDuringSweep(key: string) {
  for (const protectedOriginals of orphanSweepProtections) protectedOriginals.add(key)
}

function acquireOriginalLease(projectId: string, id: string) {
  const key = originalKey(projectId, id)
  heldOriginals.set(key, (heldOriginals.get(key) ?? 0) + 1)
  protectOriginalDuringSweep(key)
  let releaseLock = () => {}
  let ready = Promise.resolve()
  if (typeof navigator !== 'undefined' && navigator.locks) {
    let acquired!: () => void
    let failed!: (error: unknown) => void
    ready = new Promise<void>((resolve, reject) => {
      acquired = resolve
      failed = reject
    })
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    void navigator.locks
      .request(projectLockName(projectId), { mode: 'shared' }, async () => {
        acquired()
        await released
      })
      .catch(failed)
    // 草稿同步登记原图占用；实际写入前仍须等待跨标签页共享锁获取完成。
    void ready.catch(() => {})
  }
  let released = false
  const release = () => {
    if (released) return
    released = true
    const remaining = (heldOriginals.get(key) ?? 1) - 1
    if (remaining) heldOriginals.set(key, remaining)
    else heldOriginals.delete(key)
    releaseLock()
  }
  return { ready, release }
}

export function retainAgentAttachment(projectId: string, id: string): () => void {
  return acquireOriginalLease(projectId, id).release
}

export function isAgentImageSourceMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if ('cause' in error && error.cause instanceof Error)
    return isAgentImageSourceMissing(error.cause)
  return (
    error.name === 'NotFoundError' ||
    (error instanceof FileSystemError &&
      [ErrorCode.FILE_NOT_FOUND, ErrorCode.DIRECTORY_NOT_FOUND].includes(error.code))
  )
}

export async function deleteAgentImageSource(
  image: Pick<AgentAttachment, 'projectId' | 'id' | 'original'>,
): Promise<void> {
  try {
    await fileSystemService.deleteAgentAttachment(
      image.projectId,
      image.id,
      image.original.relativePath,
    )
  } catch (error) {
    if (!isAgentImageSourceMissing(error)) throw error
  }
}

/** 在分配解码位图前读取尺寸并校验像素限制，此步骤独立于素材导入。 */
export function inspectAgentImage(bytes: Uint8Array): {
  mimeType: AgentImageMimeType
  width: number
  height: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + count))
  let width = 0
  let height = 0
  let mimeType: AgentImageMimeType | undefined
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
  if (!mimeType || !width || !height) throw new AgentImageProcessingError('imageInvalid')
  if (width * height > AGENT_MAX_IMAGE_PIXELS)
    throw new AgentImageProcessingError('imagePixelLimit')
  return { mimeType, width, height }
}

export async function processAgentImage(
  file: Blob,
  signal: AbortSignal | undefined,
  target: AgentAttachmentScope & { id: string },
): Promise<AgentImage> {
  signal?.throwIfAborted()
  if (file.size > AGENT_MAX_IMAGE_ORIGINAL_BYTES)
    throw new AgentImageProcessingError('imageOriginalSizeLimit')
  const bytes = await file.arrayBuffer()
  signal?.throwIfAborted()
  const metadata = inspectAgentImage(new Uint8Array(bytes))
  signal?.throwIfAborted()
  const relativePath = fileSystemService.paths.getAgentAttachmentPath(
    target.projectId,
    target.id,
    metadata.mimeType,
  )
  const original = {
    relativePath,
    fileName:
      'name' in file && typeof file.name === 'string'
        ? file.name
        : `${target.id}.${relativePath.split('.').pop()}`,
    mimeType: metadata.mimeType,
    byteSize: file.size,
    width: metadata.width,
    height: metadata.height,
  }
  const key = originalKey(target.projectId, target.id)
  const lease = acquireOriginalLease(target.projectId, target.id)
  activeOriginals.add(key)
  protectOriginalDuringSweep(key)
  try {
    await lease.ready
    signal?.throwIfAborted()
    try {
      await fileSystemService.writeAgentAttachment(
        target.projectId,
        target.id,
        metadata.mimeType,
        file,
      )
    } catch {
      throw new AgentImageProcessingError('imageSaveFailed')
    }
    signal?.throwIfAborted()
    const encoded = await encodeAgentImage(file, metadata.mimeType, signal)
    signal?.throwIfAborted()
    return { ...target, original, ...encoded }
  } catch (error) {
    // 部分写入或无法中断的迟到解码仍归属本次固定工程，失败时只清理该原图。
    await deleteAgentImageSource({ ...target, original }).catch(() => {})
    throw error
  } finally {
    activeOriginals.delete(key)
    lease.release()
  }
}

async function encodeAgentImage(
  file: Blob,
  mimeType: AgentImageMimeType,
  signal?: AbortSignal,
  params?: AgentImageConversionParams,
): Promise<Pick<AgentImage, 'blob' | 'conversionParams'>> {
  signal?.throwIfAborted()
  const bitmap = await abortable(
    createImageBitmap(new Blob([file], { type: mimeType }), {
      imageOrientation: 'from-image',
    }),
    signal,
    (late) => late.close(),
  )
  try {
    if (bitmap.width * bitmap.height > AGENT_MAX_IMAGE_PIXELS)
      throw new AgentImageProcessingError('imagePixelLimit')
    return await encodeAgentVisual(bitmap, bitmap.width, bitmap.height, signal, undefined, params)
  } finally {
    bitmap.close()
  }
}

/** 相对于正常显示画面的归一化矩形，左上角为原点。 */
export type AgentViewRegion = { x: number; y: number; width: number; height: number }

/** 将归一化区域转为像素矩形，起点向下、终点向上取整以覆盖目标区域。 */
export function visualCrop(width: number, height: number, region?: AgentViewRegion) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new AgentImageProcessingError('imageInvalid')
  const r = region ?? { x: 0, y: 0, width: 1, height: 1 }
  if (
    ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width <= 0 ||
    r.height <= 0 ||
    r.x + r.width > 1 ||
    r.y + r.height > 1
  )
    throw new Error('invalid_arguments：裁剪区域越界。')
  const x = Math.floor(r.x * width),
    y = Math.floor(r.y * height)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil((r.x + r.width) * width) - x),
    height: Math.max(1, Math.ceil((r.y + r.height) * height) - y),
  }
}

/** 先按显示坐标裁剪，再等比缩放编码；输入资源由调用者管理，本函数只释放临时画布。 */
export async function encodeAgentVisual(
  source:
    | CanvasImageSource
    | ((
        context: CanvasRenderingContext2D,
        crop: ReturnType<typeof visualCrop>,
        width: number,
        height: number,
      ) => void),
  width: number,
  height: number,
  signal?: AbortSignal,
  region?: AgentViewRegion,
  params?: AgentImageConversionParams,
): Promise<Pick<AgentImage, 'blob' | 'conversionParams'>> {
  signal?.throwIfAborted()
  const crop = visualCrop(width, height, region)
  const scale = Math.min(1, AGENT_MAX_IMAGE_EDGE / Math.max(crop.width, crop.height))
  const canvas = document.createElement('canvas')
  canvas.width = params?.width ?? Math.max(1, Math.round(crop.width * scale))
  canvas.height = params?.height ?? Math.max(1, Math.round(crop.height * scale))
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new AgentImageProcessingError('imageProcessingFailed')
    const outputMimeType = params?.mimeType ?? 'image/webp'
    // 历史用户图按保存参数重建；新观察图超出字节限制时逐轮降低质量和尺寸。
    for (let attempt = 0; attempt < (params ? 1 : 8); attempt++) {
      signal?.throwIfAborted()
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (typeof source === 'function') source(context, crop, canvas.width, canvas.height)
      else if (!region) context.drawImage(source, 0, 0, canvas.width, canvas.height)
      else
        context.drawImage(
          source,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          canvas.width,
          canvas.height,
        )
      const quality = params?.quality ?? Math.max(0.55, 0.9 - attempt * 0.1)
      const blob = await abortable(
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) =>
              result
                ? resolve(result)
                : reject(new AgentImageProcessingError('imageEncodingFailed')),
            outputMimeType,
            quality,
          )
        }),
        signal,
      )
      signal?.throwIfAborted()
      if (blob.type !== outputMimeType || !blob.size)
        throw new AgentImageProcessingError('imageEncodingFailed')
      if (blob.size <= AGENT_MAX_IMAGE_ENCODED_BYTES)
        return {
          blob,
          conversionParams: {
            width: canvas.width,
            height: canvas.height,
            mimeType: outputMimeType,
            quality,
          },
        }
      canvas.width = Math.max(1, Math.round(canvas.width * 0.8))
      canvas.height = Math.max(1, Math.round(canvas.height * 0.8))
    }
    throw new AgentImageProcessingError('imageEncodedSizeLimit')
  } finally {
    canvas.width = canvas.height = 0
  }
}

export function createAgentImagePreview(blob: Blob) {
  const url = URL.createObjectURL(blob)
  return { url, dispose: () => URL.revokeObjectURL(url) }
}

export async function readAgentImageSource(image: AgentAttachment): Promise<Blob> {
  try {
    return await fileSystemService.readAgentAttachment(
      image.projectId,
      image.id,
      image.original.relativePath,
    )
  } catch (error) {
    if (isAgentImageSourceMissing(error))
      throw new AgentImageSourceError('AGENT_IMAGE_SOURCE_MISSING')
    throw error
  }
}

const uploadWindowMs = 11 * 60_000
type AgentImageUpload = NonNullable<AgentAttachmentRecord['upload']>
function validUpload(upload: Partial<AgentImageUpload> | undefined): upload is AgentImageUpload {
  return Boolean(
    typeof upload?.url === 'string' &&
      typeof upload.expiresAt === 'string' &&
      /^oss:\/\/dashscope-instant\/[A-Za-z0-9_./-]+$/.test(upload.url) &&
      !upload.url
        .slice(6)
        .split('/')
        .some((part) => part === '.' || part === '..') &&
      Number.isFinite(Date.parse(upload.expiresAt)) &&
      Date.parse(upload.expiresAt) > Date.now() + uploadWindowMs,
  )
}

type ImageWaiter = { signal: AbortSignal; isCurrent: () => boolean }
type ImagePreparation = {
  controller: AbortController
  waiters: Set<ImageWaiter>
  result: Promise<ResolvedAgentImage>
}

class AgentImageResolver {
  private images = new Map<string, Blob>()
  private preparations = new Map<string, ImagePreparation>()

  constructor(private store: AgentSessionStore) {}

  private key(session: AgentSession, id: string) {
    return JSON.stringify([this.store.owner(session.userId, session.projectId), session.id, id])
  }

  remember(session: AgentSession, images: readonly AgentImage[]) {
    for (const image of images) this.images.set(this.key(session, image.id), image.blob)
  }

  forget(session?: AgentSession) {
    const prefix = session
      ? JSON.stringify([this.store.owner(session.userId, session.projectId), session.id]).slice(
          0,
          -1,
        ) + ','
      : ''
    for (const [key, task] of this.preparations) {
      if (!key.startsWith(prefix)) continue
      task.controller.abort()
      this.preparations.delete(key)
    }
    for (const key of this.images.keys()) if (key.startsWith(prefix)) this.images.delete(key)
  }

  resolve(session: AgentSession, id: string, signal: AbortSignal, isCurrent: () => boolean) {
    signal.throwIfAborted()
    if (!isCurrent()) return Promise.reject(new DOMException('图片准备已取消', 'AbortError'))
    const key = this.key(session, id)
    let task = this.preparations.get(key)
    if (!task) {
      const controller = new AbortController()
      const waiters = new Set<ImageWaiter>()
      const current = () =>
        !controller.signal.aborted &&
        [...waiters].some((item) => !item.signal.aborted && item.isCurrent())
      const check = () => {
        if (!current()) throw new DOMException('图片准备已取消', 'AbortError')
      }
      task = {
        controller,
        waiters,
        result: Promise.resolve().then(() =>
          this.prepare(session, id, key, controller.signal, check, current),
        ),
      }
      this.preparations.set(key, task)
    }
    const shared = task
    const waiter = { signal, isCurrent }
    shared.waiters.add(waiter)
    return new Promise<ResolvedAgentImage>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener('abort', abort)
        shared.waiters.delete(waiter)
        if (!shared.waiters.size) {
          shared.controller.abort()
          if (this.preparations.get(key) === shared) this.preparations.delete(key)
        }
      }
      const abort = () => {
        finish()
        reject(new DOMException('图片准备已取消', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      shared.result.then(
        (result) => {
          const current = !signal.aborted && isCurrent()
          finish()
          if (current) resolve(result)
          else reject(new DOMException('图片准备已取消', 'AbortError'))
        },
        (error: unknown) => {
          finish()
          reject(error)
        },
      )
    })
  }

  private async prepare(
    session: AgentSession,
    id: string,
    key: string,
    signal: AbortSignal,
    check: () => void,
    isCurrent: () => boolean,
  ): Promise<ResolvedAgentImage> {
    check()
    const image = await this.store.readImage(session, id)
    check()
    if (!image) return { kind: 'unavailable', reason: 'record_missing' }
    const uploadImage = async (
      blob: Blob,
      metadata: Pick<
        CfBailianTempFileUploadRequest,
        'fileName' | 'mimeType' | 'byteSize' | 'width' | 'height'
      >,
    ): Promise<string> => {
      const result = await CfBailianTempFileUploader.uploadBlob(
        blob,
        {
          capability: 'agent',
          purpose: 'agent-image',
          projectId: session.projectId,
          ...metadata,
        },
        undefined,
        signal,
      )
      check()
      const upload = { url: result.url, expiresAt: result.expiresAt }
      if (!result.success || !validUpload(upload)) throw new AgentImageUploadError(result.error)
      if (!(await this.store.updateImageUpload(image, upload, isCurrent)))
        throw new DOMException('图片准备已取消', 'AbortError')
      check()
      return upload.url
    }
    if (image.recordKind === 'tool_image') {
      // 临时地址过期后重新上传已保存的 Blob，不能按最新素材或时间轴重做历史观察。
      const fileName = image.id
      if (validUpload(image.upload))
        return {
          kind: 'image',
          recordKind: image.recordKind,
          url: image.upload.url,
          source: 'available',
          fileName,
          description: image.description,
        }
      const url = await uploadImage(image.blob, {
        fileName: `${image.id}.${image.mimeType.split('/')[1]}`,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
      })
      return {
        kind: 'image',
        recordKind: image.recordKind,
        url,
        source: 'available',
        fileName,
        description: image.description,
      }
    }
    const fileName = image.original.fileName
    let source: Blob | undefined
    try {
      source = await readAgentImageSource(image)
    } catch (error) {
      if (!(error instanceof AgentImageSourceError)) throw error
    }
    check()
    if (validUpload(image.upload))
      return {
        kind: 'image',
        recordKind: image.recordKind,
        url: image.upload.url,
        source: source ? 'available' : 'missing',
        fileName,
      }
    if (!source) return { kind: 'unavailable', reason: 'source_missing', fileName }
    let blob = this.images.get(key)
    if (!blob) {
      const rebuilt = await encodeAgentImage(
        source,
        image.original.mimeType,
        signal,
        image.conversionParams,
      )
      check()
      blob = rebuilt.blob
      this.images.set(key, blob)
    }
    const url = await uploadImage(blob, {
      fileName: `${crypto.randomUUID()}.webp`,
      mimeType: image.conversionParams.mimeType,
      byteSize: blob.size,
      width: image.conversionParams.width,
      height: image.conversionParams.height,
    })
    return { kind: 'image', recordKind: image.recordKind, url, source: 'available', fileName }
  }
}

const resolvers = new WeakMap<AgentSessionStore, AgentImageResolver>()
function resolverFor(store: AgentSessionStore) {
  let resolver = resolvers.get(store)
  if (!resolver) {
    resolver = new AgentImageResolver(store)
    resolvers.set(store, resolver)
  }
  return resolver
}

export function rememberAgentImages(
  store: AgentSessionStore,
  session: AgentSession,
  images: readonly AgentImage[],
) {
  resolverFor(store).remember(session, images)
}

export function forgetAgentImages(store: AgentSessionStore, session?: AgentSession) {
  resolvers.get(store)?.forget(session)
}

/** 准备本轮模型需要的全部用户附件和工具观察图，重复引用只解析和上传一次。 */
export async function prepareAgentImages(
  session: AgentSession,
  store: AgentSessionStore,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<Map<string, ResolvedAgentImage>> {
  const check = () => {
    signal.throwIfAborted()
    if (!isCurrent()) throw new DOMException('图片准备已取消', 'AbortError')
  }
  // 按引用去重后解析或上传全部历史图片，避免同一图片在多条消息中重复上传。
  const candidates = session.messages.flatMap((message) =>
    message.role === 'user' || message.role === 'tool'
      ? message.parts.flatMap((part) =>
          part.type === MessagePartType.IMAGE && part.attachmentId ? [part.attachmentId] : [],
        )
      : [],
  )
  const ids = new Set(candidates)
  const images = new Map<string, ResolvedAgentImage>()
  for (const id of ids) {
    check()
    const image = await resolverFor(store).resolve(session, id, signal, isCurrent)
    check()
    images.set(id, image)
  }
  return images
}

export async function invalidateAgentImageUploads(
  session: AgentSession,
  store: AgentSessionStore,
  isCurrent: () => boolean,
) {
  const ids = new Set(
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === MessagePartType.IMAGE && part.attachmentId ? [part.attachmentId] : [],
      ),
    ),
  )
  for (const id of ids) {
    if (!isCurrent()) return
    const image = await store.readImage(session, id)
    if (image) await store.updateImageUpload(image, undefined, isCurrent)
  }
}

export async function reclaimAgentImageOrphans(
  projectId: string,
  store: AgentSessionStore,
  isCurrent: () => boolean,
  onDeleted?: () => void,
) {
  // 读取记录快照后提交可能释放草稿占用，因此清理过程还需保留这份原图保护集合。
  const protectedOriginals = new Set([...activeOriginals, ...heldOriginals.keys()])
  orphanSweepProtections.add(protectedOriginals)
  try {
    if (!isCurrent()) return
    const directory = fileSystemService.paths.getAgentAttachmentsDirPath(projectId)
    let entries
    try {
      entries = await fileSystemService.listDirectory(directory)
    } catch (error) {
      if (isAgentImageSourceMissing(error)) return
      throw error
    }
    if (!isCurrent()) return
    const records = await store.listProjectAttachments(projectId)
    const referenced = new Set(records.map((image) => image.original.relativePath))
    for (const entry of entries) {
      if (!isCurrent()) return
      if (entry.kind !== 'file') continue
      const match = /^([a-zA-Z0-9_-]+)\.(png|jpg|webp)$/.exec(entry.name)
      if (!match) continue
      const id = match[1]!
      const path = fileSystemService.paths.join(directory, entry.name)
      if (referenced.has(path) || protectedOriginals.has(originalKey(projectId, id))) continue
      try {
        await fileSystemService.deleteAgentAttachment(projectId, id, path)
        onDeleted?.()
      } catch (error) {
        if (!isAgentImageSourceMissing(error)) throw error
      }
    }
  } finally {
    orphanSweepProtections.delete(protectedOriginals)
  }
}

export type AgentAttachmentCleanupResult = {
  deletedFiles: number
  failedProjects: string[]
  skippedProjects: string[]
}

export async function reclaimWorkspaceAgentImageOrphans(
  store: AgentSessionStore,
  signal: AbortSignal,
): Promise<AgentAttachmentCleanupResult> {
  const result: AgentAttachmentCleanupResult = {
    deletedFiles: 0,
    failedProjects: [],
    skippedProjects: [],
  }
  signal.throwIfAborted()
  let projects
  try {
    projects = await fileSystemService.listDirectory('projects')
  } catch (error) {
    signal.throwIfAborted()
    if (isAgentImageSourceMissing(error)) return result
    throw error
  }
  signal.throwIfAborted()
  for (const project of projects) {
    signal.throwIfAborted()
    if (project.kind !== 'directory' || !/^[a-zA-Z0-9_-]+$/.test(project.name)) continue
    const reclaim = async () => {
      signal.throwIfAborted()
      await reclaimAgentImageOrphans(
        project.name,
        store,
        () => !signal.aborted,
        () => result.deletedFiles++,
      )
      signal.throwIfAborted()
    }
    try {
      // 其他编辑器标签页可能仍持有共享锁；跳过占用中的工程，保留其未提交草稿。
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(
          projectLockName(project.name),
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (lock) await reclaim()
            else result.skippedProjects.push(project.name)
          },
        )
      } else await reclaim()
    } catch {
      signal.throwIfAborted()
      result.failedProjects.push(project.name)
    }
  }
  signal.throwIfAborted()
  return result
}
