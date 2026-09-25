import { fetchClient, type RequestConfig } from '@/utils/fetchClient'
import { TRANSITION_ASSET_BASE_URL } from '@/config/runtimeConfig'
import { assertCatalogVersion } from '@/core/effect-template/commonTypes'
import type {
  TransitionCatalogVersionResponse,
  TransitionTemplateDownloadResponse,
  TransitionTemplateListResponse,
} from '@/core/effect-template/catalogTypes'

export class TransitionTemplateCatalogService {
  private async getPublicJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${TRANSITION_ASSET_BASE_URL}/transitions/${path}`, { signal })
    if (!response.ok) throw new Error(`转场资源下载失败: ${response.status}`)
    return response.json() as Promise<T>
  }

  async getCatalogVersion(): Promise<TransitionCatalogVersionResponse> {
    if (TRANSITION_ASSET_BASE_URL) {
      const current = await this.getPublicJson<TransitionCatalogVersionResponse>('current.json')
      assertCatalogVersion(current.catalog_version)
      return current
    }
    const response = await fetchClient.get<TransitionCatalogVersionResponse>(
      '/api/effect-templates/transitions/version',
    )
    assertCatalogVersion(response.data.catalog_version)
    return response.data
  }

  async getTemplateSummaries(catalogVersion?: string): Promise<TransitionTemplateListResponse> {
    if (TRANSITION_ASSET_BASE_URL) {
      const version = catalogVersion
        ? assertCatalogVersion(catalogVersion)
        : (await this.getCatalogVersion()).catalog_version
      const catalog = await this.getPublicJson<TransitionTemplateListResponse>(
        `releases/${encodeURIComponent(version)}/catalog.json`,
      )
      if (catalog.catalog_version !== version) throw new Error('转场目录版本不一致')
      return catalog
    }
    const response = await fetchClient.get<TransitionTemplateListResponse>(
      '/api/effect-templates/transitions',
    )
    assertCatalogVersion(response.data.catalog_version)
    if (catalogVersion && response.data.catalog_version !== catalogVersion) {
      throw new Error('转场目录版本不一致')
    }
    return response.data
  }

  async downloadTemplatePackage(
    templateId: string,
    catalogVersion: string,
    config?: RequestConfig,
  ): Promise<TransitionTemplateDownloadResponse> {
    const requestedCatalogVersion = assertCatalogVersion(catalogVersion)
    if (TRANSITION_ASSET_BASE_URL) {
      const download = await this.getPublicJson<TransitionTemplateDownloadResponse>(
        `releases/${encodeURIComponent(requestedCatalogVersion)}/packages/${encodeURIComponent(templateId)}.json`,
        config?.signal ?? undefined,
      )
      if (download.catalog_version !== requestedCatalogVersion || download.id !== templateId) {
        throw new Error('转场安装包与请求的模板或目录版本不一致')
      }
      return download
    }
    const response = await fetchClient.get<TransitionTemplateDownloadResponse>(
      `/api/effect-templates/transitions/${templateId}/download`,
      {
        ...config,
        params: {
          ...(config?.params ?? {}),
          catalog_version: requestedCatalogVersion,
        },
      },
    )
    const responseCatalogVersion = assertCatalogVersion(response.data.catalog_version)
    if (responseCatalogVersion !== requestedCatalogVersion) {
      throw new Error(
        `转场模板版本不一致: request=${requestedCatalogVersion}, response=${responseCatalogVersion}`,
      )
    }
    return response.data
  }
}

export const transitionTemplateCatalogService = new TransitionTemplateCatalogService()
