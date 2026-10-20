import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import { executeImportAttachment } from '@/core/agent/tools/importAttachment'
import { executeInsertClip } from '@/core/agent/tools/insertClip'
import { createToolRuntime } from '@/core/agent/runtime/ToolRuntime'
import { createMediaFileImportService } from '@/core/media-import/MediaFileImportService'
import { createUnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import { createUnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'
import { ModuleRegistry } from '@/core/modules/ModuleRegistry'
import { JobRuntime } from '@/core/jobs/JobRuntime'
import {
  createMediaReadyRequest,
  createMediaReadyResolver,
} from '@/core/jobs/resolvers/MediaReadyResolver'
import { createMediaFileAvailableResolver } from '@/core/jobs/resolvers/MediaFileAvailableResolver'
import { createMediaDecodedResolver } from '@/core/jobs/resolvers/MediaDecodedResolver'
import { createMediaSourceProcessedResolver } from '@/core/jobs/resolvers/MediaSourceProcessedResolver'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { MediaItemLoader } from '@/core/managers/media/MediaItemLoader'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { BunnyProcessor, type BunnyProcessingResult } from '@/core/bunnyUtils/BunnyProcessor'
import {
  deleteAgentImageSource,
  readAgentImageSource,
} from '@/core/agent/services/agentImageService'
import type { ToolExecutionContext, ToolResult } from '@/core/agent/tools/types'
import type { AgentSession } from '@/core/agent/types'
import { AgentMessageRole, MessagePartType } from '@/core/agent/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { SimpleCommand } from '@/core/modules/commands/types'
import { agentFiles, agentImageFixture } from './helpers/agent-files'

const active = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof makeStore> }))
vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => active.store }))
vi.mock('@/core/managers/filesystem/fileSystemService', async () => {
  const { agentFiles: files, agentFileSystem: fs } = await import('./helpers/agent-files')
  return {
    fileSystemService: {
      paths: fs.paths,
      checkPermission: vi.fn(async () => ({ hasAccess: true })),
      directoryExists: vi.fn(async () => true),
      createDirectory: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, data: Blob | string) => {
        files.set(path, typeof data === 'string' ? new Blob([data]) : data)
      }),
      readFile: vi.fn(async (path: string) => {
        const file = files.get(path)
        if (!file) throw new DOMException('Missing file', 'NotFoundError')
        return file.text()
      }),
      readFileAsBlob: vi.fn(async (path: string) => {
        const file = files.get(path)
        if (!file) throw new DOMException('Missing file', 'NotFoundError')
        return file
      }),
      readAgentAttachment: fs.readAgentAttachment.bind(fs),
      deleteAgentAttachment: fs.deleteAgentAttachment.bind(fs),
      fileExists: vi.fn(async (path: string) => files.has(path)),
      deleteFile: vi.fn(async (path: string) => {
        files.delete(path)
      }),
      listDirectory: vi.fn(async (path: string) =>
        [...files.keys()]
          .filter((name) => fs.paths.dirname(name) === path)
          .map((name) => ({ path: name, name: fs.paths.basename(name), kind: 'file' })),
      ),
    },
  }
})

function makeStore() {
  const registry = new ModuleRegistry()
  registry.register('autosave', {
    setupMediaItemWatcher: vi.fn(),
    cleanupMediaItemWatcher: vi.fn(),
  })
  const media = createUnifiedMediaModule(registry)
  registry.register('media', media)
  const directory = createUnifiedDirectoryModule(registry)
  const root = directory.initializeRootDirectory()
  const timelineItems = reactive<UnifiedTimelineItemData[]>([])
  const removeTimelineItem = async (id: string) => {
    const index = timelineItems.findIndex((item) => item.id === id)
    if (index >= 0) timelineItems.splice(index, 1)
  }
  registry.register('timeline', { timelineItems: ref(timelineItems), removeTimelineItem })
  const runtime = new JobRuntime({ schedulerOptions: { concurrency: { 'local-heavy': 2 } } })
  runtime.registerResolver(createMediaFileAvailableResolver(media))
  runtime.registerResolver(createMediaDecodedResolver(media))
  runtime.registerResolver(createMediaSourceProcessedResolver(media))
  runtime.registerResolver(createMediaReadyResolver(media))
  const commands: SimpleCommand[] = []
  return {
    ...media,
    ...directory,
    directories: directory.directories.value,
    projectId: 'p1',
    rootId: root.id,
    timelineItems,
    commands,
    runtime,
    ensureMediaReady: vi.fn((id: string) => runtime.ensure(createMediaReadyRequest(id))),
    getTrack: (id: string) => (id === 'video' ? { id, type: 'video' } : undefined),
    addTimelineItem: async (item: UnifiedTimelineItemData) => {
      timelineItems.push(item)
    },
    removeTimelineItem,
    getTimelineItem: (id: string) => timelineItems.find((item) => item.id === id),
    ensureTimelineItemResolved: vi.fn(async () => {}),
    startBatch: () => {
      const batch: SimpleCommand[] = []
      return { addCommand: (command: SimpleCommand) => batch.push(command), build: () => batch }
    },
    executeBatchCommand: vi.fn(async (batch: SimpleCommand[]) => {
      for (const command of batch) {
        await command.execute()
        commands.push(command)
      }
    }),
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function decoded(): BunnyProcessingResult {
  return {
    bunnyObjects: { originalWidth: 3840, originalHeight: 2160 },
    duration: 150,
    durationN: 150n,
  }
}
function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    toolCallId: crypto.randomUUID(),
    userId: 'u1',
    projectId: 'p1',
    sessionId: 's1',
    modelCallId: 'm1',
    signal: new AbortController().signal,
    isCurrent: () => true,
    ...overrides,
  }
}
function session(): AgentSession {
  return {
    id: 's1',
    userId: 'u1',
    projectId: 'p1',
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
        parts: [{ type: MessagePartType.IMAGE, attachmentId: 'image' }],
      },
    ],
  }
}
function payload(result: ToolResult) {
  return JSON.parse(result.output)
}
async function persistFile(path: string, data: Parameters<typeof fileSystemService.writeFile>[1]) {
  agentFiles.set(path, typeof data === 'string' ? new Blob([data]) : (data as Blob))
}
let sessions: AgentSessionStore

beforeEach(async () => {
  vi.clearAllMocks()
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  agentFiles.clear()
  vi.mocked(fileSystemService.writeFile).mockImplementation(persistFile)
  await globalMetaFileManager.initialize('p1')
  active.store = makeStore()
  sessions = new AgentSessionStore()
  await sessions.save(session(), [agentImageFixture('image')])
  vi.spyOn(BunnyProcessor.prototype, 'processMedia').mockImplementation(async () => decoded())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  indexedDBService.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('import_attachment integration', () => {
  it('imports original bytes through the registered tool and immediately inserts using the returned ID', async () => {
    const result = await createToolRuntime().execute(
      { id: 'import', name: 'import_attachment', args: { attachmentId: 'image' } },
      context(),
    )
    expect(result.success).toBe(true)
    const data = payload(result)
    expect(data).toMatchObject({
      attachmentId: 'image',
      mediaType: 'image',
      width: 3840,
      height: 2160,
    })
    expect(data.mediaId).toMatch(/^media_[\w-]{12}$/)
    const media = active.store.getMediaItem(data.mediaId)!
    expect(media.parentDirectoryId).toBe(active.store.rootId)
    expect(active.store.getAssetIdsInDirectory(active.store.rootId)).toEqual([media.id])
    expect(await agentFiles.get(`projects/p1/media/${media.id}.png`)!.text()).toBe(
      'original image bytes',
    )
    const meta = JSON.parse(await agentFiles.get(`projects/p1/media/${media.id}.meta`)!.text())
    expect(meta).toMatchObject({
      id: media.id,
      duration: 150,
      mediaType: 'image',
      source: { type: 'user-selected' },
    })
    expect(meta.source).not.toHaveProperty('importContext')
    const insert = await executeInsertClip({
      mediaId: data.mediaId,
      trackId: 'video',
      start: '00:00:00+00',
    })
    expect(insert.success).toBe(true)
    expect(active.store.timelineItems[0]).toMatchObject({
      mediaItemId: data.mediaId,
      timeRange: { timelineStartTime: 0, timelineEndTime: 150 },
    })
    await active.store.commands[0]!.undo()
    expect(active.store.timelineItems).toHaveLength(0)
    expect(active.store.getMediaItem(data.mediaId)).toBe(media)
  })

  it('uses the requested directory and creates independent IDs for repeated and concurrent imports', async () => {
    const target = active.store.createDirectory('images', active.store.rootId)
    if (!target.success) throw new Error(target.error)
    const args = { attachmentId: 'image', targetDirectoryId: target.directory.id }
    const first = await executeImportAttachment(args, context())
    const concurrent = await Promise.all([
      executeImportAttachment(args, context()),
      executeImportAttachment(args, context()),
    ])
    const ids = [first, ...concurrent].map((result) => {
      expect(result.success).toBe(true)
      return payload(result).mediaId as string
    })
    expect(new Set(ids).size).toBe(3)
    expect(active.store.getAssetIdsInDirectory(target.directory.id).sort()).toEqual(ids.sort())
    for (const id of ids) expect(agentFiles.has(`projects/p1/media/${id}.meta`)).toBe(true)
  })

  it('waits for decoding, original writing and meta writing before returning a usable ID', async () => {
    const decoding = deferred<BunnyProcessingResult>()
    vi.mocked(BunnyProcessor.prototype.processMedia).mockReturnValueOnce(decoding.promise)
    const original = deferred()
    const meta = deferred()
    vi.mocked(fileSystemService.writeFile).mockImplementation(async (path, data) => {
      await (path.endsWith('.meta') ? meta.promise : original.promise)
      agentFiles.set(path, typeof data === 'string' ? new Blob([data]) : (data as Blob))
    })
    let settled = false
    const pending = executeImportAttachment({ attachmentId: 'image' }, context()).then((result) => {
      settled = true
      return result
    })
    await vi.waitFor(() => expect(BunnyProcessor.prototype.processMedia).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    decoding.resolve(decoded())
    await vi.waitFor(() => expect(fileSystemService.writeFile).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    original.resolve()
    await vi.waitFor(() => expect(fileSystemService.writeFile).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)
    meta.resolve()
    expect((await pending).success).toBe(true)
  })

  it.each(['decode', 'original', 'meta'])(
    'propagates %s failures without a mediaId and retries with a fresh asset',
    async (phase) => {
      if (phase === 'decode')
        vi.mocked(BunnyProcessor.prototype.processMedia).mockRejectedValueOnce(
          new Error('decode failed'),
        )
      else {
        vi.mocked(fileSystemService.writeFile).mockImplementation(async (path, data) => {
          if (path.endsWith('.meta') === (phase === 'meta')) throw new Error('write failed')
          return persistFile(path, data)
        })
      }
      const failed = await executeImportAttachment({ attachmentId: 'image' }, context())
      expect(failed.success).toBe(false)
      expect(payload(failed)).not.toHaveProperty('mediaId')
      const failedId = active.store.getAllMediaItems()[0]!.id
      expect(active.store.getMediaItem(failedId)!.mediaStatus).toBe('error')
      await expect(active.store.ensureMediaReady(failedId)).rejects.toThrow()
      expect(active.store.getMediaItem(failedId)!.mediaStatus).toBe('error')
      expect(
        (await executeInsertClip({ mediaId: failedId, trackId: 'video', start: '00:00:00+00' }))
          .success,
      ).toBe(false)
      if (phase !== 'decode') vi.mocked(fileSystemService.writeFile).mockImplementation(persistFile)
      const retry = await executeImportAttachment({ attachmentId: 'image' }, context())
      expect(retry.success).toBe(true)
      expect(payload(retry).mediaId).not.toBe(failedId)
    },
  )

  it('requires the local original even when the upload URL is still valid', async () => {
    const image = (await sessions.readImage(session(), 'image'))!
    await sessions.updateImageUpload(
      image,
      { url: 'oss://dashscope-instant/image', expiresAt: '2099-01-01T00:00:00Z' },
      () => true,
    )
    agentFiles.delete(image.original.relativePath)
    expect(
      payload(await executeImportAttachment({ attachmentId: 'image' }, context())),
    ).toMatchObject({ code: 'file_missing' })
    expect(active.store.getAllMediaItems()).toHaveLength(0)
  })

  it.each([{ userId: 'other' }, { sessionId: 'other' }, { projectId: 'other' }])(
    'does not import another owner or session: %j',
    async (scope) => {
      const result = await executeImportAttachment({ attachmentId: 'image' }, context(scope))
      expect(result.success).toBe(false)
      expect(payload(result)).not.toHaveProperty('mediaId')
      expect(active.store.getAllMediaItems()).toHaveLength(0)
    },
  )

  it.each(['unreferenced', 'assistant'])(
    'rejects a stored attachment that is %s in the current session',
    async (kind) => {
      const changed = session()
      if (kind === 'unreferenced') changed.messages = []
      else changed.messages[0]!.role = AgentMessageRole.ASSISTANT
      if (kind === 'assistant') {
        await expect(sessions.save(changed)).rejects.toThrow()
        const owner = sessions.owner(changed.userId, changed.projectId)
        const key = JSON.stringify([owner, changed.id])
        await indexedDBService.transaction('agentSessions', 'readwrite', (table) =>
          table.put({ key, owner, sessionKey: key, data: changed }),
        )
      } else await sessions.save(changed)
      expect(await sessions.readImage(changed, 'image')).toBeDefined()
      expect(
        payload(await executeImportAttachment({ attachmentId: 'image' }, context())),
      ).toMatchObject({ code: 'attachment_not_found' })
      expect(active.store.getAllMediaItems()).toHaveLength(0)
    },
  )

  it('rejects a missing directory and malformed arguments before creating media', async () => {
    expect(
      payload(
        await executeImportAttachment(
          { attachmentId: 'image', targetDirectoryId: 'missing' },
          context(),
        ),
      ).code,
    ).toBe('directory_not_found')
    for (const args of [
      {},
      { attachmentId: ' ' },
      { attachmentId: 'image', targetDirectoryId: 1 },
    ]) {
      expect(payload(await executeImportAttachment(args, context())).code).toBe('invalid_arguments')
    }
    expect(active.store.getAllMediaItems()).toHaveLength(0)
  })

  it.each(['abort', 'account', 'project', 'session-selection', 'delete-media'])(
    'isolates decoding results after %s',
    async (event) => {
      const decoding = deferred<BunnyProcessingResult>()
      vi.mocked(BunnyProcessor.prototype.processMedia).mockReturnValueOnce(decoding.promise)
      const controller = new AbortController()
      let current = true
      const pending = executeImportAttachment(
        { attachmentId: 'image' },
        context({ signal: controller.signal, isCurrent: () => current }),
      )
      await vi.waitFor(() => expect(BunnyProcessor.prototype.processMedia).toHaveBeenCalledOnce())
      if (event === 'abort') controller.abort()
      if (event === 'account') current = false
      if (event === 'project') {
        active.store.projectId = 'p2'
        await globalMetaFileManager.initialize('p2')
      }
      if (event === 'delete-media')
        await active.store.deleteAssetItem(
          active.store.getAllMediaItems()[0]!.id,
          active.store.rootId,
        )
      if (event === 'session-selection')
        await sessions.save({ ...session(), id: 'other', messages: [] })
      decoding.resolve(decoded())
      const result = await pending
      expect(result.success).toBe(event === 'session-selection')
      if (event !== 'session-selection') {
        expect(payload(result)).not.toHaveProperty('mediaId')
        expect(fileSystemService.writeFile).not.toHaveBeenCalled()
      }
      expect([...agentFiles.keys()].some((path) => path.startsWith('projects/p2/'))).toBe(false)
    },
  )

  it.each(['original', 'meta'])(
    'does not report success after cancellation during %s writing',
    async (phase) => {
      const writing = deferred()
      const controller = new AbortController()
      vi.mocked(fileSystemService.writeFile).mockImplementation(async (path, data) => {
        if (path.endsWith('.meta') === (phase === 'meta')) await writing.promise
        return persistFile(path, data)
      })
      const pending = executeImportAttachment(
        { attachmentId: 'image' },
        context({ signal: controller.signal }),
      )
      await vi.waitFor(() =>
        expect(fileSystemService.writeFile).toHaveBeenCalledTimes(phase === 'meta' ? 2 : 1),
      )
      controller.abort()
      writing.resolve()
      const result = await pending
      expect(payload(result).code).toBe('cancelled')
      expect(payload(result)).not.toHaveProperty('mediaId')
      if (phase === 'original') expect(fileSystemService.writeFile).toHaveBeenCalledOnce()
    },
  )

  it.each(['permission', 'original-write'])(
    'stops further writes after the project changes during %s',
    async (phase) => {
      const blocked = deferred()
      let started = false
      if (phase === 'permission') {
        vi.mocked(fileSystemService.checkPermission).mockImplementationOnce(async () => {
          started = true
          await blocked.promise
          return { hasAccess: true }
        })
      } else {
        vi.mocked(fileSystemService.writeFile).mockImplementationOnce(async (path, data) => {
          started = true
          await blocked.promise
          return persistFile(path, data)
        })
      }
      const pending = executeImportAttachment({ attachmentId: 'image' }, context())
      await vi.waitFor(() => expect(started).toBe(true))
      active.store.projectId = 'p2'
      await globalMetaFileManager.initialize('p2')
      blocked.resolve()
      const result = await pending
      expect(result.success).toBe(false)
      expect(payload(result)).not.toHaveProperty('mediaId')
      expect([...agentFiles.keys()].some((path) => path.startsWith('projects/p2/'))).toBe(false)
      expect([...agentFiles.keys()].some((path) => path.endsWith('.meta'))).toBe(false)
      expect(fileSystemService.writeFile).toHaveBeenCalledTimes(phase === 'permission' ? 0 : 1)
    },
  )

  it('keeps imported media and clips after deleting a session and reloads from independent media files', async () => {
    const result = await executeImportAttachment({ attachmentId: 'image' }, context())
    const id = payload(result).mediaId
    expect(
      (await executeInsertClip({ mediaId: id, trackId: 'video', start: '00:00:00+00' })).success,
    ).toBe(true)
    for (const image of await sessions.delete(session())) await deleteAgentImageSource(image)
    expect(active.store.timelineItems[0]!.mediaItemId).toBe(id)
    expect(active.store.getMediaItem(id)!.mediaStatus).toBe('ready')
    const [reloaded] = await new MediaItemLoader().loadMediaItemsFromMeta('p1')
    expect(reloaded).toMatchObject({
      id,
      mediaType: 'image',
      parentDirectoryId: active.store.rootId,
    })
    expect(
      await globalMetaFileManager.loadMediaFile({ id, ext: '.png' }).then((file) => file.text()),
    ).toBe('original image bytes')
  })

  it('keeps the original after deleting media, and keeps successful imports when insert_clip fails', async () => {
    const first = payload(
      await executeImportAttachment({ attachmentId: 'image' }, context()),
    ).mediaId
    expect(
      (await executeInsertClip({ mediaId: first, trackId: 'missing', start: '00:00:00+00' }))
        .success,
    ).toBe(false)
    expect(active.store.getMediaItem(first)!.mediaStatus).toBe('ready')
    expect((await active.store.deleteAssetItem(first, active.store.rootId)).success).toBe(true)
    const image = (await sessions.readImage(session(), 'image'))!
    expect(await readAgentImageSource(image).then((blob) => blob.text())).toBe(
      'original image bytes',
    )
    expect(active.store.getAllMediaItems()).toHaveLength(0)
    const second = payload(
      await executeImportAttachment({ attachmentId: 'image' }, context()),
    ).mediaId
    expect(second).not.toBe(first)
  })

  it('shares the same pipeline with manual imports while allowing manual processing in the background', async () => {
    const decoding = deferred<BunnyProcessingResult>()
    vi.mocked(BunnyProcessor.prototype.processMedia).mockReturnValueOnce(decoding.promise)
    const file = new File(['manual bytes'], 'manual.png', { type: 'image/png' })
    const media = await createMediaFileImportService(active.store).importFile(
      file,
      active.store.rootId,
    )
    expect(media.mediaStatus).not.toBe('ready')
    decoding.resolve(decoded())
    await vi.waitFor(() => expect(media.mediaStatus).toBe('ready'))
    expect(await agentFiles.get(`projects/p1/media/${media.id}.png`)!.text()).toBe('manual bytes')
  })
})
