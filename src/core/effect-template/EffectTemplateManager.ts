import type { ModuleRegistry } from '@/core/modules/ModuleRegistry'
import { MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import type { UnifiedConfigModule } from '@/core/modules/UnifiedConfigModule'
import type { EffectTemplateAssetData } from '@/core/asset/types'
import {
  createEffectTemplateSourceDataFromTemplate,
  createFilterTemplateAssetData,
  createTransitionTemplateAssetData,
  isEffectTemplateAsset,
} from '@/core/asset/types'
import type { LocalizedText } from '@/core/effect-template/catalogTypes'
import { filterTemplateCatalogService } from '@/core/effect-template/FilterTemplateCatalogService'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'
import { effectPackageRegistry } from '@/core/effect-package/EffectPackageRegistry'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { generateAssetId } from '@/core/utils/idGenerator'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'

interface EffectTemplateDownloadTask {
  token: number
  abortController: AbortController
}

interface CreateTemplatePlaceholderParams {
  templateId: string
  name: string
  catalogVersion?: string
}

export class EffectTemplateManager {
  private readonly activeTasks = new Map<string, EffectTemplateDownloadTask>()
  private nextToken = 0

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly getAsset: (assetId: string) => EffectTemplateAssetData | undefined,
  ) {}

  createTransitionTemplatePlaceholder(
    params: CreateTemplatePlaceholderParams,
  ): EffectTemplateAssetData {
    return createTransitionTemplateAssetData(
      generateAssetId('effect'),
      params.name,
      null,
      {
        source: createEffectTemplateSourceDataFromTemplate(
          params.templateId,
          params.catalogVersion,
          SourceOrigin.USER_CREATE,
        ),
        templateStatus: 'pending',
      },
    )
  }

  createFilterTemplatePlaceholder(
    params: CreateTemplatePlaceholderParams,
  ): EffectTemplateAssetData {
    return createFilterTemplateAssetData(
      generateAssetId('effect'),
      params.name,
      null,
      {
        source: createEffectTemplateSourceDataFromTemplate(
          params.templateId,
          params.catalogVersion,
          SourceOrigin.USER_CREATE,
        ),
        templateStatus: 'pending',
      },
    )
  }

  async startTemplateProcessing(assetId: string): Promise<void> {
    const asset = this.requireAsset(assetId)
    if (asset.templateStatus === 'ready') {
      return
    }

    if (this.activeTasks.has(assetId)) {
      return
    }

    const projectId = this.requireProjectId()
    const task: EffectTemplateDownloadTask = {
      token: ++this.nextToken,
      abortController: new AbortController(),
    }
    this.activeTasks.set(assetId, task)

    try {
      asset.templateStatus = 'asyncprocessing'
      asset.source.progress = 35
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)

      const download = asset.effectType === 'filter'
        ? await filterTemplateCatalogService.downloadTemplatePackage(
            asset.source.templateId,
            { signal: task.abortController.signal },
          )
        : await transitionTemplateCatalogService.downloadTemplatePackage(
            asset.source.templateId,
            { signal: task.abortController.signal },
          )

      if (!this.isTaskCurrent(assetId, task.token)) {
        return
      }

      asset.name = this.resolveLocalizedText(download.name) || asset.name
      asset.templateStatus = 'decoding'
      asset.source.progress = 70
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)

      const installedAsset = await effectPackageRegistry.installDownloadedPackage(
        projectId,
        asset.id,
        download.package_files,
      )

      if (!this.isTaskCurrent(assetId, task.token)) {
        await effectPackageRegistry.cleanupInstalledPackage(projectId, asset.id).catch(() => {})
        return
      }

      asset.name = this.resolveLocalizedText(download.name) || installedAsset.name || asset.name
      asset.templatePayload = installedAsset.templatePayload
      asset.templateStatus = 'ready'
      asset.source.progress = 100
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)
    } catch (error) {
      if (!this.isTaskCurrent(assetId, task.token)) {
        return
      }

      const message = this.resolveDownloadError(error)
      asset.templateStatus = error instanceof DOMException && error.name === 'AbortError'
        ? 'cancelled'
        : 'error'
      asset.source.progress = 0
      asset.source.errorMessage = asset.templateStatus === 'cancelled' ? undefined : message
      await effectPackageRegistry.cleanupInstalledPackage(projectId, asset.id).catch(() => {})
      await globalMetaFileManager.saveMetaFile(asset)
      if (asset.templateStatus !== 'cancelled') {
        throw new Error(message)
      }
    } finally {
      if (this.isTaskCurrent(assetId, task.token)) {
        this.activeTasks.delete(assetId)
      }
    }
  }

  async retryTemplateProcessing(assetId: string): Promise<void> {
    const asset = this.requireAsset(assetId)
    if (!['error', 'cancelled', 'missing'].includes(asset.templateStatus)) {
      throw new Error(`当前状态不允许重试: ${asset.templateStatus}`)
    }

    asset.templateStatus = 'pending'
    asset.source.progress = 0
    asset.source.errorMessage = undefined
    await globalMetaFileManager.saveMetaFile(asset)
    await this.startTemplateProcessing(assetId)
  }

  async cancelTemplateProcessing(assetId: string): Promise<boolean> {
    const asset = this.requireAsset(assetId)
    const task = this.activeTasks.get(assetId)
    const projectId = this.requireProjectId()

    if (task) {
      task.abortController.abort()
      this.activeTasks.delete(assetId)
    }

    if (!['pending', 'asyncprocessing', 'decoding'].includes(asset.templateStatus)) {
      return false
    }

    asset.templateStatus = 'cancelled'
    asset.source.progress = 0
    asset.source.errorMessage = undefined
    await effectPackageRegistry.cleanupInstalledPackage(projectId, asset.id).catch(() => {})
    await globalMetaFileManager.saveMetaFile(asset)
    return true
  }

  async cleanupTemplateProcessing(assetId: string): Promise<void> {
    const task = this.activeTasks.get(assetId)
    if (task) {
      task.abortController.abort()
      this.activeTasks.delete(assetId)
    }

    effectPackageRegistry.removePackage(assetId)
  }

  private requireAsset(assetId: string): EffectTemplateAssetData {
    const asset = this.getAsset(assetId)
    if (!asset || !isEffectTemplateAsset(asset)) {
      throw new Error(`效果素材不存在: ${assetId}`)
    }
    return asset
  }

  private requireProjectId(): string {
    const configModule = this.registry.get<UnifiedConfigModule>(MODULE_NAMES.CONFIG)
    const projectId = configModule.projectId.value
    if (!projectId) {
      throw new Error('当前项目未初始化')
    }
    return projectId
  }

  private isTaskCurrent(assetId: string, token: number): boolean {
    return this.activeTasks.get(assetId)?.token === token
  }

  private resolveLocalizedText(value: LocalizedText): string {
    return value.zh || value.en
  }

  private resolveDownloadError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return '下载已取消'
    }

    return error instanceof Error ? error.message : String(error)
  }
}
