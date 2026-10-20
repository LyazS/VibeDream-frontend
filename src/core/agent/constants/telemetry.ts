/** 日志上传请求中用于标识日志所有者的 HTTP 请求头。 */
export const LOG_OWNER_HEADER = 'X-Lightcut-Log-Owner'
/** 本地日志保留时间，单位为毫秒。 */
export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** 单个日志 span 序列化后的最大字节数。 */
export const MAX_SPAN_BYTES = 256 * 1024
/** 单次日志上传批次的最大字节数。 */
export const MAX_BATCH_BYTES = 512 * 1024
/** 展开差分后单次日志上传批次的最大字节数。 */
export const MAX_EXPANDED_BATCH_BYTES = 2 * 1024 * 1024
/** 本地日志队列允许占用的最大字节数。 */
export const MAX_LOCAL_LOG_BYTES = 16 * 1024 * 1024
/** 日志会话、span 等标识符允许使用的字符格式。 */
export const LOG_ID = /^[A-Za-z0-9._:-]{1,128}$/

/** 单个日志节点和本地队列共同使用的数组上限。 */
export const AGENT_LOG_MAX_ITEMS = 8192
/** 留出序列化元数据空间，避免日志节点刚好超过边界。 */
export const AGENT_LOG_SIZE_MARGIN_BYTES = 2048
/** 本地日志队列达到该容量比例后开始压缩日志正文。 */
export const AGENT_LOG_LOCAL_QUEUE_WARN_RATIO = 0.45
