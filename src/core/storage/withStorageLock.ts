const localLocks = new Map<string, Promise<unknown>>()

/** Serialize related storage operations within the current page. */
export async function withStorageLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = localLocks.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  localLocks.set(key, current)
  try {
    return await current
  } finally {
    if (localLocks.get(key) === current) localLocks.delete(key)
  }
}
