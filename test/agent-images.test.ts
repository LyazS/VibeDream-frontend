import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'
import { AgentSessionStore } from '../src/core/agent/runtime/AgentSessionStore'
import { inspectAgentImage, processAgentImage } from '../src/core/agent/services/agentImageService'
import {
  AgentMessageRole,
  MessagePartType,
  type AgentImage,
  type AgentSession,
} from '../src/core/agent/types'
import { assertApiCapabilityEnabled } from '../src/config/apiCapabilities'
import { sanitizeLog } from '../src/core/agent/telemetry/agent-log'

function png(width = 100, height = 80) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([73, 72, 68, 82], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
const attachment = (): AgentImage => ({
  id: 'image',
  blob: new Blob(['encoded'], { type: 'image/png' }),
  mimeType: 'image/png',
  width: 100,
  height: 80,
})
const session = (): AgentSession => ({
  id: 'session',
  userId: 'user',
  projectId: 'project',
  createdAt: '',
  updatedAt: '',
  latestModelCall: null,
  usageRecords: {},
  toolExecutions: {},
  messages: [
    {
      id: 'message',
      role: AgentMessageRole.USER,
      created_at: '',
      parts: [{ type: MessagePartType.IMAGE, imageId: 'image' }],
    },
  ],
})

beforeEach(() => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  indexedDBService.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('inspects actual signatures and dimensions before decoding', async () => {
  expect(inspectAgentImage(png())).toEqual({ mimeType: 'image/png', width: 100, height: 80 })
  expect(() => inspectAgentImage(new Uint8Array([1, 2, 3]))).toThrow('imageInvalid')
  expect(() => inspectAgentImage(png(10000, 10000))).toThrow('imagePixelLimit')
  const decode = vi.fn()
  vi.stubGlobal('createImageBitmap', decode)
  await expect(processAgentImage(new Blob([png(10000, 10000)]))).rejects.toThrow('imagePixelLimit')
  await expect(processAgentImage(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]))).rejects.toThrow(
    'imageOriginalSizeLimit',
  )
  expect(decode).not.toHaveBeenCalled()
})

it('reads JPEG SOF and all three WebP dimension encodings', () => {
  const jpeg = new Uint8Array([
    255, 216, 255, 225, 0, 4, 0, 0, 255, 192, 0, 7, 8, 0, 80, 0, 100, 255, 217,
  ])
  expect(inspectAgentImage(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 100, height: 80 })
  for (const chunk of ['VP8X', 'VP8 ', 'VP8L']) {
    const bytes = new Uint8Array(30)
    bytes.set([...`RIFF0000WEBP${chunk}`].map((letter) => letter.charCodeAt(0)))
    const view = new DataView(bytes.buffer)
    if (chunk === 'VP8X') {
      bytes[24] = 99
      bytes[27] = 79
    }
    if (chunk === 'VP8 ') {
      bytes.set([157, 1, 42], 23)
      view.setUint16(26, 100, true)
      view.setUint16(28, 80, true)
    }
    if (chunk === 'VP8L') {
      bytes[20] = 47
      view.setUint32(21, 99 | (79 << 14), true)
    }
    expect(inspectAgentImage(bytes)).toEqual({ mimeType: 'image/webp', width: 100, height: 80 })
  }
})

it('uses native orientation and re-encodes a bounded bitmap, releasing decode resources', async () => {
  const close = vi.fn()
  const decode = vi.fn().mockResolvedValue({ width: 4000, height: 3000, close })
  vi.stubGlobal('createImageBitmap', decode)
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(['processed'], { type: 'image/webp' })),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  const result = await processAgentImage(
    new Blob([png(4000, 3000)], { type: 'application/incorrect' }),
  )
  expect(decode).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }), {
    imageOrientation: 'from-image',
  })
  expect(result).toMatchObject({ width: 2048, height: 1536, mimeType: 'image/webp' })
  expect(close).toHaveBeenCalledOnce()
  expect(canvas.width).toBe(0)
  expect(canvas.height).toBe(0)
})

it.each(['before', 'read', 'decode', 'encode'] as const)(
  'cancels image preparation at %s and releases any allocated resources',
  async (phase) => {
    const controller = new AbortController()
    const close = vi.fn()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const file = new Blob([png()])
    const read = vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
      if (phase === 'read') await gate
      return png().buffer
    })
    const decode = vi.fn(async () => {
      if (phase === 'decode') await gate
      return { width: 100, height: 80, close }
    })
    const toBlob = vi.fn(async (done: (blob: Blob) => void) => {
      if (phase === 'encode') await gate
      done(new Blob(['encoded'], { type: 'image/webp' }))
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toBlob,
    }
    vi.stubGlobal('createImageBitmap', decode)
    vi.stubGlobal('document', { createElement: () => canvas })
    if (phase === 'before') controller.abort()
    const pending = processAgentImage(file, controller.signal)
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    if (phase === 'read') await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    if (phase === 'decode') await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    if (phase === 'encode') await vi.waitFor(() => expect(toBlob).toHaveBeenCalledOnce())
    controller.abort()
    release()
    await cancelled
    expect(decode).toHaveBeenCalledTimes(phase === 'before' || phase === 'read' ? 0 : 1)
    expect(close).toHaveBeenCalledTimes(phase === 'decode' || phase === 'encode' ? 1 : 0)
    expect(toBlob).toHaveBeenCalledTimes(phase === 'encode' ? 1 : 0)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  },
)

it('rolls back a session save containing a missing image', async () => {
  const store = new AgentSessionStore()
  const original = session()
  await store.save(original, [attachment()])
  const changed = structuredClone(original)
  changed.updatedAt = 'changed'
  changed.messages[0]!.parts.push({ type: MessagePartType.IMAGE, imageId: 'missing' })
  changed.messages[0]!.parts.push({ type: MessagePartType.IMAGE, imageId: 'new' })
  await expect(store.save(changed, [{ ...attachment(), id: 'new' }])).rejects.toBeDefined()
  expect(await store.load('user', 'project')).toEqual([original])
  expect((await store.readImage(original, 'image')).blob.size).toBe(7)
  await expect(store.readImage(original, 'new')).rejects.toThrow()
  await expect(store.readImage({ ...original, userId: 'other' }, 'image')).rejects.toThrow()
  await expect(store.readImage({ ...original, id: 'other' }, 'image')).rejects.toThrow()
})

it('rolls back both stores when deletion fails and refuses late upload cache creation', async () => {
  const store = new AgentSessionStore()
  const original = session()
  await store.save(original, [attachment()])
  const image = await store.readImage(original, 'image')
  const originalDelete = IDBObjectStore.prototype.delete
  const fail = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (key) {
    const result = originalDelete.call(this, key)
    if (this.name === 'agentSessions') queueMicrotask(() => this.transaction.abort())
    return result
  })
  await expect(store.delete(original)).rejects.toBeDefined()
  expect(await store.load('user', 'project')).toEqual([original])
  expect((await store.readImage(original, 'image')).id).toBe('image')
  fail.mockRestore()
  await store.delete(original)
  await store.updateImageUpload(
    image,
    { url: 'oss://dashscope-instant/late', expiresAt: '' },
    () => true,
  )
  await expect(store.readImage(original, 'image')).rejects.toThrow()
})

it('allows image policies with only agent enabled, and redacts temporary image URLs from logs', () => {
  expect(() =>
    assertApiCapabilityEnabled(
      '/api/media/upload-policies',
      JSON.stringify({ capability: 'agent' }),
    ),
  ).not.toThrow()
  expect(() =>
    assertApiCapabilityEnabled(
      '/api/media/upload-policies',
      JSON.stringify({ capability: 'indexing' }),
    ),
  ).toThrow()
  expect(
    sanitizeLog({
      content: [
        { type: 'image_url', image_url: { url: 'oss://dashscope-instant/private/file.webp' } },
      ],
    }),
  ).toEqual({
    value: { content: [{ type: 'image_url', image_url: { url: '[REDACTED]' } }] },
    redacted: true,
    truncated: false,
  })
})
