/** 单次用户提交或视觉工具调用最多携带或输出的图片数。 */
export const AGENT_MAX_IMAGE_COUNT = 9
/** 用户上传原图允许的最大字节数。 */
export const AGENT_MAX_IMAGE_ORIGINAL_BYTES = 10 * 1024 * 1024
/** 原图允许的最大像素总数。 */
export const AGENT_MAX_IMAGE_PIXELS = 40_000_000
/** 处理后图片允许的最大边长，单位为像素。 */
export const AGENT_MAX_IMAGE_EDGE = 2048
/** 处理后图片允许的最大编码字节数。 */
export const AGENT_MAX_IMAGE_ENCODED_BYTES = 2 * 1024 * 1024

/** 时间范围观察至少抽取的帧数。 */
export const AGENT_VIEW_MIN_FRAME_COUNT = 2
/** 单个时间范围最多抽取的帧数。 */
export const AGENT_VIEW_MAX_FRAME_COUNT = AGENT_MAX_IMAGE_COUNT
/** 单次观察工具最多接收的目标数量。 */
export const AGENT_VIEW_MAX_ITEMS = AGENT_MAX_IMAGE_COUNT
/** Agent 视觉观察在省略 frameCount 时采用的默认抽帧数。 */
export const AGENT_VIEW_DEFAULT_FRAME_COUNT = AGENT_VIEW_MAX_FRAME_COUNT
