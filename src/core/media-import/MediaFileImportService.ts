import type { useUnifiedStore } from '@/core/unifiedStore'
import { DataSourceFactory } from '@/core/datasource/core/DataSourceTypes'
import { createUnifiedMediaItemData } from '@/core/mediaitem/types'
import { generateMediaId } from '@/core/utils/idGenerator'
import { extractExtension } from '@/core/utils/mediaPathUtils'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'

type MediaImportStore = Pick<
  ReturnType<typeof useUnifiedStore>,
  | 'projectId'
  | 'directories'
  | 'getDirectory'
  | 'addMediaItem'
  | 'getMediaItem'
  | 'removeMediaItem'
  | 'registerAssetLocation'
  | 'ensureMediaReady'
>

export interface MediaFileImportOptions {
  /** Agent 必须等待就绪；手动导入默认在登记后返回，由后台完成处理。 */
  waitUntilReady?: boolean
  projectId?: string
  signal?: AbortSignal
  isCurrent?: () => boolean
  onBackgroundError?: (error: unknown) => void
}

export class MediaFileImportError extends Error {
  constructor(
    readonly toolCode: 'directory_not_found' | 'context_expired' | 'import_failed',
    message: string,
  ) {
    super(message)
    this.name = 'MediaFileImportError'
  }
}

/** 手动导入与 Agent 共用的数据源创建、目录登记、解码和持久化入口。 */
export function createMediaFileImportService(store: MediaImportStore) {
  async function importFile(
    file: File,
    targetDirectoryId?: string,
    options: MediaFileImportOptions = {},
  ) {
    const projectId = options.projectId ?? store.projectId
    const assertCurrent = () => {
      options.signal?.throwIfAborted()
      if (
        !projectId ||
        store.projectId !== projectId ||
        globalMetaFileManager.currentProjectId !== projectId ||
        (options.isCurrent && !options.isCurrent())
      ) {
        throw new MediaFileImportError('context_expired', '导入所属账户或工程已变化。')
      }
    }
    assertCurrent()
    const directoryId =
      targetDirectoryId ?? [...store.directories.values()].find((dir) => dir.parentId === null)?.id
    if (!directoryId || !store.getDirectory(directoryId)) {
      throw new MediaFileImportError('directory_not_found', '目标素材目录不存在。')
    }

    const source = DataSourceFactory.createUserSelectedSourceFromFile(file)
    const mediaItem = createUnifiedMediaItemData(generateMediaId(), file.name, source, {
      ext: extractExtension(file.name),
      parentDirectoryId: directoryId,
    })
    const assertActive = () => {
      assertCurrent()
      if (mediaItem.mediaStatus === 'cancelled') {
        throw new DOMException('素材导入已取消。', 'AbortError')
      }
      if (store.getMediaItem(mediaItem.id) !== mediaItem) {
        throw new MediaFileImportError('import_failed', '导入中的素材已被删除。')
      }
      if (!store.getDirectory(mediaItem.parentDirectoryId)) {
        throw new MediaFileImportError('directory_not_found', '目标素材目录已被删除。')
      }
    }
    source.importContext = { projectId, assertActive }
    store.addMediaItem(mediaItem)
    const location = store.registerAssetLocation(mediaItem.id)
    if (!location.success) {
      delete source.importContext
      await store.removeMediaItem(mediaItem.id)
      throw new MediaFileImportError('import_failed', location.error ?? '登记素材目录归属失败。')
    }

    const ready = (async () => {
      try {
        assertActive()
        await store.ensureMediaReady(mediaItem.id)
        assertActive()
        if (mediaItem.mediaStatus !== 'ready' || !mediaItem.runtime.bunny) {
          throw new MediaFileImportError('import_failed', '素材解码或保存未完成。')
        }
        return mediaItem
      } catch (error) {
        mediaItem.mediaStatus =
          options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
            ? 'cancelled'
            : 'error'
        source.errorMessage = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        delete source.importContext
      }
    })()

    if (options.waitUntilReady) return await ready
    void ready.catch((error) => {
      if (options.onBackgroundError) options.onBackgroundError(error)
      else console.error('[MediaImport] 素材导入失败', error)
    })
    return mediaItem
  }

  return { importFile }
}
