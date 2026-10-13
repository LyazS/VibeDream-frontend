import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'

afterEach(() => {
  indexedDBService.close()
  vi.unstubAllGlobals()
})

it('adds the image table to v6 without removing existing text conversations', async () => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  const record = {
    key: 'text-session',
    owner: 'owner',
    sessionKey: 'text-session',
    data: { messages: [{ role: 'user', content: 'keep me' }] },
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('VideoEditorDB', 6)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('agentSessions', { keyPath: 'key' })
      store.createIndex('owner', 'owner')
      store.createIndex('session', 'sessionKey')
      store.put(record)
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
  const db = await indexedDBService.openDB()
  expect(db.objectStoreNames.contains('agentImages')).toBe(true)
  expect(
    await indexedDBService.transaction('agentSessions', 'readonly', (store) =>
      store.get('text-session'),
    ),
  ).toEqual(record)
})

it.each([3, 4, 5])(
  'clears v%s chat history and diagnostic stores while preserving handles and queued logs',
  async (version) => {
    indexedDBService.close()
    vi.stubGlobal('indexedDB', new IDBFactory())
    const queuedLog = { key: 'log', spans: [{ source: { input: 'pending upload' } }] }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('VideoEditorDB', version)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('handles').put('original handle', 'project')
        db.createObjectStore('projectCache').put('original project', 'project')
        for (const name of [
          'agentSessions',
          version === 3 ? 'agentTurns' : 'agentModelCalls',
          'agentTools',
        ]) {
          const store = db.createObjectStore(name, { keyPath: 'key' })
          store.createIndex('owner', 'owner')
          store.createIndex('session', 'sessionKey')
          store.put({ key: 'old-record', owner: 'owner', sessionKey: 'session', data: 'old' })
        }
        if (version >= 4) {
          const logs = db.createObjectStore('agentLogs', { keyPath: 'key' })
          logs.createIndex('owner', 'owner')
          logs.createIndex('session', 'sessionKey')
          logs.put(queuedLog)
        }
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })

    const db = await indexedDBService.openDB()
    expect(db.version).toBe(7)
    for (const name of ['agentTurns', 'agentModelCalls', 'agentTools'])
      expect(db.objectStoreNames.contains(name)).toBe(false)
    expect(
      await indexedDBService.transaction('agentSessions', 'readonly', (store) => store.getAll()),
    ).toEqual([])
    expect(
      await indexedDBService.transaction('agentLogs', 'readonly', (store) => store.getAll()),
    ).toEqual(version >= 4 ? [queuedLog] : [])
    expect(
      await indexedDBService.transaction('handles', 'readonly', (store) => store.get('project')),
    ).toBe('original handle')
    expect(
      await indexedDBService.transaction('projectCache', 'readonly', (store) =>
        store.get('project'),
      ),
    ).toBe('original project')

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('agentSessions', 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.objectStore('agentSessions').put({ key: 'new-chat', data: 'new history' })
    })
    indexedDBService.close()
    await indexedDBService.openDB()
    expect(
      await indexedDBService.transaction('agentSessions', 'readonly', (store) =>
        store.get('new-chat'),
      ),
    ).toEqual({ key: 'new-chat', data: 'new history' })
  },
)
