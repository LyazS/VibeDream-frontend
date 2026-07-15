import { fetchClient, type RequestConfig } from '@/utils/fetchClient'
import { assertCatalogVersion } from '@/core/effect-template/commonTypes'
import type {
  FilterTemplateDownloadResponse,
  FilterTemplateListResponse,
  TransitionCatalogVersionResponse,
} from '@/core/effect-template/catalogTypes'

export class FilterTemplateCatalogService {
  async getCatalogVersion(): Promise<TransitionCatalogVersionResponse> {
    const response = await fetchClient.get<TransitionCatalogVersionResponse>(
      '/api/effect-templates/filters/version',
    )
    assertCatalogVersion(response.data.catalog_version)
    return response.data
  }

  async getTemplateSummaries(): Promise<FilterTemplateListResponse> {
    const response = await fetchClient.get<FilterTemplateListResponse>(
      '/api/effect-templates/filters',
    )
    assertCatalogVersion(response.data.catalog_version)
    return response.data
  }

  async downloadTemplatePackage(
    templateId: string,
    catalogVersion: string,
    config?: RequestConfig,
  ): Promise<FilterTemplateDownloadResponse> {
    const requestedCatalogVersion = assertCatalogVersion(catalogVersion)
    const response = await fetchClient.get<FilterTemplateDownloadResponse>(
      `/api/effect-templates/filters/${templateId}/download`,
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
        `滤镜模板版本不一致: request=${requestedCatalogVersion}, response=${responseCatalogVersion}`,
      )
    }
    return response.data
  }
}

export const filterTemplateCatalogService = new FilterTemplateCatalogService()
