import Ajv from 'ajv'
import { FRAME_RATE } from '@/constants/TimeConstants'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { viewMediaDefinition } from '../runtime/toolDefinitions/viewMedia'
import { viewTimelineDefinition } from '../runtime/toolDefinitions/viewTimeline'
import {
  AgentImageSourceError,
  encodeAgentVisual,
  isAgentImageSourceMissing,
  visualCrop,
  type AgentViewRegion,
} from '../services/agentImageService'
import { AGENT_MAX_IMAGE_COUNT, AGENT_MAX_IMAGE_EDGE } from '../services/agentImageValidation'
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

/** 一个 contact sheet 中的单个视频或时间轴画面。 */
export type ViewContactSheetFrame = {
  timecode: string
  width: number
  height: number
  draw: (context: CanvasRenderingContext2D, crop: ReturnType<typeof visualCrop>) => void
}

export type ViewContactSheetResult = {
  blob: Blob
  width: number
  height: number
  rows: number
  columns: number
}

export type ViewReadResult = {
  images: ToolImageInput[]
  note?: string
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

/** 选择尽量接近正方形、同时尽量少留空格的网格；最多支持 5×5。 */
export function viewContactSheetGrid(frameCount: number): { rows: number; columns: number } {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 25)
    throw new Error('contact sheet frame count must be between 1 and 25')
  let best: { rows: number; columns: number; score: number; unused: number } | undefined
  for (let rows = 1; rows <= 5; rows++) {
    for (let columns = 1; columns <= 5; columns++) {
      const cells = rows * columns
      if (cells < frameCount) continue
      const unused = cells - frameCount
      // 空格有轻微惩罚，避免 5 帧为了正方形变成 3×3，同时优先接近正方形。
      const score = Math.abs(Math.log(columns / rows)) + unused * 0.22
      if (
        !best ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 &&
          (unused < best.unused || (unused === best.unused && columns > best.columns)))
      )
        best = { rows, columns, score, unused }
    }
  }
  return { rows: best!.rows, columns: best!.columns }
}

/** 将完整帧中的 crop 等比放入 tile，避免 contact sheet 改变源画面宽高比。 */
export function drawViewCanvasContained(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  crop: ReturnType<typeof visualCrop>,
): void {
  const targetWidth = context.canvas.width,
    targetHeight = context.canvas.height
  const scale = Math.min(targetWidth / crop.width, targetHeight / crop.height)
  const width = crop.width * scale,
    height = crop.height * scale
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    (targetWidth - width) / 2,
    (targetHeight - height) / 2,
    width,
    height,
  )
}

/** 创建逐帧写入的 contact sheet；每帧写入后即可释放其解码资源。 */
export function createViewContactSheet(
  frames: readonly Pick<ViewContactSheetFrame, 'timecode'>[],
  region: AgentViewRegion | undefined,
  signal: AbortSignal,
  check: () => void,
  sourceSize: { width: number; height: number },
): {
  drawFrame: (index: number, frame: ViewContactSheetFrame) => void
  encode: () => Promise<ViewContactSheetResult>
  dispose: () => void
} {
  const { rows, columns } = viewContactSheetGrid(frames.length)
  const gap = 4
  const maxCellWidth = Math.max(
    1,
    Math.floor((AGENT_MAX_IMAGE_EDGE - gap * (columns - 1)) / columns),
  )
  const maxCellHeight = Math.max(1, Math.floor((AGENT_MAX_IMAGE_EDGE - gap * (rows - 1)) / rows))
  const sourceAspectRatio = sourceSize.width / sourceSize.height
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0)
    throw viewError('frame_unavailable', '素材画面尺寸不可用。')
  const preliminaryLabelHeight = Math.min(48, Math.max(24, Math.round(maxCellWidth * 0.08)))
  const cellWidth = Math.max(
    1,
    Math.min(
      maxCellWidth,
      Math.floor((maxCellHeight - preliminaryLabelHeight) * sourceAspectRatio),
    ),
  )
  const labelHeight = Math.min(48, Math.max(24, Math.round(cellWidth * 0.08)))
  const frameHeight = Math.max(
    1,
    Math.min(Math.round(cellWidth / sourceAspectRatio), maxCellHeight - labelHeight),
  )
  const canvas = document.createElement('canvas')
  const tile = document.createElement('canvas')
  canvas.width = columns * cellWidth + (columns - 1) * gap
  canvas.height = rows * (frameHeight + labelHeight) + (rows - 1) * gap
  tile.width = cellWidth
  tile.height = frameHeight
  const context = canvas.getContext('2d'),
    tileContext = tile.getContext('2d')
  if (!context || !tileContext) throw viewError('frame_unavailable', '无法创建观察画布。')
  context.fillStyle = '#202124'
  context.fillRect(0, 0, canvas.width, canvas.height)
  let nextIndex = 0,
    closed = false

  const drawFrame = (index: number, frame: ViewContactSheetFrame) => {
    check()
    if (closed || index !== nextIndex || index >= frames.length)
      throw viewError('context_expired', '观察画布已失效。')
    const crop = visualCrop(frame.width, frame.height, region)
    tileContext.clearRect(0, 0, tile.width, tile.height)
    tileContext.fillStyle = '#202124'
    tileContext.fillRect(0, 0, tile.width, tile.height)
    frame.draw(tileContext, crop)
    check()
    const column = index % columns,
      row = Math.floor(index / columns),
      x = column * (cellWidth + gap),
      y = row * (frameHeight + labelHeight + gap)
    context.drawImage(tile, x, y)
    context.fillStyle = '#202124'
    context.fillRect(x, y + frameHeight, cellWidth, labelHeight)
    context.fillStyle = '#ffffff'
    context.font = `${Math.min(24, Math.max(12, Math.round(labelHeight * 0.45)))}px monospace`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(frame.timecode, x + cellWidth / 2, y + frameHeight + labelHeight / 2)
    nextIndex += 1
  }

  return {
    drawFrame,
    async encode() {
      check()
      if (nextIndex !== frames.length)
        throw viewError('frame_unavailable', 'contact sheet 尚未完成所有帧。')
      try {
        const result = await encodeAgentVisual(canvas, canvas.width, canvas.height, signal)
        check()
        return {
          blob: result.blob,
          width: result.conversionParams.width,
          height: result.conversionParams.height,
          rows,
          columns,
        }
      } finally {
        canvas.width = canvas.height = 0
      }
    },
    dispose() {
      if (closed) return
      closed = true
      canvas.width = canvas.height = 0
      tile.width = tile.height = 0
    },
  }
}

/** 为 timeRange 结果生成模型可直接理解的范围、间隔和网格说明。 */
export function describeViewContactSheet(
  item: ViewOptions,
  timecodes: readonly string[],
  requested: number,
  grid: Pick<ViewContactSheetResult, 'rows' | 'columns'>,
): string | undefined {
  if (!item.timeRange) return undefined
  const frameValues = timecodes.map(parseAgentToolTimecode),
    step =
      frameValues.length > 1
        ? Math.max(
            1,
            Math.round(
              (frameValues[frameValues.length - 1]! - frameValues[0]!) / (frameValues.length - 1),
            ),
          )
        : 0
  const dedupe = frameValues.length < requested ? `，去重后实际绘制 ${frameValues.length} 帧` : ''
  return `时间范围 [${item.timeRange.start}, ${item.timeRange.end})，请求 ${requested} 帧${dedupe}，采样间隔约 ${framesToTimecode(step)}，网格 ${grid.columns}×${grid.rows}；时间码位于每个画面下方，空白格没有时间码。`
}

/** 先校验完整参数和输出图片预算，避免解码开始后才发现目标总数超限。 */
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
  if (items.length > AGENT_MAX_IMAGE_COUNT)
    throw viewError(
      'visual_budget_exceeded',
      `每次调用最多输出 ${AGENT_MAX_IMAGE_COUNT} 张图片，请减少目标数量。`,
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
  const durationDescription = framesToTimecode(Math.max(0, Math.ceil(duration)))
  if (item.at !== undefined) {
    const at = parse(item.at)
    if (at >= duration)
      throw viewError(
        'time_out_of_range',
        `at 必须位于来源有效范围内；来源有效时长为 ${durationDescription}。`,
      )
    return [at]
  }
  if (!item.timeRange)
    throw viewError('invalid_arguments', '视频和时间轴必须指定 at 或 timeRange。')
  const start = parse(item.timeRange.start),
    end = parse(item.timeRange.end)
  if (start >= end || end > duration)
    throw viewError(
      'time_out_of_range',
      `timeRange 必须满足 0 <= start < end <= duration；来源有效时长为 ${durationDescription}。`,
    )
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
  read: (item: T) => Promise<ViewReadResult>
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
        observations.push(...result.images)
        if (result.note) notes.push(`items[${index}] ${batch.identify(item)}：${result.note}`)
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
