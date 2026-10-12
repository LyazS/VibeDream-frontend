import { runAiTask } from '@/core/ai-tasks/taskApi'
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
  agent_description?: string
}

export interface TransitionSearchResponse {
  query: string
  results: TransitionSearchResult[]
}

export async function searchTransitions(
  query: string,
  topK = 5,
  options: { signal?: AbortSignal; projectId?: string } = {},
): Promise<TransitionSearchResponse> {
  const { result } = await runAiTask<TransitionSearchResponse>(
    'transition.search',
    { query, top_k: topK },
    options,
  )
  return result
}
