import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'

afterEach(() => {
  indexedDBService.close()
  vi.unstubAllGlobals()
})

it('upgrades v3 model-call records without changing messages, tool payloads or file handles', async () => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  const modelCall = {
    id: 'm1',
    request: { turnId: 'm1', messages: [{ role: 'user', content: 'hello' }] },
    completion: { turnId: 'm1', message: { role: 'assistant', content: 'reply' } },
  }
  const execution = { turnId: 'm1', call: { id: 'c1', args: { turnId: 'opaque argument' } } }
  const messages = [{ role: 'user', parts: [{ type: 'text', text: 'original text' }] }]
  const session = { latestTurn: modelCall, toolExecutions: { a1: execution }, messages }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('VideoEditorDB', 3)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('handles').put('original handle', 'project')
      for (const name of ['agentSessions', 'agentTurns', 'agentTools']) {
        const store = db.createObjectStore(name, { keyPath: 'key' })
        store.createIndex('owner', 'owner')
        store.createIndex('session', 'sessionKey')
        const data =
          name === 'agentSessions'
            ? { data: session }
            : name === 'agentTurns'
              ? { turn: modelCall }
              : { execution }
        store.put({ key: 'record', owner: 'owner', sessionKey: 'session', ...data })
      }
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })

  const db = await indexedDBService.openDB()
  expect(db.version).toBe(4)
  expect(db.objectStoreNames.contains('agentTurns')).toBe(false)
  const migrated = await indexedDBService.transaction('agentSessions', 'readonly', (store) =>
    store.get('record'),
  )
  expect(migrated.data).not.toHaveProperty('latestTurn')
  expect(migrated.data.messages).toEqual(messages)
  expect(migrated.data.latestModelCall.request).toEqual({
    modelCallId: 'm1',
    messages: modelCall.request.messages,
  })
  expect(migrated.data.latestModelCall.completion).toEqual({
    modelCallId: 'm1',
    message: modelCall.completion.message,
  })
  const expectedExecution = { modelCallId: 'm1', call: execution.call }
  expect(migrated.data.toolExecutions.a1).toEqual(expectedExecution)
  const journal = await indexedDBService.transaction('agentTools', 'readonly', (store) =>
    store.get('record'),
  )
  expect(journal.execution).toEqual(expectedExecution)
  const snapshot = await indexedDBService.transaction('agentModelCalls', 'readonly', (store) =>
    store.get('record'),
  )
  expect(snapshot).not.toHaveProperty('turn')
  expect(snapshot.modelCall).toEqual(migrated.data.latestModelCall)
  expect(
    await indexedDBService.transaction('handles', 'readonly', (store) => store.get('project')),
  ).toBe('original handle')
})
