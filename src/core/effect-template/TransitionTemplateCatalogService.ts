import { fetchClient, type RequestConfig } from '@/utils/fetchClient'
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
    return response.data
  }

  async getTemplateSummaries(): Promise<TransitionTemplateListResponse> {
    const response = await fetchClient.get<TransitionTemplateListResponse>(
      '/api/effect-templates/transitions',
    )
    return response.data
  }

  async downloadTemplatePackage(
    templateId: string,
    config?: RequestConfig,
  ): Promise<TransitionTemplateDownloadResponse> {
    const response = await fetchClient.get<TransitionTemplateDownloadResponse>(
      `/api/effect-templates/transitions/${templateId}/download`,
      config,
    )
    return response.data
  }
}

export const transitionTemplateCatalogService = new TransitionTemplateCatalogService()
