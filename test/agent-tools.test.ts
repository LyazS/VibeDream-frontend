import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentTools,
  createToolRuntime,
  type ToolContext,
} from '../src/aipanel/agent/runtime/ToolRuntime'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), describe: vi.fn() }))
vi.mock('../src/aipanel/agent/composables/tools', () => ({ executeTool: mocks.execute }))
vi.mock('../src/aipanel/agent/services/itemPropertyService', () => ({
  describeItemProperties: mocks.describe,
}))
beforeEach(() => vi.clearAllMocks())

function context(): ToolContext {
  return {
    userId: 'u1',
    projectId: 'p1',
    sessionId: 's1',
    turnId: 't1',
    signal: new AbortController().signal,
    isCurrent: () => true,
  }
}

describe('original tool adapter', () => {
  it('preserves executor arguments, context, and opaque output without rewriting', async () => {
    const runtime = createToolRuntime()
    const call = {
      id: 'c1',
      name: 'read_tracks',
      args: { trackIds: ['a', 'b'], start: '00:00:00+00' },
    }
    const result = { success: true, output: '原样输出\n...省略部分关键帧' }
    mocks.execute.mockResolvedValueOnce(result)
    const ctx = context()
    expect(await runtime.execute(call, ctx)).toBe(result)
    expect(mocks.execute).toHaveBeenCalledWith(call.name, call.args, {
      ...ctx,
      toolCallId: call.id,
    })
  })
  it('routes property descriptions through the authenticated independent service', async () => {
    const runtime = createToolRuntime()
    const call = {
      id: 'c2',
      name: 'describe_item_property',
      args: { propertyIds: ['visual.position.x'], usage: 'static_edit' },
    }
    const data = {
      tool: 'describe_item_property',
      propertyDescriptions: [
        { requestedPropertyId: 'visual.position.x', success: true, description: '原属性说明' },
      ],
    }
    mocks.describe.mockResolvedValueOnce({ data, success: true })
    const ctx = context()
    expect(await runtime.execute(call, ctx)).toEqual({
      success: true,
      output: JSON.stringify(data, null, 2),
      error: undefined,
    })
    expect(mocks.describe).toHaveBeenCalledWith(call.args, { signal: ctx.signal })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('does not coerce nested JSON strings or execute unknown tools', async () => {
    const runtime = createToolRuntime()
    await expect(
      runtime.execute(
        { id: 'c3', name: 'add_track', args: { trackType: 'text', position: '1' } },
        context(),
      ),
    ).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    await expect(
      runtime.execute({ id: 'c4', name: 'inspect_timeline_frames', args: {} }, context()),
    ).rejects.toThrow('TOOL_NOT_FOUND')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('exposes all 30 original definitions including complete nested move arguments', () => {
    expect(agentTools).toHaveLength(30)
    expect(new Set(agentTools.map((tool) => tool.name)).size).toBe(30)
    const move = agentTools.find((tool) => tool.name === 'move_clip')!
    expect(move.parameters).toMatchObject({
      properties: {
        clipId: { type: 'string' },
        start: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        trackId: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
        },
      },
    })
    expect(move.description).toContain('What It Does')
  })
})
