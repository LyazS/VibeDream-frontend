/**
 * 编辑器独立维护的输入差分协议，对应 cloudflare-backend/src/agent/telemetry-protocol/agent-log-delta.ts。
 * 修改版本、基准哈希或数组差分规则时，需同步核对另一端的编码和还原逻辑。
 */
import { canonicalLog, LOG_ID, logBytes, type LogSpan, type LogUploadSpan } from './agent-log'

const VERSION = 'lightcut-agent-input-delta-v1'
const MAX_ITEMS = 8192
type ArrayDelta = { length: number; changes: { index: number; value: unknown }[] }
export type LogInputDelta = {
  version: typeof VERSION
  base_span_id: string
  base_revision: number
  base_sha256: string
  fields: Record<string, unknown>
  messages: ArrayDelta
  tools?: ArrayDelta
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)

export function hasLogInput(span: LogSpan): boolean {
  return (
    span.kind === 'model_call' &&
    object(span.source.input) &&
    Array.isArray(span.source.input.messages)
  )
}
export async function logInputDigest(input: unknown): Promise<string> {
  // 哈希键顺序不依赖浏览器或 Worker 的语言环境，确保两端校验同一输入时结果一致。
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered)
    if (object(value))
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ordered(value[key])]),
      )
    return value
  }
  const bytes = new TextEncoder().encode(JSON.stringify(ordered(input)))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function diffArray(value: unknown[], base: unknown[]): ArrayDelta {
  // 按位置记录变化并保留目标长度，兼容追加、删除和重排，不假定历史只会增长。
  return {
    length: value.length,
    changes: value.flatMap((item, index) =>
      index < base.length && canonicalLog(item) === canonicalLog(base[index])
        ? []
        : [{ index, value: item }],
    ),
  }
}

/** 仅压缩上传数据；本地快照始终完整，D1 存储使用独立的正文去重格式。 */
export async function encodeLogInput(span: LogSpan, base: LogSpan): Promise<LogUploadSpan> {
  try {
    if (!hasLogInput(span) || !hasLogInput(base) || base.sequence >= span.sequence) return span
    const input = span.source.input as Record<string, unknown>
    const prior = base.source.input as Record<string, unknown>
    const messages = input.messages as unknown[]
    const tools = Array.isArray(input.tools) ? input.tools : undefined
    if (messages.length > MAX_ITEMS || (tools && tools.length > MAX_ITEMS)) return span
    const input_delta: LogInputDelta = {
      version: VERSION,
      base_span_id: base.span_id,
      base_revision: base.revision,
      base_sha256: await logInputDigest(prior),
      fields: Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'messages' && !(tools && key === 'tools')),
      ),
      messages: diffArray(messages, prior.messages as unknown[]),
      ...(tools ? { tools: diffArray(tools, Array.isArray(prior.tools) ? prior.tools : []) } : {}),
    }
    const encoded: LogUploadSpan = { ...span, source: { ...span.source }, input_delta }
    delete encoded.source.input
    // 差分自身也有引用和哈希开销，至少节省 128 字节才值得替换完整输入。
    return logBytes(encoded) + 128 < logBytes(span) ? encoded : span
  } catch {
    return span
  }
}

function validArray(value: unknown): value is ArrayDelta {
  if (
    !object(value) ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.length) ||
    Number(value.length) < 0 ||
    Number(value.length) > MAX_ITEMS ||
    !Array.isArray(value.changes) ||
    value.changes.length > Number(value.length)
  )
    return false
  const seen = new Set<number>()
  return value.changes.every((change) => {
    if (
      !object(change) ||
      Object.keys(change).length !== 2 ||
      !own(change, 'value') ||
      !Number.isSafeInteger(change.index) ||
      Number(change.index) < 0 ||
      Number(change.index) >= Number(value.length) ||
      seen.has(Number(change.index))
    )
      return false
    seen.add(Number(change.index))
    return true
  })
}
export function validLogInputDelta(value: unknown): value is LogInputDelta {
  return (
    object(value) &&
    value.version === VERSION &&
    Object.keys(value).every((key) =>
      [
        'version',
        'base_span_id',
        'base_revision',
        'base_sha256',
        'fields',
        'messages',
        'tools',
      ].includes(key),
    ) &&
    typeof value.base_span_id === 'string' &&
    LOG_ID.test(value.base_span_id) &&
    Number.isSafeInteger(value.base_revision) &&
    Number(value.base_revision) > 0 &&
    typeof value.base_sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.base_sha256) &&
    object(value.fields) &&
    !own(value.fields, 'messages') &&
    validArray(value.messages) &&
    (!own(value, 'tools') || (validArray(value.tools) && !own(value.fields, 'tools')))
  )
}
function restoreArray(delta: ArrayDelta, base: unknown[]): unknown[] {
  const result = base.slice(0, delta.length)
  result.length = delta.length
  for (const change of delta.changes) result[change.index] = change.value
  for (let index = 0; index < result.length; index++)
    if (!own(result, index)) throw new Error('LOG_DELTA_INVALID')
  return result
}
export async function restoreLogInput(delta: LogInputDelta, base: LogSpan): Promise<unknown> {
  if (!validLogInputDelta(delta)) throw new Error('LOG_DELTA_INVALID')
  if (
    base.span_id !== delta.base_span_id ||
    base.revision !== delta.base_revision ||
    !hasLogInput(base) ||
    (await logInputDigest(base.source.input)) !== delta.base_sha256
  )
    throw new Error('LOG_DELTA_BASE_MISSING')
  const prior = base.source.input as Record<string, unknown>
  return {
    ...delta.fields,
    messages: restoreArray(delta.messages, prior.messages as unknown[]),
    ...(delta.tools
      ? { tools: restoreArray(delta.tools, Array.isArray(prior.tools) ? prior.tools : []) }
      : {}),
  }
}
