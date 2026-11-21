import type {
  DiscoveredExternalEntries,
  DiscoveredFile,
  ExternalImportRoot,
  SkippedImportItem,
} from './types'

/**
 * 在 drop 事件同步阶段获取文件系统句柄，供链接素材引入使用。
 * Chromium 在事件结束后可能会失效拖放权限，因此必须立即调用 getAsFileSystemHandle。
 */
export function captureDroppedLinkedRoots(
  items: DataTransferItemList | DataTransferItem[],
): Promise<(FileSystemFileHandle | FileSystemDirectoryHandle)[]> {
  const handles = Array.from(items)
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const getAsFileSystemHandle = item.getAsFileSystemHandle
      return typeof getAsFileSystemHandle === 'function'
        ? getAsFileSystemHandle.call(item).catch(() => null)
        : Promise.resolve(null)
    })

  return Promise.all(handles).then((values) =>
    values.filter(
      (handle): handle is FileSystemFileHandle | FileSystemDirectoryHandle =>
        handle?.kind === 'file' || handle?.kind === 'directory',
    ),
  )
}

export async function discoverExternalImportEntries(
  roots: ExternalImportRoot[],
  signal?: AbortSignal,
): Promise<DiscoveredExternalEntries> {
  const files: DiscoveredFile[] = []
  const skipped: SkippedImportItem[] = []

  await Promise.all(
    roots.map(async (root, index) => {
      const sourceId = `root-${index}`
      if (signal?.aborted) {
        skipped.push({
          sourceId,
          relativePath: root.kind === 'file' ? [root.file.name] : [root.handle.name],
          reason: 'cancelled',
        })
        return
      }

      if (root.kind === 'file') {
        files.push({ sourceId, file: root.file, relativePath: [root.file.name] })
        return
      }

      await discoverDirectory(root.handle, sourceId, [root.handle.name], files, skipped, signal)
    }),
  )

  return { files, skipped }
}

async function discoverDirectory(
  handle: FileSystemDirectoryHandle,
  sourceId: string,
  relativePath: string[],
  files: DiscoveredFile[],
  skipped: SkippedImportItem[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    skipped.push({ sourceId, relativePath, reason: 'cancelled' })
    return
  }

  try {
    for await (const [name, childHandle] of handle.entries()) {
      if (signal?.aborted) {
        skipped.push({ sourceId, relativePath, reason: 'cancelled' })
        return
      }

      const childPath = [...relativePath, name]
      if (childHandle.kind === 'directory') {
        await discoverDirectory(childHandle, sourceId, childPath, files, skipped, signal)
        continue
      }

      try {
        files.push({
          sourceId,
          file: await childHandle.getFile(),
          relativePath: childPath,
        })
      } catch (error) {
        skipped.push({
          sourceId,
          relativePath: childPath,
          reason: 'unreadable',
          message: getErrorMessage(error),
        })
      }
    }
  } catch (error) {
    skipped.push({
      sourceId,
      relativePath,
      reason: 'unreadable',
      message: getErrorMessage(error),
    })
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法读取此项目'
}
