import { fetchClient } from '@/utils/fetchClient'
import type {
  TransitionCatalogVersionResponse,
  TransitionTemplateDetail,
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

  async getTemplateDetail(templateId: string): Promise<TransitionTemplateDetail> {
    const response = await fetchClient.get<TransitionTemplateDetail>(
      `/api/effect-templates/transitions/${templateId}`,
    )
    return response.data
  }
}

export const transitionTemplateCatalogService = new TransitionTemplateCatalogService()
