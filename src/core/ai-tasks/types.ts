export const AI_TASK_TYPES = [
  'media.indexing',
  'media.retrieval',
  'media.rerank',
  'media.validate',
] as const

export type AiTaskType = (typeof AI_TASK_TYPES)[number]
