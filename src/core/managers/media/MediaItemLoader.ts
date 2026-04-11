import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { MediaMetaFile } from '@/core/project/metaTypes'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { createUnifiedMediaItemData } from '@/core/mediaitem/types'
import { DataSourceFactory } from '@/core/datasource/core/DataSourceTypes'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import type { BaseUserSelectedFileSourceData } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import type { BaseAIGenerationSourceData } from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import type { BaseBizyAirSourceData } from '@/core/datasource/providers/bizyair/types'
import { BizyAirSourceFactory } from '@/core/datasource/providers/bizyair/BizyAirSource'
import type { BaseASRSourceData } from '@/core/datasource/providers/asr/ASRSource'
import { ASRSourceFactory } from '@/core/datasource/providers/asr/ASRSource'
import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import {
  createEffectTemplateSourceDataFromTemplate,
  createFilterTemplateAssetData,
  createTransitionTemplateAssetData,
} from '@/core/asset/types'
import { effectPackageRegistry } from '@/core/effect-package/EffectPackageRegistry'

/**
 * 媒体项目加载器（阶段二彻底重构版）
 * 负责从 Meta 文件重建媒体项目
 *
 * 🌟 只从 Meta 文件加载，Meta 文件是唯一真相源
 */
export class MediaItemLoader {
  /**
   * 从 Meta 文件加载所有媒体项目
   * @param projectId 项目 ID
   * @returns 媒体项目数组
   */
  async loadMediaItemsFromMeta(projectId: string): Promise<UnifiedLibraryAssetData[]> {
    try {
      console.log(`📂 [MediaItemLoader] 开始从 Meta 文件加载媒体项目: ${projectId}`)
      const discoveredEffectPackages = await effectPackageRegistry.discoverProjectPackages(projectId)
      const discoveredPackageIdSet = new Set(discoveredEffectPackages.map((item) => item.id))

      // 1. 扫描所有 Meta 文件
      const metaFiles = await globalMetaFileManager.scanAllMetaFiles()
      console.log(`📄 [MediaItemLoader] 发现 ${metaFiles.length} 个 Meta 文件`)

      // 2. 从每个 Meta 文件重建媒体项目
      const mediaItems: UnifiedLibraryAssetData[] = []

      mediaItems.push(...discoveredEffectPackages)

      for (const metaData of metaFiles) {
        try {
          if (
            metaData.assetKind === 'effect-template' &&
            discoveredPackageIdSet.has(metaData.id)
          ) {
            continue
          }

          const mediaItem = await this.rebuildMediaItemFromMeta(metaData)

          if (mediaItem.assetKind === 'effect-template') {
            console.log(`✨ [MediaItemLoader] 模板资产加载成功: ${metaData.name}`)
          } else if (mediaItem.mediaType === 'text') {
            // text 类型没有实际媒体文件，跳过文件验证
            console.log(`📝 [MediaItemLoader] 文本媒体项目加载（无文件）: ${metaData.name}`)
          } else if (mediaItem.mediaStatus === 'ready') {
            const fileExists = await globalMetaFileManager.verifyMediaFileExists(metaData.id)

            if (fileExists) {
              console.log(`✅ [MediaItemLoader] 媒体项目加载成功: ${metaData.name}`)
            } else {
              // 文件缺失，标记为 missing 状态
              mediaItem.mediaStatus = 'missing'
              console.warn(`⚠️ [MediaItemLoader] 媒体文件缺失: ${metaData.name}`)
            }
          } else {
            console.log(
              `📋 [MediaItemLoader] 媒体项目加载（状态: ${mediaItem.mediaStatus}）: ${metaData.name}`,
            )
          }
          mediaItems.push(mediaItem)
        } catch (error) {
          console.error(`❌ [MediaItemLoader] 重建媒体项目失败: ${metaData.name}`, error)
        }
      }

      console.log(`✅ [MediaItemLoader] 媒体项目加载完成: ${mediaItems.length}/${metaFiles.length}`)
      return mediaItems
    } catch (error) {
      console.error('❌ [MediaItemLoader] 加载媒体项目失败:', error)
      return []
    }
  }

  /**
   * 从 Meta 文件重建媒体项目（阶段二彻底重构版）
   * @param metaData Meta 文件数据
   * @returns 重建的媒体项目
   */
  private async rebuildMediaItemFromMeta(metaData: MediaMetaFile): Promise<UnifiedLibraryAssetData> {
    if (metaData.assetKind === 'effect-template') {
      if (metaData.effectType !== 'transition' && metaData.effectType !== 'filter') {
        throw new Error(`不支持的效果模板类型: ${metaData.effectType}`)
      }

      const templateId = metaData.source.templateId
        || (typeof metaData.templatePayload === 'object' && metaData.templatePayload && 'packageId' in metaData.templatePayload
          ? String((metaData.templatePayload as { packageId?: unknown }).packageId || '')
          : '')
        || metaData.id

      const installedPackage = effectPackageRegistry.getPackage(metaData.id)
      if (installedPackage) {
        if (installedPackage.payload.effectType === 'transition') {
          return createTransitionTemplateAssetData(metaData.id, metaData.name, installedPackage.payload, {
            createdAt: metaData.createdAt,
            source: createEffectTemplateSourceDataFromTemplate(
              templateId || installedPackage.payload.packageId,
              metaData.source.catalogVersion,
              SourceOrigin.PROJECT_LOAD,
            ),
            templateStatus: 'ready',
          })
        }

        return createFilterTemplateAssetData(metaData.id, metaData.name, installedPackage.payload, {
          createdAt: metaData.createdAt,
          source: createEffectTemplateSourceDataFromTemplate(
            templateId || installedPackage.payload.packageId,
            metaData.source.catalogVersion,
            SourceOrigin.PROJECT_LOAD,
          ),
          templateStatus: 'ready',
        })
      }

      const restoredStatus = ['error', 'cancelled', 'missing'].includes(metaData.templateStatus)
        ? metaData.templateStatus
        : 'pending'

      if (metaData.effectType === 'transition') {
        return createTransitionTemplateAssetData(metaData.id, metaData.name, null, {
          createdAt: metaData.createdAt,
          source: createEffectTemplateSourceDataFromTemplate(
            templateId,
            metaData.source.catalogVersion,
            SourceOrigin.PROJECT_LOAD,
          ),
          templateStatus: restoredStatus,
          templatePayload:
            metaData.templatePayload && typeof metaData.templatePayload === 'object'
              ? metaData.templatePayload as Record<string, unknown>
              : null,
        })
      }

      return createFilterTemplateAssetData(metaData.id, metaData.name, null, {
        createdAt: metaData.createdAt,
        source: createEffectTemplateSourceDataFromTemplate(
          templateId,
          metaData.source.catalogVersion,
          SourceOrigin.PROJECT_LOAD,
        ),
        templateStatus: restoredStatus,
        templatePayload:
          metaData.templatePayload && typeof metaData.templatePayload === 'object'
            ? metaData.templatePayload as Record<string, unknown>
            : null,
      })
    }

    // 1. 根据数据源类型创建相应的数据源（运行时状态）
    let source

    const sourceType = metaData.source.type

    if (sourceType === 'user-selected') {
      // 用户选择文件数据源
      source = DataSourceFactory.createUserSelectedSourceFromBaseData(
        metaData.source as BaseUserSelectedFileSourceData,
      )
    } else if (sourceType === 'ai-generation') {
      // AI 生成数据源（从项目加载）
      source = DataSourceFactory.createAIGenerationSource(
        metaData.source as BaseAIGenerationSourceData,
        SourceOrigin.PROJECT_LOAD,
      )
    } else if (sourceType === 'bizyair') {
      // BizyAir 数据源（从项目加载）
      source = BizyAirSourceFactory.createBizyAirSource(
        metaData.source as BaseBizyAirSourceData,
        SourceOrigin.PROJECT_LOAD,
      )
    } else if (sourceType === 'asr') {
      // ASR 数据源（从项目加载）
      source = ASRSourceFactory.createASRSource(
        metaData.source as BaseASRSourceData,
        SourceOrigin.PROJECT_LOAD,
      )
    } else {
      throw new Error(`不支持的数据源类型: ${sourceType}`)
    }

    // 2. 创建媒体项目
    const mediaItem = createUnifiedMediaItemData(
      metaData.id, // ID 格式: {nanoid}.{ext}
      metaData.name,
      source,
      {
        createdAt: metaData.createdAt,
        mediaType: metaData.mediaType,
        duration: metaData.duration,
        mediaStatus: metaData.mediaStatus || 'pending', // 🌟 如果 meta 文件中有终态状态，使用它；否则默认为 pending
        // 🌟 新增：恢复 AI 生成的元数据
        ...(metaData.metadata && {
          metadata: metaData.metadata,
        }),
      },
    )

    return mediaItem
  }
}

// 导出全局实例
export const globalMediaItemLoader = new MediaItemLoader()
