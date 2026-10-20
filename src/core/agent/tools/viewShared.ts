import Ajv from 'ajv'
import { FRAME_RATE } from '@/constants/TimeConstants'
import { viewMediaDefinition } from '../runtime/toolDefinitions/viewMedia'
import { viewTimelineDefinition } from '../runtime/toolDefinitions/viewTimeline'
import {
  AgentImageSourceError,
  encodeAgentVisual,
  isAgentImageSourceMissing,
  type AgentViewRegion,
} from '../services/agentImageService'
import { AGENT_MAX_IMAGE_COUNT } from '../services/agentImageValidation'
import { AGENT_VIEW_DEFAULT_FRAME_COUNT } from '../constants/visual'
import type { ToolExecutionContext, ToolImageInput, ToolResult } from './types'
import { buildToolException } from './utils/result'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'

/** 单个观察目标的区域与时间选项；区域相对于来源的完整显示画面。 */
export type ViewOptions = {
  region?: AgentViewRegion
  at?: string
  timeRange?: { start: string; end: string; frameCount?: number }
}
export type ViewMediaItem = ViewOptions & {
  source: { kind: 'attachment'; attachmentId: string } | { kind: 'media'; mediaId: string }
}

const ajv = new Ajv({ strict: false })
const validators = {
  view_media: ajv.compile(viewMediaDefinition.parameters),
  view_timeline: ajv.compile(viewTimelineDefinition.parameters),
}

/** 保留可识别的工具错误码，供多目标执行时生成逐项失败说明。 */
export function viewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { toolCode: code })
}

function requestedFrameCount({ timeRange }: ViewOptions): number {
  return timeRange ? (timeRange.frameCount ?? AGENT_VIEW_DEFAULT_FRAME_COUNT) : 1
}

/** 先校验完整参数和预留图片预算，避免解码开始后才发现目标总数超限。 */
function parseViewItems<T extends ViewOptions>(
  args: Record<string, unknown>,
  tool: keyof typeof validators,
): T[] {
  if (!validators[tool](args))
    throw viewError('invalid_arguments', ajv.errorsText(validators[tool].errors))
  const items = args.items as T[]
  for (const { region: r } of items) {
    if (
      r &&
      (![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
        r.x + r.width > 1 ||
        r.y + r.height > 1)
    )
      throw viewError('invalid_arguments', '裁剪区域越界。')
  }
  if (
    items.reduce((count, item) => count + requestedFrameCount(item), 0) > AGENT_MAX_IMAGE_COUNT
  )
    throw viewError(
      'visual_budget_exceeded',
      `每次调用最多输出 ${AGENT_MAX_IMAGE_COUNT} 张图片，请减少目标或 frameCount。`,
    )
  return items
}

/** 按素材工具自身的契约解析参数，并校验跨目标的图片预算。 */
export function parseViewMediaItems(args: Record<string, unknown>): ViewMediaItem[] {
  return parseViewItems<ViewMediaItem>(args, 'view_media')
}

/** 按时间轴工具自身的契约解析参数，并校验跨目标的图片预算。 */
export function parseViewTimelineItems(args: Record<string, unknown>): ViewOptions[] {
  return parseViewItems<ViewOptions>(args, 'view_timeline')
}

/** 按统一帧率生成观察帧号；duration 使用同一帧单位，时间范围为左闭右开区间。 */
export function viewSampleFrames(item: ViewOptions, duration: number): number[] {
  const parse = (value: string) => {
    if (!isValidAgentToolTimecode(value))
      throw viewError('invalid_arguments', `时间码必须为 HH:MM:SS+FF（${FRAME_RATE} fps）。`)
    return parseAgentToolTimecode(value)
  }
  if (!Number.isFinite(duration) || duration <= 0)
    throw viewError('frame_unavailable', '来源没有可渲染画面。')
  if (item.at !== undefined) {
    const at = parse(item.at)
    if (at >= duration) throw viewError('time_out_of_range', 'at 必须位于来源有效范围内。')
    return [at]
  }
  if (!item.timeRange)
    throw viewError('invalid_arguments', '视频和时间轴必须指定 at 或 timeRange。')
  const start = parse(item.timeRange.start),
    end = parse(item.timeRange.end)
  if (start >= end || end > duration)
    throw viewError('time_out_of_range', 'timeRange 必须满足 0 <= start < end <= duration。')
  const count = requestedFrameCount(item)
  // 最后一帧必须小于 end；短区间舍入后可能重合，按帧号去重。
  return [
    ...new Set(
      Array.from({ length: count }, (_, i) =>
        Math.round(start + ((end - 1 - start) * i) / (count - 1)),
      ),
    ),
  ]
}

/** 将实际观察区域写入逐图描述，后续模型请求可据此解释裁剪内容。 */
export function describeViewRegion(region?: AgentViewRegion): string {
  return region
    ? `裁剪区域（x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}）`
    : '完整画面'
}

/** 单次观察的取消、归属检查与编码入口，异步步骤结束后必须再次核对归属。 */
export interface ViewExecution {
  signal: AbortSignal
  check: () => void
  encode: (
    source: Parameters<typeof encodeAgentVisual>[0],
    width: number,
    height: number,
    item: ViewOptions,
    description: string,
  ) => Promise<ToolImageInput>
}

/** 各工具负责来源读取和资源释放，执行器统一处理多目标结果。 */
interface ViewBatch<T extends ViewOptions> {
  items: T[]
  identify: (item: T) => string
  read: (item: T) => Promise<ToolImageInput[]>
  dispose?: () => Promise<void>
}

/** 视觉工具共用预算、取消、部分成功和暂存规则，来源读取由各工具负责。 */
export async function runViewTool<T extends ViewOptions>(
  tool: 'view_media' | 'view_timeline',
  context: ToolExecutionContext,
  projectId: () => string,
  prepare: (execution: ViewExecution) => ViewBatch<T>,
): Promise<ToolResult> {
  const deadline = AbortSignal.timeout(60_000)
  const signal = AbortSignal.any([context.signal, deadline])
  const check = () => {
    signal.throwIfAborted()
    if (!context.isCurrent() || projectId() !== context.projectId)
      throw viewError('context_expired', '观察的执行归属已失效。')
  }
  const failure = (error: unknown): string => {
    if (context.signal.aborted) return 'cancelled：观察已取消。'
    if (deadline.aborted || (error instanceof Error && error.name === 'TimeoutError'))
      return 'timeout：观察超时。'
    if (error instanceof AgentImageSourceError || isAgentImageSourceMissing(error))
      return 'file_missing：附件原图已不存在。'
    const code =
      error && typeof error === 'object' && 'toolCode' in error
        ? error.toolCode
        : 'frame_unavailable'
    return `${code}：${error instanceof Error ? error.message : String(error)}`
  }
  const execution: ViewExecution = {
    signal,
    check,
    async encode(source, width, height, item, description) {
      const result = await encodeAgentVisual(source, width, height, signal, item.region)
      check()
      return {
        blob: result.blob,
        width: result.conversionParams.width,
        height: result.conversionParams.height,
        description: `${description}，${describeViewRegion(item.region)}。`,
      }
    },
  }
  let batch: ViewBatch<T> | undefined
  try {
    check()
    // 准备阶段同步解析所有参数及图片预算，并固定该工具需要的执行快照。
    batch = prepare(execution)
    const observations: ToolImageInput[] = [],
      notes: string[] = []
    for (const [index, item] of batch.items.entries()) {
      check()
      try {
        const result = await batch.read(item)
        check()
        observations.push(...result)
        const requested = requestedFrameCount(item)
        if (result.length < requested)
          notes.push(`items[${index}]：请求 ${requested} 帧，去重后返回 ${result.length} 帧。`)
      } catch (error) {
        // 单个目标失败时保留其他目标；取消或归属失效则由复核中止整个调用。
        check()
        notes.push(`items[${index}] ${batch.identify(item)}：${failure(error)}`)
      }
    }
    check()
    if (!observations.length)
      return { success: false, output: notes.join('\n'), error: notes.join('\n') }
    // 所有读取结束并通过归属复核后才暂存，避免中途失败留下半组图片引用。
    if (!context.stageImage) throw viewError('context_expired', '工具图片暂存入口不可用。')
    return {
      success: true,
      output: notes.join('\n'),
      attachIds: observations.map(context.stageImage),
    }
  } catch (error) {
    if (signal.aborted) {
      const output = failure(error)
      return { success: false, output, error: output }
    }
    return buildToolException(tool, error)
  } finally {
    await batch?.dispose?.()
  }
}
