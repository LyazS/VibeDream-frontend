export const AI_TASK_TYPES = [
  'media.indexing',
  'media.retrieval',
  'media.rerank',
  'media.validate',
  'transition.search',
] as const

export type AiTaskType = (typeof AI_TASK_TYPES)[number]
