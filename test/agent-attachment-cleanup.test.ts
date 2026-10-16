import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'
import { AgentSessionStore } from '../src/core/agent/runtime/AgentSessionStore'
import {
  reclaimWorkspaceAgentImageOrphans,
  retainAgentAttachment,
} from '../src/core/agent/services/agentImageService'
import {
  AgentMessageRole,
  MessagePartType,
  type AgentImage,
  type AgentSession,
} from '../src/core/agent/types'
import { agentFiles, agentFileSystem, agentImageFixture } from './helpers/agent-files'

vi.mock('@/core/managers/filesystem/fileSystemService', async () => ({
  fileSystemService: (await import('./helpers/agent-files')).agentFileSystem,
}))

function sessionFor(image: AgentImage): AgentSession {
  return {
    id: 'session',
    userId: image.userId,
    projectId: image.projectId,
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
        parts: [{ type: MessagePartType.IMAGE, attachmentId: image.id }],
      },
    ],
  }
}

beforeEach(() => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('navigator', {})
  agentFiles.clear()
})

afterEach(() => {
  indexedDBService.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reclaims every project in the workspace while retaining records from all accounts and held drafts', async () => {
  const store = new AgentSessionStore()
  const first = agentImageFixture('owned', 'user1', 'project1')
  const second = agentImageFixture('other-account', 'user2', 'project2')
  await store.save(sessionFor(first), [first])
  await store.save(sessionFor(second), [second])
  const orphans = [
    agentImageFixture('orphan1', 'user1', 'project1'),
    agentImageFixture('orphan2', 'user2', 'project2'),
  ]
  const draft = agentImageFixture('draft', 'user3', 'project3')
  const release = retainAgentAttachment(draft.projectId, draft.id)
  const untouched = [
    'projects/project1/media/original.png',
    'projects/project1/agent/attachments/manual.txt',
    'projects/project1/agent/attachments/nested/extra.png',
    'projects/invalid.name/agent/attachments/orphan.png',
    'projects/notes.txt',
  ]
  for (const path of untouched) agentFiles.set(path, new Blob(['untouched']))
  try {
    expect(await reclaimWorkspaceAgentImageOrphans(store, new AbortController().signal)).toEqual({
      deletedFiles: 2,
      failedProjects: [],
      skippedProjects: [],
    })
    for (const orphan of orphans) expect(agentFiles.has(orphan.original.relativePath)).toBe(false)
    for (const image of [first, second, draft])
      expect(agentFiles.has(image.original.relativePath)).toBe(true)
    for (const path of untouched) expect(agentFiles.has(path)).toBe(true)
  } finally {
    release()
  }
})

it('handles an empty workspace and a missing projects directory without creating directories', async () => {
  const store = new AgentSessionStore()
  const expected = { deletedFiles: 0, failedProjects: [], skippedProjects: [] }
  expect(await reclaimWorkspaceAgentImageOrphans(store, new AbortController().signal)).toEqual(
    expected,
  )
  vi.spyOn(agentFileSystem, 'listDirectory').mockRejectedValueOnce(
    new DOMException('', 'NotFoundError'),
  )
  expect(await reclaimWorkspaceAgentImageOrphans(store, new AbortController().signal)).toEqual(
    expected,
  )
})

it('reports workspace read failures instead of treating them as an empty successful cleanup', async () => {
  vi.spyOn(agentFileSystem, 'listDirectory').mockRejectedValueOnce(
    new DOMException('Denied', 'NotAllowedError'),
  )
  await expect(
    reclaimWorkspaceAgentImageOrphans(new AgentSessionStore(), new AbortController().signal),
  ).rejects.toMatchObject({ name: 'NotAllowedError' })
})

it('keeps files when metadata cannot be read and continues with other projects', async () => {
  const store = new AgentSessionStore()
  const failed = agentImageFixture('keep', 'user', 'failed-project')
  const orphan = agentImageFixture('remove', 'user', 'other-project')
  const readRecords = store.listProjectAttachments.bind(store)
  vi.spyOn(store, 'listProjectAttachments').mockImplementation(async (projectId) => {
    if (projectId === failed.projectId) throw new Error('IndexedDB read failed')
    return readRecords(projectId)
  })
  expect(await reclaimWorkspaceAgentImageOrphans(store, new AbortController().signal)).toEqual({
    deletedFiles: 1,
    failedProjects: ['failed-project'],
    skippedProjects: [],
  })
  expect(agentFiles.has(failed.original.relativePath)).toBe(true)
  expect(agentFiles.has(orphan.original.relativePath)).toBe(false)
})

it('counts successful deletions even when a later deletion fails within the same project', async () => {
  const removed = agentImageFixture('removed', 'user', 'project1')
  const failed = agentImageFixture('failed', 'user', 'project1')
  const other = agentImageFixture('other', 'user', 'project2')
  const deleteSource = agentFileSystem.deleteAgentAttachment.bind(agentFileSystem)
  vi.spyOn(agentFileSystem, 'deleteAgentAttachment').mockImplementation(async (...args) => {
    if (args[1] === failed.id) throw new DOMException('Denied', 'NotAllowedError')
    return deleteSource(...args)
  })
  expect(
    await reclaimWorkspaceAgentImageOrphans(new AgentSessionStore(), new AbortController().signal),
  ).toEqual({
    deletedFiles: 2,
    failedProjects: ['project1'],
    skippedProjects: [],
  })
  expect(agentFiles.has(removed.original.relativePath)).toBe(false)
  expect(agentFiles.has(failed.original.relativePath)).toBe(true)
  expect(agentFiles.has(other.original.relativePath)).toBe(false)
})

it('stops further deletions when the settings task is cancelled', async () => {
  const first = agentImageFixture('first', 'user', 'project1')
  const second = agentImageFixture('second', 'user', 'project2')
  const controller = new AbortController()
  const deleteSource = agentFileSystem.deleteAgentAttachment.bind(agentFileSystem)
  vi.spyOn(agentFileSystem, 'deleteAgentAttachment').mockImplementationOnce(async (...args) => {
    await deleteSource(...args)
    controller.abort()
  })
  await expect(
    reclaimWorkspaceAgentImageOrphans(new AgentSessionStore(), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(agentFiles.has(first.original.relativePath)).toBe(false)
  expect(agentFiles.has(second.original.relativePath)).toBe(true)
})

it('skips projects with shared attachment leases and reclaims them after their leases are released', async () => {
  const held = new Set<string>()
  const request = vi.fn(
    async (
      name: string,
      options: LockOptions,
      callback: (lock: object | null) => Promise<void>,
    ) => {
      if (options.mode === 'shared') {
        held.add(name)
        try {
          await callback({ name })
        } finally {
          held.delete(name)
        }
      } else await callback(held.has(name) ? null : { name })
    },
  )
  vi.stubGlobal('navigator', { locks: { request } })
  const busy = agentImageFixture('draft', 'user', 'busy')
  const orphan = agentImageFixture('orphan', 'user', 'idle')
  const release = retainAgentAttachment(busy.projectId, busy.id)
  try {
    const result = await reclaimWorkspaceAgentImageOrphans(
      new AgentSessionStore(),
      new AbortController().signal,
    )
    expect(result).toEqual({ deletedFiles: 1, failedProjects: [], skippedProjects: ['busy'] })
    expect(agentFiles.has(busy.original.relativePath)).toBe(true)
    expect(agentFiles.has(orphan.original.relativePath)).toBe(false)
  } finally {
    release()
  }
  await vi.waitFor(() => expect(held.size).toBe(0))
  expect(
    await reclaimWorkspaceAgentImageOrphans(new AgentSessionStore(), new AbortController().signal),
  ).toEqual({ deletedFiles: 1, failedProjects: [], skippedProjects: [] })
  expect(agentFiles.has(busy.original.relativePath)).toBe(false)
})
