import { fetchClient, type RequestConfig } from '@/utils/fetchClient'
import { assertCatalogVersion } from '@/core/effect-template/commonTypes'
import type {
  TransitionCatalogVersionResponse,
  TransitionTemplateDownloadResponse,
  TransitionTemplateListResponse,
} from '@/core/effect-template/catalogTypes'

export class TransitionTemplateCatalogService {
  async getCatalogVersion(): Promise<TransitionCatalogVersionResponse> {
    const response = await fetchClient.get<TransitionCatalogVersionResponse>(
      '/api/effect-templates/transitions/version',
    )
    assertCatalogVersion(response.data.catalog_version)
    return response.data
  }

  async getTemplateSummaries(): Promise<TransitionTemplateListResponse> {
    const response = await fetchClient.get<TransitionTemplateListResponse>(
      '/api/effect-templates/transitions',
    )
    assertCatalogVersion(response.data.catalog_version)
    return response.data
  }

  async downloadTemplatePackage(
    templateId: string,
    catalogVersion: string,
    config?: RequestConfig,
  ): Promise<TransitionTemplateDownloadResponse> {
    const requestedCatalogVersion = assertCatalogVersion(catalogVersion)
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
