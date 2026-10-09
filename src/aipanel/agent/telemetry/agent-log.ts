/**
 * 编辑器独立维护的日志协议实现，不跨应用引用代码。
 * 对应实现：cloudflare-backend/src/agent/telemetry-protocol/agent-log.ts、admin-frontend/src/types/agentLogProtocol.ts。
 * 修改协议字段、版本、限制或工具分类时，需核对对应端的兼容性并同步相关变更。
 */
export const AGENT_LOG_PROTOCOL = 'lightcut-agent-log-v1'
export const LOG_OWNER_HEADER = 'X-Lightcut-Log-Owner'
export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_SPAN_BYTES = 256 * 1024
export const MAX_BATCH_BYTES = 512 * 1024
export const MAX_EXPANDED_BATCH_BYTES = 2 * 1024 * 1024
export const MAX_LOCAL_LOG_BYTES = 16 * 1024 * 1024
export const LOG_ID = /^[A-Za-z0-9._:-]{1,128}$/
export type SpanKind = 'user_message' | 'model_call' | 'tool_result' | 'diagnostic'
export type StopStatus = 'completed' | 'waiting' | 'cancelled' | 'failed' | 'interrupted'
export type LogIdentity = {
  chat_session_id: string
  log_session_id: string
  span_id: string
  sequence: number
}
export function validLogIdentity(value: unknown): value is LogIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    Object.keys(v).length === 4 &&
    ['chat_session_id', 'log_session_id', 'span_id'].every(
      (key) => typeof v[key] === 'string' && LOG_ID.test(v[key]),
    ) &&
    Number.isSafeInteger(v.sequence) &&
    Number(v.sequence) > 0
  )
}
export type LogSource = {
  status: string
  started_at: string
  ended_at?: string
  duration_ms?: number
  input?: unknown
  output?: unknown
  error?: unknown
  events?: unknown[]
  build: string
  completeness: { missing: string[]; redacted: boolean }
}
export type LogSpan = {
  span_id: string
  sequence: number
  kind: SpanKind
  model_call_id: string | null
  tool_call_id: string | null
  revision: number
  source: LogSource
}
export type LogUploadSpan = LogSpan & { input_delta?: LogInputDelta }
export type LogSummary = {
  revision: number
  title: string
  stop_status: StopStatus
  span_count: number
  last_sequence: number
  path_incomplete: boolean
  missing: string[]
}
export type LogBatch = {
  protocol: typeof AGENT_LOG_PROTOCOL
  chat_session_id: string
  log_session_id: string
  project_id: string
  history_required: boolean
  spans: LogUploadSpan[]
  summary?: LogSummary
}
export type LogAck = {
  log_session_id: string
  spans: { span_id: string; revision: number }[]
  summary_revision?: number
}

const toolClasses: Record<string, 'tool' | 'interaction'> = {
  ask_user: 'interaction',
}
export function toolLogMetadata(name: string) {
  const classification = toolClasses[name] ?? 'tool'
  return {
    classification,
    ...(classification === 'interaction'
      ? {
          answer_contract: {
            value: 'string',
            submitted_via: ['option', 'custom_input'],
          },
        }
      : {}),
  }
}

export function logBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
export function canonicalLog(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, sort(x)]),
      )
    return v
  }
  return JSON.stringify(sort(value))
}

/** Redact credentials in structured fields, embedded JSON, headers and signed URLs. */
export function sanitizeLog(value: unknown): {
  value: unknown
  redacted: boolean
  truncated: boolean
} {
  let redacted = false
  let truncated = false
  const secret =
    /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|.*secret.*|password|token|access[-_]?token|refresh[-_]?token|id[-_]?token|signature|sign|credential|security[-_]?token|x-oss-security-token|x-amz-.*|x-oss-signature|ossaccesskeyid|awsaccesskeyid)$/i
  const hide = () => {
    redacted = true
    return '[REDACTED]'
  }
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 60) {
      truncated = true
      return '[DEPTH_LIMIT]'
    }
    if (Array.isArray(v)) return v.map((x) => visit(x, depth + 1))
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, secret.test(k) ? hide() : visit(x, depth + 1)]),
      )
    if (typeof v !== 'string') return v
    if (/^\s*[{[]/.test(v)) {
      try {
        const parsed = JSON.parse(v)
        const clean = visit(parsed, depth + 1)
        if (JSON.stringify(parsed) !== JSON.stringify(clean)) return JSON.stringify(clean)
      } catch {
        /* Plain text may start with a bracket. */
      }
    }
    let text = v
    if (text.includes('data:')) {
      text = text.replace(/(^|\n)(data:\s*)([^\r\n]+)/g, (whole, newline, prefix, data) => {
        try {
          const parsed = JSON.parse(data)
          const clean = visit(parsed, depth + 1)
          return JSON.stringify(parsed) === JSON.stringify(clean)
            ? whole
            : `${newline}${prefix}${JSON.stringify(clean)}`
        } catch {
          return whole
        }
      })
    }
    return text
      .replace(
        /(["'](?:api[-_]?key|password|access[-_]?token|refresh[-_]?token|signature|secret)["']\s*:\s*["'])[^"']*(["'])/gi,
        (_m, prefix, suffix) => prefix + hide() + suffix,
      )
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, (_m, prefix) => prefix + hide())
      .replace(
        /\b(Authorization|Cookie|Set-Cookie|X-Api-Key)\s*:[^\r\n]+/gi,
        (_m, key) => `${key}: ${hide()}`,
      )
      .replace(/([?&])([^=\s&#]+)=([^\s&#]*)/g, (match, sep, key) => {
        let decoded = key
        try {
          decoded = decodeURIComponent(key)
        } catch {
          /* Keep malformed key opaque. */
        }
        return secret.test(decoded) ||
          /^(token|key|sig|ossaccesskeyid|awsaccesskeyid)$/i.test(decoded)
          ? `${sep}${key}=${hide()}`
          : match
      })
  }
  return { value: visit(value, 0), redacted, truncated }
}

export function boundedSource(source: LogSource): LogSource {
  const sanitized = sanitizeLog(source)
  const result = sanitized.value as LogSource
  result.completeness.redacted ||= sanitized.redacted
  if (sanitized.truncated && !result.completeness.missing.includes('source:DEPTH_LIMIT'))
    result.completeness.missing.push('source:DEPTH_LIMIT')
  for (const field of ['events', 'input', 'output', 'error'] as const) {
    if (logBytes(result) <= MAX_SPAN_BYTES - 2048) break
    if (result[field] !== undefined) {
      delete result[field]
      result.completeness.missing.push(`${field}:BYTE_LIMIT`)
    }
  }
  if (logBytes(result) > MAX_SPAN_BYTES - 2048)
    return {
      status: 'unknown',
      started_at: source.started_at,
      build: source.build.slice(0, 128),
      completeness: {
        missing: ['source:BYTE_LIMIT'],
        redacted: sanitized.redacted,
      },
    }
  return result
}
import type { LogInputDelta } from './agent-log-delta'
