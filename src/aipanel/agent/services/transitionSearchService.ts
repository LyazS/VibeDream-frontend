import { fetchClient } from '@/utils/fetchClient'
import type { LocalizedTagList, LocalizedText } from '@/core/effect-template/catalogTypes'

export interface TransitionSearchResult {
  id: string
  package_version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  duration_frames: number
  score: number
  matched_traits: string[]
  parameter_keys: string[]
}

export interface TransitionSearchResponse {
  query: string
  results: TransitionSearchResult[]
}

export async function searchTransitions(
  query: string,
  topK = 5,
): Promise<TransitionSearchResponse> {
  const response = await fetchClient.post<TransitionSearchResponse>(
    '/api/effect-templates/transitions/search',
    {
      query,
      top_k: topK,
    },
  )
  return response.data
}
