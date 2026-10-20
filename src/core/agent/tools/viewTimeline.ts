import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition, ToolExecutionContext, ToolImageInput, ToolResult } from './types'
import {
  parseViewTimelineItems,
  runViewTool,
  viewSampleFrames,
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
        async read(item) {
          const results: ToolImageInput[] = []
          for (const frame of viewSampleFrames(item, duration)) {
            view.check()
            const canvas = await capture.renderToCanvas(frame)
            view.check()
            // 离屏画布会在下一帧复用，必须先把当前画面编码成独立 Blob。
            results.push(
              await view.encode(
                canvas,
                canvas.width,
                canvas.height,
                item,
                `当前工程时间轴，at=${framesToTimecode(frame)}`,
              ),
            )
          }
          return results
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
