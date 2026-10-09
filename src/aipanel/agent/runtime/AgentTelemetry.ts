import { indexedDBService } from '@/core/storage/IndexedDBService'
import { API_BASE_URL } from '@/config/runtimeConfig'
import {
  AGENT_LOG_PROTOCOL,
  LOG_OWNER_HEADER,
  LOG_RETENTION_MS,
  MAX_BATCH_BYTES,
  MAX_EXPANDED_BATCH_BYTES,
  MAX_LOCAL_LOG_BYTES,
  boundedSource,
  logBytes,
  type LogAck,
  type LogBatch,
  type LogIdentity,
  type LogSource,
  type LogSpan,
  type LogSummary,
  type StopStatus,
} from '../telemetry/agent-log'
import { encodeLogInput, hasLogInput } from '../telemetry/agent-log-delta'

type Owner = { id: string; userId: string; projectId: string }
export type LocalAgentLog = {
  key: string
  owner: string
  sessionKey: string
  chat_session_id: string
  log_session_id: string
  user_id: string
  project_id: string
  last_activity: number
  next_sequence: number
  summary_revision: number
  spans: LogSpan[]
  /** 服务端已确认的节点版本；同一节点完成或失败后仍可用更高版本补传。 */
  acked: Record<string, number>
  history_required: boolean
  rotation_pending: boolean
  missing: string[]
  /** 停止或等待交互时冻结的上传快照，不随下一轮执行中的节点变化。 */
  published: {
    log_session_id: string
    spans: LogSpan[]
    summary: LogSummary
    full_inputs?: boolean
  } | null
  rejection: string | null
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function newLogSource(status: string, input?: unknown): LogSource {
  return {
    status,
    started_at: new Date().toISOString(),
    input,
    build: `editor:${import.meta.env.VITE_AGENT_LOG_BUILD ?? import.meta.env.MODE}`,
    completeness: { missing: [], redacted: false },
  }
}

/** 独立保存并补传日志快照；存储或上传失败不向 Agent 主执行流程抛出异常。 */
export class AgentTelemetry {
  private queue: Promise<unknown> = Promise.resolve()
  private uploading = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false
  private storageFailed = false
  private deleted = new Set<string>()
  constructor(
    private currentUser: () => string | undefined,
    private send: typeof fetch = (...args) => fetch(...args),
  ) {}

  private key(session: Owner) {
    return JSON.stringify([session.userId, session.projectId, session.id])
  }

  private operation<T>(work: () => Promise<T>): Promise<T | undefined> {
    // 串行执行本地读改写，避免录入、完成和上传确认相互覆盖版本。
    const result = this.queue.then(work).catch(() => {
      this.storageFailed = true
      console.warn('agent_local_log_write_failed')
      return undefined
    })
    this.queue = result
    return result
  }

  private async read(key: string): Promise<LocalAgentLog | undefined> {
    const db = await indexedDBService.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('agentLogs', 'readonly')
      const req = tx.objectStore('agentLogs').get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private mutate<T>(
    session: Owner,
    update: (state: LocalAgentLog) => T,
    historyMissing = false,
  ): Promise<T | undefined> {
    return this.operation(async () => {
      const key = this.key(session)
      if (this.deleted.has(key)) return undefined as T
      const db = await indexedDBService.openDB()
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('agentLogs', 'readwrite')
        const store = tx.objectStore('agentLogs')
        const req = store.get(key)
        let result: T
        req.onsuccess = () => {
          try {
            const state: LocalAgentLog = req.result ?? {
              key,
              owner: JSON.stringify([session.userId, session.projectId]),
              sessionKey: key,
              chat_session_id: session.id,
              log_session_id: crypto.randomUUID(),
              user_id: session.userId,
              project_id: session.projectId,
              last_activity: Date.now(),
              next_sequence: 1,
              summary_revision: 0,
              spans: [],
              acked: {},
              history_required: false,
              rotation_pending: false,
              missing: historyMissing ? ['history:LOCAL_HISTORY_MISSING'] : [],
              published: null,
              rejection: null,
            }
            if (this.storageFailed && !state.missing.includes('storage:LOCAL_WRITE_FAILED'))
              state.missing.push('storage:LOCAL_WRITE_FAILED')
            result = update(state)
            store.put(state)
          } catch {
            tx.abort()
          }
        }
        tx.oncomplete = () => resolve(result)
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
    })
  }

  private rotate(state: LocalAgentLog) {
    // 云端日志过期后换用新日志 ID；保留本地节点，清空确认记录以便重新上传。
    state.log_session_id = crypto.randomUUID()
    state.acked = {}
    state.history_required = false
    state.rotation_pending = true
    state.last_activity = Date.now()
    state.rejection = null
    if (state.published) state.published.log_session_id = state.log_session_id
  }

  activity(session: Owner, historyMissing = false) {
    return this.mutate(
      session,
      (state) => {
        if (Date.now() - state.last_activity >= LOG_RETENTION_MS) this.rotate(state)
        state.last_activity = Date.now()
      },
      historyMissing,
    )
  }

  record(
    session: Owner,
    id: string,
    kind: LogSpan['kind'],
    source: LogSource,
    modelCallId: string | null = null,
    toolCallId: string | null = null,
  ): Promise<LogIdentity | undefined> {
    // 入队前脱敏并冻结正文，避免调用方后续修改响应式对象而改变这次记录。
    let snapshot: LogSource
    try {
      snapshot = boundedSource(source)
    } catch {
      return Promise.resolve(undefined)
    }
    return this.mutate(session, (state) => {
      const existing = state.spans.find((s) => s.span_id === id)
      const span: LogSpan = {
        span_id: id,
        sequence: existing?.sequence ?? state.next_sequence,
        revision: (existing?.revision ?? 0) + 1,
        kind,
        model_call_id: modelCallId,
        tool_call_id: toolCallId,
        source: snapshot,
      }
      if (existing) state.spans[state.spans.indexOf(existing)] = span
      else {
        state.spans.push(span)
        state.next_sequence++
      }
      if (logBytes(state.spans) > MAX_LOCAL_LOG_BYTES * 0.45 || state.spans.length > 8192) {
        // 超限时先保留节点及缺失标记；仍放不下才撤回本次更新，不静默截断正文。
        span.source = {
          ...newLogSource(source.status),
          completeness: {
            missing: ['source:LOCAL_QUEUE_LIMIT'],
            redacted: snapshot.completeness.redacted,
          },
        }
        if (!state.missing.includes('queue:LOCAL_QUEUE_LIMIT'))
          state.missing.push('queue:LOCAL_QUEUE_LIMIT')
        if (logBytes(state.spans) > MAX_LOCAL_LOG_BYTES * 0.45 || state.spans.length > 8192) {
          if (existing) state.spans[state.spans.indexOf(span)] = existing
          else state.spans.pop()
          return undefined
        }
      }
      return {
        chat_session_id: session.id,
        log_session_id: state.log_session_id,
        span_id: id,
        sequence: span.sequence,
      }
    })
  }

  async finish(session: Owner, id: string, changes: Partial<LogSource>) {
    const key = this.key(session)
    return this.operation(async () => {
      const state = await this.read(key)
      const span = state?.spans.find((s) => s.span_id === id)
      if (!state || !span) return
      const end = new Date().toISOString()
      span.source = boundedSource({
        ...span.source,
        ...copy(changes),
        ended_at: end,
        duration_ms: Date.parse(end) - Date.parse(span.source.started_at),
      })
      if (logBytes(state.spans) > MAX_LOCAL_LOG_BYTES * 0.45) {
        delete span.source.output
        delete span.source.events
        span.source.completeness.missing.push('output:LOCAL_QUEUE_LIMIT')
        state.missing = [...new Set([...state.missing, 'queue:LOCAL_QUEUE_LIMIT'])]
      }
      span.revision++
      await this.save(state)
    })
  }

  private async save(state: LocalAgentLog) {
    const db = await indexedDBService.openDB()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('agentLogs', 'readwrite')
      tx.objectStore('agentLogs').put(state)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  }

  async publish(session: Owner, status: StopStatus, title: string) {
    // 只发布已停止推进的快照；上传在后台进行，不阻塞本次 Agent 运行结束。
    await this.mutate(session, (state) => {
      const summary: LogSummary = {
        revision: ++state.summary_revision,
        title: title.slice(0, 300),
        stop_status: status,
        span_count: state.spans.length,
        last_sequence: Math.max(0, ...state.spans.map((s) => s.sequence)),
        path_incomplete: state.missing.length > 0,
        missing: [...state.missing],
      }
      state.published = { log_session_id: state.log_session_id, spans: copy(state.spans), summary }
    })
    void this.flush(session)
  }

  private async batch(session: Owner): Promise<LogBatch | undefined> {
    await this.queue
    const state = await this.read(this.key(session))
    if (!state?.published || state.rejection) return
    const published = state.published
    const batch: LogBatch = {
      protocol: AGENT_LOG_PROTOCOL,
      chat_session_id: session.id,
      log_session_id: published.log_session_id,
      project_id: session.projectId,
      history_required: state.history_required,
      spans: [],
    }
    // 差分基准只能选已确认同版本的节点，或当前批次中排在前面的完整可还原节点。
    let base: LogSpan | undefined
    let expandedBytes = logBytes(batch)
    for (const span of published.spans) {
      const acked = state.acked[span.span_id] ?? 0
      if (acked >= span.revision) {
        if (acked === span.revision && hasLogInput(span)) base = span
        continue
      }
      const uploaded = base && !published.full_inputs ? await encodeLogInput(span, base) : span
      if (
        logBytes({ ...batch, spans: [...batch.spans, uploaded] }) > MAX_BATCH_BYTES - 1024 ||
        expandedBytes + logBytes(span) > MAX_EXPANDED_BATCH_BYTES - 1024 ||
        batch.spans.length >= 128
      )
        break
      batch.spans.push(uploaded)
      expandedBytes += logBytes(span) + 1
      if (hasLogInput(span)) base = span
    }
    // 所有快照节点确认后再单独上传摘要，避免云端提前将尚未传完的日志标为完整。
    if (!batch.spans.length) batch.summary = published.summary
    return batch
  }

  async flush(session: Owner, attempt = 0): Promise<void> {
    const key = this.key(session)
    // 同一会话只允许一个上传循环；每轮发送前再次核对账号，避免切号后继续补传。
    if (
      this.disposed ||
      this.deleted.has(key) ||
      this.currentUser() !== session.userId ||
      this.uploading.has(key)
    )
      return
    this.uploading.add(key)
    try {
      while (!this.disposed && !this.deleted.has(key) && this.currentUser() === session.userId) {
        const batch = await this.batch(session)
        if (!batch || this.currentUser() !== session.userId) return
        const response = await this.send(`${API_BASE_URL}/api/agent/telemetry/batch`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            [LOG_OWNER_HEADER]: session.userId,
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(15000),
        })
        const payload = await response.json()
        if (!response.ok) {
          if (payload.error === 'LOG_ACCOUNT_CHANGED') throw new Error('LOG_ACCOUNT_CHANGED')
          if (
            [400, 409, 413].includes(response.status) &&
            ['LOG_DELTA_BASE_MISSING', 'LOG_DELTA_INVALID', 'LOG_INVALID'].includes(
              payload.error,
            ) &&
            batch.spans.some((span) => span.input_delta)
          ) {
            // 基准丢失或旧服务端不支持差分时，持久化全量回退状态后重试同一快照。
            const persisted = await this.mutate(session, (state) => {
              if (state.published?.log_session_id === batch.log_session_id)
                state.published.full_inputs = true
              return true
            })
            if (!persisted) throw new Error('LOG_LOCAL_WRITE_FAILED')
            continue
          }
          if (response.status === 409 && payload.error === 'LOG_EXPIRED') {
            const rotated = await this.mutate(session, (state) => {
              if (state.log_session_id === batch.log_session_id) {
                if (state.rotation_pending) return false
                this.rotate(state)
              }
              return true
            })
            if (!rotated) throw new Error('LOG_LOCAL_WRITE_FAILED')
            continue
          }
          if ([400, 403, 409, 413, 422].includes(response.status)) {
            await this.mutate(session, (state) => {
              state.rejection = payload.error ?? 'LOG_REJECTED'
              state.missing = [...new Set([...state.missing, `upload:${state.rejection}`])]
            })
            return
          }
          throw new Error('LOG_UPLOAD_FAILED')
        }
        const ack = payload as LogAck
        // 只有日志 ID、节点版本和摘要版本均匹配，才能推进本地确认进度。
        if (
          ack.log_session_id !== batch.log_session_id ||
          !Array.isArray(ack.spans) ||
          batch.spans.some(
            (s) => !ack.spans.some((a) => a.span_id === s.span_id && a.revision === s.revision),
          ) ||
          (batch.summary && ack.summary_revision !== batch.summary.revision)
        )
          throw new Error('LOG_ACK_INVALID')
        const confirmed = await this.mutate(session, (state) => {
          if (state.log_session_id !== ack.log_session_id) return true
          state.history_required = true
          state.rotation_pending = false
          for (const sent of batch.spans)
            state.acked[sent.span_id] = Math.max(state.acked[sent.span_id] ?? 0, sent.revision)
          // 上传期间可能发布了更新快照；旧摘要的确认不能清掉新的待上传数据。
          if (batch.summary && state.published?.summary.revision === ack.summary_revision)
            state.published = null
          return true
        })
        if (!confirmed) throw new Error('LOG_LOCAL_WRITE_FAILED')
      }
    } catch {
      // 临时失败采用有限指数退避；刷新、重新进入工程或恢复网络仍可续传持久化快照。
      if (attempt < 3 && !this.disposed && this.currentUser() === session.userId) {
        clearTimeout(this.timers.get(key))
        this.timers.set(
          key,
          setTimeout(
            () => {
              this.timers.delete(key)
              void this.flush(session, attempt + 1)
            },
            1000 * 2 ** attempt,
          ),
        )
      }
    } finally {
      this.uploading.delete(key)
    }
  }

  async resume(userId: string, projectId: string) {
    await this.operation(async () => {
      const db = await indexedDBService.openDB()
      const states = await new Promise<LocalAgentLog[]>((resolve, reject) => {
        const req = db
          .transaction('agentLogs', 'readonly')
          .objectStore('agentLogs')
          .index('owner')
          .getAll(JSON.stringify([userId, projectId]))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      for (const state of states) {
        if (state.published) void this.flush({ id: state.chat_session_id, userId, projectId })
      }
    })
  }

  delete(session: Owner) {
    // 先同步拦住已排队的写入和上传，再删除本地记录，防止旧任务把会话写回来。
    this.deleted.add(this.key(session))
    return this.operation(async () => {
      const db = await indexedDBService.openDB()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('agentLogs', 'readwrite')
        tx.objectStore('agentLogs').delete(this.key(session))
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(tx.error)
      })
    })
  }

  dispose() {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
