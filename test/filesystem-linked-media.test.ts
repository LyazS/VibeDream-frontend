import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import {
  isLinkedFileRecord,
  splitLinkedRelativePath,
} from '@/core/datasource/providers/linked-file/LinkedFileSource'
import {
  clearLinkedHandles,
  getLinkedHandle,
  pruneLinkedHandles,
  registerLinkedHandle,
} from '@/core/datasource/providers/linked-file/LinkedMediaBindings'
import { hashFile } from '@/core/utils/hashFile'

const scope = { workspaceKey: 'workspace-1', projectId: 'project-1' }
const handle = { kind: 'directory', name: 'folder' } as FileSystemDirectoryHandle

beforeEach(() => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})

describe('linked media bindings', () => {
  it('only prunes bindings of the specific workspace and project', async () => {
    const otherWorkspace = { ...scope, workspaceKey: 'workspace-2' }
    const otherProject = { ...scope, projectId: 'project-2' }
    for (const current of [scope, otherProject, otherWorkspace]) {
      await registerLinkedHandle(current, 'root', handle)
    }
    await registerLinkedHandle(scope, 'orphan', handle)
    await pruneLinkedHandles(scope, new Set(['root']))
    expect(await getLinkedHandle(scope, 'orphan')).toBeUndefined()
    expect(await getLinkedHandle(scope, 'root')).toEqual(handle)
    await clearLinkedHandles(scope)
    expect(await getLinkedHandle(scope, 'root')).toBeUndefined()
    expect(await getLinkedHandle(otherProject, 'root')).toEqual(handle)
    expect(await getLinkedHandle(otherWorkspace, 'root')).toEqual(handle)
  })

  it('does not resolve a write request that succeeded before an aborted transaction', async () => {
    let requestSucceeded = false
    await expect(
      indexedDBService.transaction('linkedMediaHandles', 'readwrite', (store) => {
        const request = store.put(handle, 'aborted')
        request.addEventListener('success', () => {
          requestSucceeded = true
          store.transaction.abort()
        })
        return request
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSucceeded).toBe(true)
    expect(
      await indexedDBService.transaction('linkedMediaHandles', 'readonly', (store) =>
        store.get('aborted'),
      ),
    ).toBeUndefined()
  })
})

describe('linked media identity', () => {
  it('rejects traversal, separators with empty segments and a missing digest', () => {
    const record = {
      type: 'linked-file',
      handleKind: 'directory',
      relativePath: '卡1/red.webm',
      handleId: 'id',
      size: 1164,
      contentSha256: 'a'.repeat(64),
    }
    expect(isLinkedFileRecord(record)).toBe(true)
    expect(splitLinkedRelativePath(record.relativePath)).toEqual(['卡1', 'red.webm'])
    for (const relativePath of [
      '/red.webm',
      '卡1//red.webm',
      './red.webm',
      '../red.webm',
      '卡1/',
    ]) {
      expect(isLinkedFileRecord({ ...record, relativePath })).toBe(false)
    }
    expect(isLinkedFileRecord({ ...record, contentSha256: undefined })).toBe(false)
  })

  it('hashes a blob without a stream correctly across chunk boundaries', async () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024 + 11, 0xf6)
    const file = new Blob([bytes])
    Object.defineProperty(file, 'stream', { value: undefined })
    expect(await hashFile(file)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('cancels an in-flight streaming hash', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const stream = new ReadableStream({ cancel: cancelled })
    const file = new Blob()
    Object.defineProperty(file, 'stream', { value: () => stream })
    const hashed = hashFile(file, controller.signal)
    controller.abort()
    await expect(hashed).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
