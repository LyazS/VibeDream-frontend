import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { createUnifiedMediaItemData, type UnifiedMediaItemData } from '@/core/mediaitem/types'
import {
  DataSourceFactory,
  type UnifiedDataSourceData,
} from '@/core/datasource/core/DataSourceTypes'
import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import type { MediaLibraryAssetMetaFile } from '@/core/project/metaTypes'
import { createLinkedFileSource } from '@/core/datasource/providers/linked-file/LinkedFileSource'
import { withLinkedProjectLock } from '@/core/datasource/providers/linked-file/LinkedMediaBindings'
import {
  createLinkedMediaReader,
  LinkedMediaError,
  markLinkedMediaReadable,
  setLinkedMediaIssue,
} from '@/core/datasource/providers/linked-file/LinkedMediaReader'

export class MediaItemLoader {
  async loadMediaItemsFromMeta(projectId: string): Promise<UnifiedLibraryAssetData[]> {
    const context = globalMetaFileManager.captureContext()
    if (context.projectId !== projectId) throw new Error('素材所属工程已切换')
    const scan = () => globalMetaFileManager.scanProjectMeta(context)
    const scope = context.workspaceKey ? { projectId, workspaceKey: context.workspaceKey } : null
    const result = scope
      ? await withLinkedProjectLock(scope, async () => {
          const scanned = await scan()
          await globalMetaFileManager
            .reconcileLinkedHandles(scope, context, scanned)
            .catch((error) => {
              console.warn('链接句柄回收将延后到下次打开工程', error)
            })
          return scanned
        })
      : await scan()
    context.assertActive?.()
    const linkedReader = scope ? createLinkedMediaReader(scope, fileSystemService) : undefined
    const items: UnifiedMediaItemData[] = []
    for (const meta of result.metaFiles) {
      if (meta.assetKind !== 'media') continue
      const source =
        meta.source.type === 'linked-file'
          ? createLinkedFileSource(meta.source)
          : DataSourceFactory.createUserSelectedSourceFromBaseData(meta.source)
      const item = rebuildMediaItem(meta, source)
      if (source.type === 'linked-file') {
        try {
          const file = await globalMetaFileManager.loadMediaFile(item, { linkedReader, context })
          markLinkedMediaReadable(item, file)
        } catch (error) {
          setLinkedMediaIssue(item, error)
        }
      } else if (item.mediaStatus === 'ready') {
        if (!(await globalMetaFileManager.verifyMediaFileExists(item))) item.mediaStatus = 'missing'
      }
      context.assertActive?.()
      items.push(item)
    }
    for (const meta of result.damaged) {
      const item = rebuildMediaItem(meta, createLinkedFileSource())
      setLinkedMediaIssue(item, new LinkedMediaError('damaged'))
      items.push(item)
    }
    return items
  }
}

function rebuildMediaItem(
  meta: Omit<MediaLibraryAssetMetaFile, 'source'>,
  source: UnifiedDataSourceData,
) {
  return createUnifiedMediaItemData(meta.id, meta.name, source, {
    ext: meta.ext,
    createdAt: meta.createdAt,
    parentDirectoryId: meta.parentDirectoryId,
    mediaType: meta.mediaType,
    duration: meta.duration,
    mediaStatus: meta.mediaStatus || 'pending',
    metadata: meta.metadata,
  })
}

export const globalMediaItemLoader = new MediaItemLoader()
