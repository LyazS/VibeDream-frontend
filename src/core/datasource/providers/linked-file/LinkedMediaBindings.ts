import { indexedDBService } from '@/core/storage/IndexedDBService'
import { withStorageLock } from '@/core/storage/withStorageLock'

export interface LinkedProjectScope {
  workspaceKey: string
  projectId: string
}

export type LinkedHandle = FileSystemFileHandle | FileSystemDirectoryHandle
const STORE = 'linkedMediaHandles'

function bindingKey(scope: LinkedProjectScope, handleId: string) {
  return [scope.workspaceKey, scope.projectId, handleId]
}

function bindingRange(scope: LinkedProjectScope) {
  const prefix = [scope.workspaceKey, scope.projectId]
  return IDBKeyRange.bound(prefix, [...prefix, []], false, true)
}

/** Serialize commits, unlinks, and metadata scans within the current page. */
export function withLinkedProjectLock<T>(scope: LinkedProjectScope, run: () => Promise<T>) {
  return withStorageLock(`linked-media:${JSON.stringify(bindingKey(scope, ''))}`, run)
}

export function getLinkedHandle(
  scope: LinkedProjectScope,
  handleId: string,
): Promise<LinkedHandle | undefined> {
  return indexedDBService.transaction(STORE, 'readonly', (store) =>
    store.get(bindingKey(scope, handleId)),
  )
}

export async function registerLinkedHandle(
  scope: LinkedProjectScope,
  handleId: string,
  handle: LinkedHandle,
) {
  await indexedDBService.transaction(
    STORE,
    'readwrite',
    (store) => store.put(handle, bindingKey(scope, handleId)),
    { durability: 'strict' },
  )
}

export async function pruneLinkedHandles(scope: LinkedProjectScope, referenced: Set<string>) {
  const keys = await indexedDBService.transaction(STORE, 'readonly', (store) =>
    store.getAllKeys(bindingRange(scope)),
  )
  for (const key of keys) {
    const handleId = (key as string[])[2]
    if (!referenced.has(handleId)) {
      await indexedDBService.transaction(STORE, 'readwrite', (store) => store.delete(key))
    }
  }
}

export async function clearLinkedHandles(scope: LinkedProjectScope) {
  await withLinkedProjectLock(scope, () =>
    indexedDBService.transaction(STORE, 'readwrite', (store) => store.delete(bindingRange(scope))),
  )
}
