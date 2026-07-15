import type { EffectTemplateAssetData } from '@/core/asset/types'
import { isEffectTemplateAsset } from '@/core/asset/types'
import { effectPackageRegistry } from '@/core/effect-package/EffectPackageRegistry'
import { filterTemplateCatalogService } from '@/core/effect-template/FilterTemplateCatalogService'
import type { LocalizedText } from '@/core/effect-template/catalogTypes'
import { assertCatalogVersion } from '@/core/effect-template/commonTypes'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'

export const EFFECT_TEMPLATE_READY_RESOURCE_TYPE = 'effect-template-ready'

export interface EffectTemplateReadyInput {
  assetId: string
}

export interface EffectTemplateReadyResult {
  assetId: string
  status: 'ready' | 'skipped'
}

type EffectTemplateReadyModule = {
  getAsset: (assetId: string) => EffectTemplateAssetData | undefined
  getProjectId: () => string
}

export class EffectTemplateReadyResolver
  implements ResourceResolver<EffectTemplateReadyInput, EffectTemplateReadyResult>
{
  readonly type = EFFECT_TEMPLATE_READY_RESOURCE_TYPE

  private readonly activeTasks = new Map<string, AbortController>()

  constructor(private readonly module: EffectTemplateReadyModule) {}

  getKey(input: EffectTemplateReadyInput): string {
    return input.assetId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<EffectTemplateReadyInput>,
  ): Promise<EffectTemplateReadyResult | null> {
    const asset = this.module.getAsset(ctx.input.assetId)
    if (!asset) {
      return {
        assetId: ctx.input.assetId,
        status: 'skipped',
      }
    }

    if (asset.templateStatus === 'ready') {
      return {
        assetId: asset.id,
        status: 'ready',
      }
    }

    return null
  }

  async resolve(
    ctx: ResolveContext<EffectTemplateReadyInput>,
  ): Promise<EffectTemplateReadyResult> {
    const asset = this.requireAsset(ctx.input.assetId)
    if (asset.templateStatus === 'ready') {
      ctx.update({
        progress: 1,
        stage: 'ready',
        message: `Effect template ready: ${asset.id}`,
      })
      return {
        assetId: asset.id,
        status: 'ready',
      }
    }

    const projectId = this.module.getProjectId()
    const abortController = new AbortController()
    const onAbort = () => abortController.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    this.activeTasks.set(asset.id, abortController)

    try {
      asset.templateStatus = 'asyncprocessing'
      asset.source.progress = 35
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)
      ctx.update({
        progress: 0.35,
        stage: 'downloading',
        message: `Downloading effect template: ${asset.name}`,
      })

      const download = asset.effectType === 'filter'
        ? await filterTemplateCatalogService.downloadTemplatePackage(
            asset.source.templateId,
            this.requireCatalogVersion(asset),
            {
              signal: abortController.signal,
            },
          )
        : await transitionTemplateCatalogService.downloadTemplatePackage(
            asset.source.templateId,
            this.requireCatalogVersion(asset),
            {
              signal: abortController.signal,
            },
          )

      if (ctx.signal.aborted) {
        throw new DOMException('Effect template download cancelled', 'AbortError')
      }

      asset.name = this.resolveLocalizedText(download.name) || asset.name
      asset.templateStatus = 'decoding'
      asset.source.progress = 70
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)
      ctx.update({
        progress: 0.7,
        stage: 'installing',
        message: `Installing effect template: ${asset.name}`,
      })

      const installedAsset = await effectPackageRegistry.installDownloadedPackage(
        projectId,
        asset.id,
        download.package_files,
      )

      if (ctx.signal.aborted) {
        await effectPackageRegistry.cleanupInstalledPackage(projectId, asset.id).catch(() => {})
        throw new DOMException('Effect template install cancelled', 'AbortError')
      }

      asset.name = this.resolveLocalizedText(download.name) || installedAsset.name || asset.name
      asset.templatePayload = installedAsset.templatePayload
      asset.templateStatus = 'ready'
      asset.source.progress = 100
      asset.source.errorMessage = undefined
      await globalMetaFileManager.saveMetaFile(asset)
      ctx.update({
        progress: 1,
        stage: 'ready',
        message: `Effect template ready: ${asset.name}`,
      })

      return {
        assetId: asset.id,
        status: 'ready',
      }
    } catch (error) {
      const message = this.resolveDownloadError(error)
      asset.templateStatus = error instanceof DOMException && error.name === 'AbortError'
        ? 'cancelled'
        : 'error'
      asset.source.progress = 0
      asset.source.errorMessage = asset.templateStatus === 'cancelled' ? undefined : message
      await effectPackageRegistry.cleanupInstalledPackage(projectId, asset.id).catch(() => {})
      await globalMetaFileManager.saveMetaFile(asset)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      this.activeTasks.delete(asset.id)
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }

  async cancel(ctx: ResolveContext<EffectTemplateReadyInput>): Promise<void> {
    const asset = this.module.getAsset(ctx.input.assetId)
    if (!asset) {
      return
    }

    this.activeTasks.get(asset.id)?.abort()

    if (!['pending', 'asyncprocessing', 'decoding'].includes(asset.templateStatus)) {
      return
    }

    asset.templateStatus = 'cancelled'
    asset.source.progress = 0
    asset.source.errorMessage = undefined

    await effectPackageRegistry.cleanupInstalledPackage(this.module.getProjectId(), asset.id).catch(
      () => {},
    )
    await globalMetaFileManager.saveMetaFile(asset)
  }

  private requireAsset(assetId: string): EffectTemplateAssetData {
    const asset = this.module.getAsset(assetId)
    if (!asset || !isEffectTemplateAsset(asset)) {
      throw new Error(`效果素材不存在: ${assetId}`)
    }
    return asset
  }

  private resolveLocalizedText(value: LocalizedText): string {
    return value.zh || value.en
  }

  private requireCatalogVersion(asset: EffectTemplateAssetData): string {
    return assertCatalogVersion(asset.source.catalogVersion ?? '')
  }

  private resolveDownloadError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return '下载已取消'
    }

    return error instanceof Error ? error.message : String(error)
  }
}

export function createEffectTemplateReadyResolver(
  module: EffectTemplateReadyModule,
): EffectTemplateReadyResolver {
  return new EffectTemplateReadyResolver(module)
}

export function createEffectTemplateReadyRequest(
  assetId: string,
  policy?: ResourcePolicy,
): ResourceRequest<EffectTemplateReadyInput> {
  return {
    type: EFFECT_TEMPLATE_READY_RESOURCE_TYPE,
    key: assetId,
    input: {
      assetId,
    },
    policy: {
      queue: 'background',
      ...policy,
    },
  }
}
