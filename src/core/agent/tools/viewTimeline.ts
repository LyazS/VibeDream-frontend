import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types'
import {
  createViewContactSheet,
  describeViewContactSheet,
  describeViewRegion,
  drawViewCanvasContained,
  parseViewTimelineItems,
  runViewTool,
  viewSampleFrames,
  type ViewReadResult,
  type ViewOptions,
} from './viewShared'

/** 同一次调用中的所有画面共享一个固定的离屏合成快照。 */
export function executeViewTimeline(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = useUnifiedStore()
  return runViewTool<ViewOptions>(
    'view_timeline',
    context,
    () => store.projectId,
    (view) => {
      const items = parseViewTimelineItems(args)
      const duration = store.totalDurationFrames
      // 在首次异步读取前固定工程快照，同次调用的所有目标复用该会话。
      const capture = store.createTimelineFrameCaptureSession({
        signal: view.signal,
        prepareMedia: store.ensureMediaReady,
      })
      return {
        items,
        identify: () => '当前工程时间轴',
        async read(item): Promise<ViewReadResult> {
          const frames = viewSampleFrames(item, duration)
          if (!item.timeRange) {
            view.check()
            const frame = frames[0]!
            const canvas = await capture.renderToCanvas(frame)
            view.check()
            return {
              images: [
                await view.encode(
                  canvas,
                  canvas.width,
                  canvas.height,
                  item,
                  `当前工程时间轴，at=${framesToTimecode(frame)}`,
                ),
              ],
            }
          }

          const timecodes = frames.map(framesToTimecode)
          let sheet: ReturnType<typeof createViewContactSheet> | undefined
          try {
            for (const [index, frame] of frames.entries()) {
              view.check()
              // capture 的画布可能在下一帧复用；drawFrame 会在这里立即拷贝到总画布。
              const canvas = await capture.renderToCanvas(frame)
              view.check()
              sheet ??= createViewContactSheet(
                timecodes.map((timecode) => ({ timecode })),
                item.region,
                view.signal,
                view.check,
                { width: canvas.width, height: canvas.height },
              )
              sheet.drawFrame(index, {
                timecode: timecodes[index]!,
                width: canvas.width,
                height: canvas.height,
                draw: (ctx, crop) => drawViewCanvasContained(ctx, canvas, crop),
              })
            }
            const result = await sheet!.encode()
            const note = describeViewContactSheet(item, timecodes, frames.length, result)
            return {
              images: [
                {
                  blob: result.blob,
                  width: result.width,
                  height: result.height,
                  description: `当前工程时间轴 contact sheet，${note ?? ''}${describeViewRegion(item.region)}。`,
                },
              ],
              note,
            }
          } finally {
            sheet?.dispose()
          }
        },
        dispose: () => capture.dispose(),
      }
    },
  )
}

export const viewTimelineTool: ToolDefinition = {
  name: 'view_timeline',
  execute: executeViewTimeline,
}
