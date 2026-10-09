import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { logBytes, type LogSpan } from '../src/core/agent/telemetry/agent-log'
import {
  encodeLogInput,
  logInputDigest,
  restoreLogInput,
  validLogInputDelta,
} from '../src/core/agent/telemetry/agent-log-delta'

const input = {
  messages: [
    { role: 'system', content: 'editing rules\n'.repeat(1000) },
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: 'first reply' },
  ],
  tools: [
    {
      name: 'ask_user',
      description: 'tool definition\n'.repeat(1000),
      parameters: { type: 'object' },
    },
  ],
  settings: { temperature: 0.7, enabled: true },
}
function span(id: string, sequence: number, value: unknown): LogSpan {
  return {
    span_id: id,
    sequence,
    revision: 2,
    kind: 'model_call',
    model_call_id: id,
    tool_call_id: null,
    source: {
      status: 'completed',
      started_at: '2026-10-09T00:00:00.000Z',
      build: 'test',
      input: value,
      output: { message: { role: 'assistant', content: 'OK' } },
      completeness: { missing: [], redacted: false },
    },
  }
}
const base = span('m1', 1, input)

it('hashes key order consistently across runtimes, including non-ASCII and punctuation keys', async () => {
  const value = { tools: [], messages: [], fields: { z: 1, '\u00e4': 2, _: 4, A: 3 } }
  const sorted = JSON.stringify({
    fields: { A: 3, _: 4, z: 1, '\u00e4': 2 },
    messages: [],
    tools: [],
  })
  expect(await logInputDigest(value)).toBe(createHash('sha256').update(sorted).digest('hex'))
})

it('reuses unchanged messages and tool definitions while retaining every input field', async () => {
  const next = span('m2', 2, {
    ...input,
    messages: [...input.messages, { role: 'user', content: 'next request' }],
  })
  const encoded = await encodeLogInput(next, base)
  expect(encoded.input_delta?.messages.changes).toEqual([
    { index: 3, value: { role: 'user', content: 'next request' } },
  ])
  expect(encoded.input_delta?.tools?.changes).toEqual([])
  expect(encoded.source).not.toHaveProperty('input')
  expect(logBytes(encoded)).toBeLessThan(logBytes(next) * 0.2)
  expect(await restoreLogInput(encoded.input_delta!, base)).toEqual(next.source.input)
  expect(next.source.input).toBeDefined()
  expect(base.source.input).toEqual(input)
})

it.each([
  {
    ...input,
    messages: [{ role: 'system', content: 'updated project context' }, ...input.messages.slice(1)],
  },
  { ...input, messages: [...input.messages].reverse() },
  { ...input, messages: input.messages.slice(0, 1), tools: [] },
  { messages: input.messages },
  { messages: input.messages, tools: 'unavailable', extra: { zero: 0, empty: '', nothing: null } },
  { ...input, tools: [{ ...input.tools[0], parameters: { type: 'string' } }] },
])(
  'round-trips modified, reordered and removed fields without a prefix assumption: %#',
  async (value) => {
    const next = span('m2', 2, value)
    const encoded = await encodeLogInput(next, base)
    expect(encoded.input_delta).toBeDefined()
    expect(await restoreLogInput(encoded.input_delta!, base)).toEqual(value)
  },
)

it('uses a full snapshot when a delta would be larger, unsupported or references a later node', async () => {
  const small = span('m2', 2, { messages: [{ role: 'user', content: 'small' }] })
  expect((await encodeLogInput(small, span('m1', 1, { messages: [] }))).input_delta).toBeUndefined()
  expect((await encodeLogInput(span('m2', 2, 'plain text'), base)).input_delta).toBeUndefined()
  expect((await encodeLogInput(base, span('later', 3, input))).input_delta).toBeUndefined()
})

it('rejects missing versions, modified baselines, duplicate changes and unfilled appended positions', async () => {
  const encoded = await encodeLogInput(span('m2', 2, input), base)
  const delta = encoded.input_delta!
  await expect(restoreLogInput(delta, { ...base, revision: 3 })).rejects.toThrow(
    'LOG_DELTA_BASE_MISSING',
  )
  await expect(restoreLogInput(delta, span('m1', 1, { ...input, settings: {} }))).rejects.toThrow(
    'LOG_DELTA_BASE_MISSING',
  )
  const duplicate = {
    ...delta,
    messages: {
      length: 3,
      changes: [
        { index: 1, value: null },
        { index: 1, value: null },
      ],
    },
  }
  expect(validLogInputDelta(duplicate)).toBe(false)
  expect(validLogInputDelta({ ...delta, fields: { messages: [] } })).toBe(false)
  expect(validLogInputDelta({ ...delta, tools: null })).toBe(false)
  expect(validLogInputDelta({ ...delta, messages: { length: 8193, changes: [] } })).toBe(false)
  await expect(
    restoreLogInput({ ...delta, messages: { length: 4, changes: [] } }, base),
  ).rejects.toThrow('LOG_DELTA_INVALID')
})
