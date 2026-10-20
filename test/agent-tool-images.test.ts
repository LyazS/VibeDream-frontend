/** 覆盖工具观察图的原子存储、归属隔离、上传缓存和单次调用暂存规则。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import { createToolImageStaging } from '@/core/agent/runtime/ToolImageStaging'
import {
  MessagePartType,
  AgentMessageRole,
  type AgentSession,
  type AgentToolImage,
} from '@/core/agent/types'
import {
  prepareAgentImages,
  invalidateAgentImageUploads,
} from '@/core/agent/services/agentImageService'
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'
import { agentImageFixture } from './helpers/agent-files'

vi.mock('@/core/managers/filesystem/fileSystemService', async () => ({
  fileSystemService: (await import('./helpers/agent-files')).agentFileSystem,
}))

const image = (id = 'observation'): AgentToolImage => ({
  recordKind: 'tool_image',
  id,
  userId: 'user',
  projectId: 'project',
  blob: new Blob(['immutable observation bytes'], { type: 'image/webp' }),
  description: '素材 video，at=00:00:01+00，完整画面。',
  mimeType: 'image/webp',
  byteSize: 27,
  width: 200,
  height: 100,
})
function session(): AgentSession {
  return {
    id: 'session',
    userId: 'user',
    projectId: 'project',
    createdAt: '',
    updatedAt: '',
    latestModelCall: null,
    toolExecutions: {},
    usageRecords: {},
    messages: [
      {
        id: 'u',
        role: AgentMessageRole.USER,
        created_at: '',
        parts: [{ type: MessagePartType.TEXT, text: 'inspect' }],
      },
      {
        id: 't',
        role: 'tool',
        created_at: '',
        toolCallId: 'c',
        toolName: 'anything',
        parts: [{ type: MessagePartType.IMAGE, attachmentId: 'observation' }],
      },
    ],
  }
}
beforeEach(() => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  indexedDBService.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('initializes an empty database with final attachment indexes and round trips immutable bytes beside user metadata', async () => {
  const store = new AgentSessionStore(),
    data = session(),
    observed = image()
  observed.byteSize = observed.blob.size
  const original = agentImageFixture('original', 'user', 'project')
  data.messages[0]!.parts.push({ type: MessagePartType.IMAGE, attachmentId: original.id })
  const db = await indexedDBService.openDB()
  const tx = db.transaction('agentAttachments')
  expect(tx.objectStore('agentAttachments').keyPath).toBe('key')
  expect([...tx.objectStore('agentAttachments').indexNames]).toEqual(['owner', 'session'])
  await store.save(data, [original, observed])
  const record = await store.readImage(data, observed.id)
  expect(record?.recordKind).toBe('tool_image')
  if (record?.recordKind !== 'tool_image') throw new Error('missing tool record')
  expect(await record.blob.text()).toBe(await observed.blob.text())
  expect(record.description).toBe(observed.description)
  expect(await store.readImage(data, observed.id, { requireUserReference: true })).toBeUndefined()
  expect((await store.listProjectAttachments('project')).map((r) => r.id)).toEqual(['original'])
  await store.save(data)
  expect((await store.readImage(data, observed.id))?.recordKind).toBe('tool_image')
  for (const changes of [{ id: 'other' }, { userId: 'other' }, { projectId: 'other' }])
    expect(await store.readImage({ ...data, ...changes }, observed.id)).toBeUndefined()
  const removed = await store.delete(data)
  expect(removed).toHaveLength(2)
  expect(await store.readImage(data, observed.id)).toBeUndefined()
})

it('rolls back messages and all new image bytes when an attachment add fails', async () => {
  const store = new AgentSessionStore(),
    before = session()
  before.messages.pop()
  await store.save(before)
  const add = IDBObjectStore.prototype.add
  // 在附件写入时模拟容量耗尽，确认消息与图片处于同一个回滚事务。
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (...args) {
    if (this.name === 'agentAttachments') throw new DOMException('quota', 'QuotaExceededError')
    return add.apply(this, args)
  })
  await expect(store.save(session(), [image()])).rejects.toBeDefined()
  expect((await store.load('user', 'project'))[0]!.messages).toEqual(before.messages)
  expect(await store.readImage(before, 'observation')).toBeUndefined()
})

it('rejects unresolvable references, invalid kinds, duplicate IDs, and cross-owner images', async () => {
  const store = new AgentSessionStore(),
    data = session()
  await expect(store.save(data)).rejects.toBeDefined()
  await expect(store.save(data, [image(), image()])).rejects.toThrow('INVALID_AGENT_ATTACHMENT')
  await expect(store.save(data, [{ ...image(), userId: 'other' }])).rejects.toThrow(
    'INVALID_AGENT_ATTACHMENT_OWNER',
  )
  await expect(store.save(data, [{ ...image(), blob: new Blob([]) }])).rejects.toThrow(
    'INVALID_AGENT_ATTACHMENT',
  )
  await store.save(data, [image()])
  const other = {
    ...data,
    messages: [
      {
        ...data.messages[0]!,
        parts: [{ type: MessagePartType.IMAGE as const, attachmentId: 'observation' }],
      },
    ],
  }
  await expect(store.save(other)).rejects.toBeDefined()
  const record = (await store.readImage(data, 'observation'))!
  await indexedDBService.transaction('agentAttachments', 'readwrite', (table) =>
    table.put({ ...record, recordKind: undefined }),
  )
  expect(await store.readImage(data, 'observation')).toBeUndefined()
})

it('rejects a new observation reusing a historical ID without overwriting its Blob', async () => {
  const store = new AgentSessionStore(),
    data = session()
  await store.save(data, [image()])
  const changed = structuredClone(data)
  changed.messages.push({ ...changed.messages[1]!, id: 'another-result', toolCallId: 'new-call' })
  await expect(store.save(changed, [image()])).rejects.toBeDefined()
  expect((await store.load('user', 'project'))[0]!.messages).toHaveLength(2)
  const record = await store.readImage(data, 'observation')
  if (record?.recordKind !== 'tool_image') throw new Error('missing observation')
  expect(await record.blob.text()).toBe(await image().blob.text())
})

it('refreshes expired tool uploads using the saved Blob and preserves it on cache changes and upload failure', async () => {
  const store = new AgentSessionStore(),
    data = session(),
    observed = image()
  await store.save(data, [observed])
  const upload = vi.spyOn(CloudflareTemporaryFileUploader, 'uploadBlob').mockResolvedValue({
    success: true,
    url: 'oss://dashscope-instant/test/observation.webp',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  })
  const resolved = await prepareAgentImages(data, store, new AbortController().signal, () => true)
  expect(resolved.get(observed.id)).toMatchObject({
    kind: 'image',
    description: observed.description,
  })
  expect(await (upload.mock.calls[0]![0] as Blob).text()).toBe(await observed.blob.text())
  await prepareAgentImages(data, store, new AbortController().signal, () => true)
  expect(upload).toHaveBeenCalledOnce()
  await invalidateAgentImageUploads(data, store, () => true)
  const record = await store.readImage(data, observed.id)
  expect(record?.upload).toBeUndefined()
  if (record?.recordKind !== 'tool_image') throw new Error('missing Blob')
  expect(await record.blob.text()).toBe(await observed.blob.text())
  upload.mockResolvedValue({ success: false, error: 'network' })
  await expect(
    prepareAgentImages(data, store, new AbortController().signal, () => true),
  ).rejects.toThrow()
  expect((await store.readImage(data, observed.id))?.recordKind).toBe('tool_image')
})

it('uploads all historical observations once and does not mutate persistent history', async () => {
  const store = new AgentSessionStore(),
    data = session()
  // 历史消息可以完整保留十六张图，本轮全部上传且不能裁剪持久化消息。
  const observations = Array.from({ length: 16 }, (_, i) => image(`image_${i}`))
  data.messages = observations.map((observed, i) => ({
    ...data.messages[1]!,
    id: `m${i}`,
    toolCallId: `c${i}`,
    parts: [{ type: MessagePartType.IMAGE, attachmentId: observed.id }],
  }))
  await store.save(data, observations)
  const upload = vi.spyOn(CloudflareTemporaryFileUploader, 'uploadBlob').mockResolvedValue({
    success: true,
    url: 'oss://dashscope-instant/test/observation.webp',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  })
  const resolved = await prepareAgentImages(data, store, new AbortController().signal, () => true)
  expect(upload).toHaveBeenCalledTimes(16)
  expect(resolved.get('image_0')).toMatchObject({ kind: 'image' })
  expect(resolved.get('image_15')).toMatchObject({ kind: 'image' })
  expect((await store.load('user', 'project'))[0]!.messages).toHaveLength(16)
  expect(await store.readImage(data, 'image_0')).toBeDefined()
})

it('only takes ordered images from its own live invocation and discards late results', () => {
  const controller = new AbortController()
  const staging = createToolImageStaging({
    userId: 'user',
    projectId: 'project',
    signal: controller.signal,
    isCurrent: () => true,
  })
  const first = staging.stageImage(image()),
    second = staging.stageImage(image())
  expect(() => staging.take({ success: true, output: '', attachIds: [second, first] })).toThrow(
    'INVALID_TOOL_IMAGE_REFERENCES',
  )
  expect(() => staging.take({ success: true, output: '', attachIds: [first, first] })).toThrow(
    'INVALID_TOOL_IMAGE_REFERENCES',
  )
  expect(() =>
    staging.take({
      success: true,
      output: '',
      attachIds: [{ type: 'image', image: { id: 'foreign' } }],
    }),
  ).toThrow()
  expect(
    staging.take({ success: true, output: '', attachIds: [first, second] }).map((r) => r.id),
  ).toEqual([first.image.id, second.image.id])
  expect(() => staging.stageImage(image())).toThrow('TOOL_CONTEXT_EXPIRED')
  const late = createToolImageStaging({
    userId: 'user',
    projectId: 'project',
    signal: controller.signal,
    isCurrent: () => true,
  })
  late.stageImage(image())
  controller.abort()
  expect(() => late.take({ success: true, output: '' })).toThrow()
  late.dispose()
})
