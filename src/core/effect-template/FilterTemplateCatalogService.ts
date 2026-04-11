import { fetchClient, type RequestConfig } from '@/utils/fetchClient'
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
    return response.data
  }

  async getTemplateSummaries(): Promise<FilterTemplateListResponse> {
    const response = await fetchClient.get<FilterTemplateListResponse>(
      '/api/effect-templates/filters',
    )
    return response.data
  }

  async downloadTemplatePackage(
    templateId: string,
    config?: RequestConfig,
  ): Promise<FilterTemplateDownloadResponse> {
    const response = await fetchClient.get<FilterTemplateDownloadResponse>(
      `/api/effect-templates/filters/${templateId}/download`,
      config,
    )
    return response.data
  }
}

export const filterTemplateCatalogService = new FilterTemplateCatalogService()
