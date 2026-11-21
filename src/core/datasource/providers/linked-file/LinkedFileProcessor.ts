import {
  DataSourceProcessor,
  type PreparedMediaFile,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { disposeBunnyObjects } from '@/core/bunnyUtils/BunnyProcessor'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { setLinkedMediaIssue } from './LinkedMediaReader'

export class LinkedFileProcessor extends DataSourceProcessor {
  getProcessorType() {
    return 'linked-file'
  }

  async processTaskDirectly(media: UnifiedMediaItemData) {
    const prepared = await this.prepareMediaFileForDag(media)
    await this.decodePreparedMediaFileForDag(media, prepared)
  }

  async prepareMediaFileForDag(media: UnifiedMediaItemData): Promise<PreparedMediaFile> {
    const source = media.source
    if (source.type !== 'linked-file') throw new Error('素材不是链接来源')
    globalMetaFileManager.assertAssetActive(media)
    this.transitionMediaStatus(media, 'asyncprocessing')
    try {
      const file = source.checkedFile ?? (await globalMetaFileManager.loadMediaFile(media))
      delete source.checkedFile
      globalMetaFileManager.assertAssetActive(media)
      source.progress = 100
      return { file, mediaType: null }
    } catch (error) {
      if (source === media.source) setLinkedMediaIssue(media, error)
      throw error
    }
  }

  async decodePreparedMediaFileForDag(media: UnifiedMediaItemData, { file }: PreparedMediaFile) {
    const source = media.source
    globalMetaFileManager.assertAssetActive(media)
    this.transitionMediaStatus(media, 'decoding')
    // Decode into a temporary runtime so late work cannot publish after a relink or deletion.
    const draft: UnifiedMediaItemData = { ...media, runtime: {} }
    try {
      const result = await this.bunnyProcessor.processMedia(draft, file)
      globalMetaFileManager.assertAssetActive(media)
      if (source !== media.source || media.mediaStatus !== 'decoding')
        throw new Error('素材来源已变化')
      media.runtime.bunny = result.bunnyObjects
      media.duration = Number(result.durationN)
    } catch (error) {
      await disposeBunnyObjects(draft.runtime.bunny).catch(() => {})
      if (source === media.source && media.mediaStatus === 'decoding')
        setLinkedMediaIssue(media, error)
      throw error
    }
  }
}
