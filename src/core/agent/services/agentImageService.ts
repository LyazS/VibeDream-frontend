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
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { FileSystemError } from '@/core/filesystem/errors/FileSystemError'
import { ErrorCode } from '@/core/filesystem/errors/ErrorCodes'

export const AGENT_IMAGE_LIMITS = {
  count: 4,
  originalBytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  edge: 2048,
  encodedBytes: 2 * 1024 * 1024,
} as const

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
  | { kind: 'image'; url: string; source: 'available' | 'missing'; fileName: string }
  | { kind: 'unavailable'; reason: 'source_missing'; fileName: string }
  | { kind: 'unavailable'; reason: 'record_missing'; fileName?: never }

// Protect original files across preparation, shared drafts and in-flight local commits.
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
    // Draft leases are synchronous; preparation separately awaits acquisition before writing.
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

/** Read dimensions before allocating a decoded bitmap, independently of media import. */
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
  if (width * height > AGENT_IMAGE_LIMITS.pixels)
    throw new AgentImageProcessingError('imagePixelLimit')
  return { mimeType, width, height }
}

export async function processAgentImage(
  file: Blob,
  signal: AbortSignal | undefined,
  target: AgentAttachmentScope & { id: string },
): Promise<AgentImage> {
  signal?.throwIfAborted()
  if (file.size > AGENT_IMAGE_LIMITS.originalBytes)
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
    // A partial write or an uninterruptible late decode still belongs to this fixed project.
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
  const bitmap = await createImageBitmap(new Blob([file], { type: mimeType }), {
    imageOrientation: 'from-image',
  })
  let canvas: HTMLCanvasElement | undefined
  try {
    signal?.throwIfAborted()
    if (!bitmap.width || !bitmap.height) throw new AgentImageProcessingError('imageInvalid')
    if (bitmap.width * bitmap.height > AGENT_IMAGE_LIMITS.pixels)
      throw new AgentImageProcessingError('imagePixelLimit')
    const scale = Math.min(1, AGENT_IMAGE_LIMITS.edge / Math.max(bitmap.width, bitmap.height))
    canvas = document.createElement('canvas')
    canvas.width = params?.width ?? Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = params?.height ?? Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new AgentImageProcessingError('imageProcessingFailed')
    const encodingCanvas = canvas
    const outputMimeType = params?.mimeType ?? 'image/webp'
    for (let attempt = 0; attempt < (params ? 1 : 8); attempt++) {
      signal?.throwIfAborted()
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const quality = params?.quality ?? Math.max(0.55, 0.9 - attempt * 0.1)
      const blob = await new Promise<Blob>((resolve, reject) => {
        encodingCanvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new AgentImageProcessingError('imageEncodingFailed')),
          outputMimeType,
          quality,
        )
      })
      signal?.throwIfAborted()
      if (blob.type !== outputMimeType || !blob.size)
        throw new AgentImageProcessingError('imageEncodingFailed')
      if (blob.size <= AGENT_IMAGE_LIMITS.encodedBytes)
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
    bitmap.close()
    if (canvas) canvas.width = canvas.height = 0
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
function validUpload(upload: AgentAttachmentRecord['upload']): boolean {
  return Boolean(
    typeof upload?.url === 'string' &&
      typeof upload.expiresAt === 'string' &&
      upload.url.startsWith('oss://dashscope-instant/') &&
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
        url: image.upload!.url,
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
    const result = await CloudflareTemporaryFileUploader.uploadBlob(
      blob,
      {
        capability: 'agent',
        purpose: 'agent-image',
        projectId: session.projectId,
        fileName: `${crypto.randomUUID()}.webp`,
        mimeType: image.conversionParams.mimeType,
        byteSize: blob.size,
        width: image.conversionParams.width,
        height: image.conversionParams.height,
      },
      undefined,
      signal,
    )
    check()
    const upload = { url: result.url ?? '', expiresAt: result.expiresAt ?? '' }
    if (!result.success || !validUpload(upload)) throw new AgentImageUploadError(result.error)
    if (!(await this.store.updateImageUpload(image, upload, isCurrent)))
      throw new DOMException('图片准备已取消', 'AbortError')
    check()
    return { kind: 'image', url: upload.url, source: 'available', fileName }
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
  const ids = new Set(
    session.messages.flatMap((message) =>
      message.role === 'user'
        ? message.parts.flatMap((part) =>
            part.type === MessagePartType.IMAGE && part.attachmentId ? [part.attachmentId] : [],
          )
        : [],
    ),
  )
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
  // A commit can release its draft lease after the record snapshot was read.
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
      // Other editor tabs hold shared leases; skip busy projects instead of deleting their drafts.
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
