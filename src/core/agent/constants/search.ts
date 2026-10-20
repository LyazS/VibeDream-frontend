/** Agent 对外搜索工具共享的候选数量约束。 */
export const AGENT_SEARCH_TOP_K = {
  /** 未指定候选数量时使用的默认值。 */
  default: 5,
  /** 允许请求的最小候选数量。 */
  min: 1,
  /** 允许请求的最大候选数量。 */
  max: 10,
} as const

/** 素材语义检索内部流水线的固定参数。 */
export const AGENT_MEDIA_INDEX_LIMITS = {
  /** 第一阶段向量检索保留的候选数量。 */
  retrievalTopK: 30,
  /** 重排阶段保留的候选数量。 */
  rerankTopK: 10,
  /** 重排结果被接受所需的最低分数。 */
  rerankScoreThreshold: 0.55,
  /** 视频检索帧图导出的最大边长，单位为像素。 */
  videoExportMaxSide: 480,
  /** 视频检索帧图导出的帧率。 */
  videoExportFps: 6,
  /** 图片检索缩略图导出的最大边长，单位为像素。 */
  imageExportMaxSide: 768,
} as const

/** 素材搜索进度面板展示的总阶段数。 */
export const AGENT_SEARCH_MEDIA_TOTAL_STEPS = 4
