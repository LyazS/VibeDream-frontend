import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'
import {
  AgentTelemetry,
  newLogSource,
  type LocalAgentLog,
} from '../src/aipanel/agent/runtime/AgentTelemetry'
import {
  LOG_OWNER_HEADER,
  LOG_RETENTION_MS,
  MAX_BATCH_BYTES,
  MAX_EXPANDED_BATCH_BYTES,
  logBytes,
  toolLogMetadata,
  type LogBatch,
} from '../src/aipanel/agent/telemetry/agent-log'

const session = { id: 'chat-1', userId: 'u1', projectId: 'p1' }
const instances: AgentTelemetry[] = []
beforeEach(() => {
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  instances.forEach((t) => t.dispose())
  instances.length = 0
  indexedDBService.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup(send: typeof fetch, currentUser = () => 'u1') {
  const t = new AgentTelemetry(currentUser, send)
  instances.push(t)
  return t
}
async function saved(): Promise<LocalAgentLog> {
  return indexedDBService.transaction('agentLogs', 'readonly', (store) =>
    store.get(JSON.stringify(['u1', 'p1', 'chat-1'])),
  )
}
function ack(batch: LogBatch) {
  return Response.json({
    log_session_id: batch.log_session_id,
    spans: batch.spans.map((s) => ({ span_id: s.span_id, revision: s.revision })),
    ...(batch.summary ? { summary_revision: batch.summary.revision } : {}),
  })
}
const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as LogBatch

const repeatedInput = () => ({
  messages: [{ role: 'system', content: 'system prompt\n'.repeat(500) }],
  tools: [{ name: 'ask_user', description: 'tool description\n'.repeat(500) }],
})

it('compresses stopped snapshots against ACKed and same-batch nodes, retaining full local inputs', async () => {
  const batches: LogBatch[] = []
  const t = setup(async (_url, init) => {
    const batch = body(init)
    batches.push(batch)
    return ack(batch)
  })
  const input = repeatedInput()
  await t.record(session, 'm1', 'model_call', newLogSource('completed', input), 'm1')
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(batches[0].spans[0].input_delta).toBeUndefined()
  await t.record(
    session,
    'm2',
    'model_call',
    newLogSource('completed', {
      ...input,
      messages: [...input.messages, { role: 'user', content: 'next' }],
    }),
    'm2',
  )
  await t.record(
    session,
    'm3',
    'model_call',
    newLogSource('completed', {
      ...input,
      messages: [...input.messages, { role: 'user', content: 'last' }],
    }),
    'm3',
  )
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(batches[2].spans.map((span) => span.input_delta?.base_span_id)).toEqual(['m1', 'm2'])
  expect((await saved()).spans.every((span) => span.source.input)).toBe(true)
  expect((await saved()).spans.every((span) => !('input_delta' in span))).toBe(true)
})

it.each([
  [409, 'LOG_DELTA_BASE_MISSING'],
  [400, 'LOG_INVALID'],
  [413, 'LOG_DELTA_INVALID'],
] as const)(
  'persists full-input fallback for %s %s and resumes that snapshot after refresh',
  async (status, error) => {
    let failed = false
    const batches: LogBatch[] = []
    const t = setup(async (_url, init) => {
      const batch = body(init)
      batches.push(batch)
      if (batch.spans.some((span) => span.input_delta)) return Response.json({ error }, { status })
      if (failed) return Response.json({ error: 'TEMPORARY' }, { status: 503 })
      return ack(batch)
    })
    const input = repeatedInput()
    await t.record(session, 'm1', 'model_call', newLogSource('completed', input), 'm1')
    await t.publish(session, 'completed', 'title')
    await vi.waitFor(async () => expect((await saved()).published).toBeNull())
    failed = true
    await t.record(session, 'm2', 'model_call', newLogSource('completed', input), 'm2')
    await t.publish(session, 'completed', 'title')
    await vi.waitFor(() => expect(batches).toHaveLength(4))
    t.dispose()
    const state = await saved()
    expect(state.published?.full_inputs).toBe(true)
    expect(state.rejection).toBeNull()
    expect(batches[2].spans[0].input_delta).toBeDefined()
    expect(batches[3].spans[0].input_delta).toBeUndefined()
    const resumed: LogBatch[] = []
    const fresh = setup(async (_url, init) => {
      const batch = body(init)
      resumed.push(batch)
      return ack(batch)
    })
    await fresh.resume('u1', 'p1')
    await vi.waitFor(async () => expect((await saved()).published).toBeNull())
    expect(resumed[0].spans[0].input_delta).toBeUndefined()
    expect(resumed[0].spans[0].source.input).toEqual(input)
    expect(resumed[0].log_session_id).toBe(state.log_session_id)
  },
)

it('caps both encoded and expanded batch sizes and restores full baselines after log rotation', async () => {
  const batches: LogBatch[] = []
  const t = setup(async (_url, init) => {
    const batch = body(init)
    batches.push(batch)
    return ack(batch)
  })
  const input = { messages: [{ role: 'system', content: 'x'.repeat(90000) }], tools: [] }
  for (let i = 1; i <= 30; i++)
    await t.record(session, `m${i}`, 'model_call', newLogSource('completed', input), `m${i}`)
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  const original = await saved()
  const parts = batches.filter((batch) => batch.spans.length)
  expect(parts).toHaveLength(2)
  for (const part of parts) {
    expect(logBytes(part)).toBeLessThan(MAX_BATCH_BYTES)
    const fullSize = part.spans.reduce(
      (bytes, span) => bytes + logBytes(original.spans.find((s) => s.span_id === span.span_id)),
      0,
    )
    expect(fullSize).toBeLessThan(MAX_EXPANDED_BATCH_BYTES)
  }
  expect(parts[1].spans[0].input_delta).toBeDefined()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + LOG_RETENTION_MS + 1000)
  await t.activity(session)
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  const renewed = batches.find((batch) => batch.log_session_id !== original.log_session_id)!
  expect(renewed.spans[0].span_id).toBe('m1')
  expect(renewed.spans[0].input_delta).toBeUndefined()
  expect(renewed.spans[0].source.input).toEqual(input)
  expect(Object.keys((await saved()).acked)).toHaveLength(30)
})

it('uploads only at stops, freezes revisions, and publishes changes made during upload at the next stop', async () => {
  const batches: LogBatch[] = []
  let release!: (response: Response) => void
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    const batch = body(init)
    batches.push(batch)
    if (batches.length === 1)
      return new Promise((resolve) => {
        release = resolve
      })
    return ack(batch)
  })
  const t = setup(send)
  await t.activity(session)
  await t.record(
    session,
    'm1',
    'model_call',
    newLogSource('running', { messages: ['actual request'] }),
    'm1',
  )
  await t.finish(session, 'm1', { status: 'completed', output: 'version 2' })
  expect(send).not.toHaveBeenCalled()
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  await t.finish(session, 'm1', { output: 'unpublished version 3' })
  expect(batches[0].spans[0].source.output).toBe('version 2')
  release(ack(batches[0]))
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(batches).toHaveLength(2)
  expect(batches[1].spans).toEqual([])
  expect((await saved()).acked.m1).toBe(2)
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(batches[2].spans[0].revision).toBe(3)
  expect(batches[2].spans[0].source.output).toBe('unpublished version 3')
  expect((await saved()).spans).toHaveLength(1)
})

it('does not apply a late old-log ACK after expiration and republishes all history under the stable new ID', async () => {
  const batches: LogBatch[] = []
  let release!: (response: Response) => void
  const t = setup(async (_url, init) => {
    const batch = body(init)
    batches.push(batch)
    if (batches.length === 1)
      return new Promise((resolve) => {
        release = resolve
      })
    return ack(batch)
  })
  await t.record(session, 'u1', 'user_message', newLogSource('completed', 'first'))
  await t.publish(session, 'completed', 'first')
  await vi.waitFor(() => expect(batches).toHaveLength(1))
  const old = (await saved()).log_session_id
  const future = Date.now() + LOG_RETENTION_MS + 1000
  vi.spyOn(Date, 'now').mockReturnValue(future)
  await t.activity(session)
  const newId = (await saved()).log_session_id
  expect(newId).not.toBe(old)
  await t.record(session, 'u2', 'user_message', newLogSource('completed', 'second'))
  await t.publish(session, 'completed', 'first')
  release(ack(batches[0]))
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(batches[1].log_session_id).toBe(newId)
  expect(batches[1].spans.map((s) => s.span_id)).toEqual(['u1', 'u2'])
  expect((await saved()).log_session_id).toBe(newId)
  expect((await saved()).chat_session_id).toBe(session.id)
})

it('rotates on server expiry, persists full history before retry and resumes after refresh with the same ID', async () => {
  let phase = 'first'
  const batches: LogBatch[] = []
  const t = setup(async (_url, init) => {
    const batch = body(init)
    batches.push(batch)
    if (phase === 'expired') {
      phase = 'failed'
      return Response.json({ error: 'LOG_EXPIRED' }, { status: 409 })
    }
    if (phase === 'failed') return Response.json({ error: 'TEMPORARY' }, { status: 503 })
    return ack(batch)
  })
  await t.record(session, 'u1', 'user_message', newLogSource('completed', 'first'))
  await t.publish(session, 'completed', 'first')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  const old = (await saved()).log_session_id
  phase = 'expired'
  await t.record(session, 'u2', 'user_message', newLogSource('completed', 'second'))
  await t.publish(session, 'completed', 'first')
  await vi.waitFor(() => expect(phase).toBe('failed'))
  await vi.waitFor(() => expect(batches).toHaveLength(4))
  t.dispose()
  const state = await saved()
  expect(state.log_session_id).not.toBe(old)
  expect(state.published?.spans.map((s) => s.span_id)).toEqual(['u1', 'u2'])
  const resumed: LogBatch[] = []
  const fresh = setup(async (_url, init) => {
    const b = body(init)
    resumed.push(b)
    return ack(b)
  })
  await fresh.resume('u1', 'p1')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect(resumed[0].log_session_id).toBe(state.log_session_id)
  expect(resumed[0].spans.map((s) => s.span_id)).toEqual(['u1', 'u2'])
  expect((await saved()).spans.map((s) => s.span_id)).toEqual(['u1', 'u2'])
})

it('isolates account credentials and preserves a rejected snapshot as incomplete', async () => {
  let user = 'u2'
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({ error: 'LOG_CONFLICT' }, { status: 409 }),
  )
  const t = setup(send, () => user)
  await t.record(session, 'u1', 'user_message', newLogSource('completed', 'first'))
  await t.publish(session, 'completed', 'first')
  expect(send).not.toHaveBeenCalled()
  await t.resume('u1', 'p1')
  expect(send).not.toHaveBeenCalled()
  user = 'u1'
  await t.flush(session)
  const state = await saved()
  expect(state.rejection).toBe('LOG_CONFLICT')
  expect(state.missing).toContain('upload:LOG_CONFLICT')
  expect(state.published).not.toBeNull()
  await t.flush(session)
  expect(send).toHaveBeenCalledOnce()
})

it('binds uploads to the original account and resumes a cookie mismatch without permanent rejection', async () => {
  let switched = true
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get(LOG_OWNER_HEADER)).toBe(session.userId)
    return switched
      ? Response.json({ error: 'LOG_ACCOUNT_CHANGED' }, { status: 403 })
      : ack(body(init))
  })
  const t = setup(send)
  await t.record(session, 'u1', 'user_message', newLogSource('completed', 'original account'))
  await t.publish(session, 'completed', 'title')
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  await vi.waitFor(async () => {
    expect((await saved()).published).not.toBeNull()
    expect((await saved()).rejection).toBeFalsy()
  })
  switched = false
  await t.flush(session)
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
})

it('stores interaction metadata in the model, one independent answer result, and no rewritten request', async () => {
  const t = setup(async (_url, init) => ack(body(init)))
  const model = newLogSource('completed', { messages: [{ role: 'user', content: 'question' }] })
  model.output = {
    message: {
      tool_calls: [
        {
          id: 'ask1',
          name: 'ask_user',
          args: { question: 'pick one' },
          ...toolLogMetadata('ask_user'),
        },
      ],
    },
  }
  await t.record(session, 'm1', 'model_call', model, 'm1')
  await t.publish(session, 'waiting', 'question')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  const original = (await saved()).spans[0]
  const result = newLogSource('completed', { name: 'ask_user', args: { question: 'pick one' } })
  result.output = {
    content: '[ASK_RESULT]\nA',
    interaction: { answer: 'A', submitted_via: 'option' },
  }
  await t.record(session, 'tool:ask1', 'tool_result', result, 'm1', 'ask1')
  await t.publish(session, 'cancelled', 'question')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  const state = await saved()
  expect(state.spans).toHaveLength(2)
  expect(state.spans[0]).toEqual(original)
  expect(state.spans[1]).toMatchObject({
    kind: 'tool_result',
    sequence: 2,
    model_call_id: 'm1',
    tool_call_id: 'ask1',
  })
  expect(toolLogMetadata('read_media')).toEqual({ classification: 'tool' })
})

it('contains local storage failures and marks missing history after storage recovers', async () => {
  const send = vi.fn<typeof fetch>(async (_url, init) => ack(body(init)))
  const t = setup(send)
  const failure = vi
    .spyOn(indexedDBService, 'openDB')
    .mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(
    t.record(session, 'lost', 'user_message', newLogSource('completed', 'not persisted')),
  ).resolves.toBeUndefined()
  failure.mockRestore()
  await t.record(session, 'kept', 'user_message', newLogSource('completed', 'persisted'))
  await t.publish(session, 'failed', 'title')
  await vi.waitFor(async () => expect((await saved()).published).toBeNull())
  expect((await saved()).missing).toContain('storage:LOCAL_WRITE_FAILED')
  const finalBatch = body(send.mock.calls[send.mock.calls.length - 1][1])
  expect(finalBatch.summary?.path_incomplete).toBe(true)
})
