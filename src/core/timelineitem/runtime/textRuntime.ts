import { textToImageBitmap2 } from '@/core/bunnyUtils/ToBitmap'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { TextStyleConfig } from '@/core/timelineitem/model/textStyle'
import { DEFAULT_TEXT_STYLE } from '@/core/timelineitem/model/textStyle'
import { TimelineItemMutations } from '@/core/timelineitem/mutations'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

export interface RebuildTextRuntimeOptions {
  text?: string
  stylePatch?: Partial<TextStyleConfig>
}

/**
 * 重建文本片段运行时资源。
 * 会同步更新文本内容、文本样式、视觉尺寸以及 bitmap 版本号。
 */
export async function rebuildTextRuntime(
  item: UnifiedTimelineItemData<'text'>,
  options: RebuildTextRuntimeOptions = {},
): Promise<void> {
  const visualConfig = TimelineItemQueries.getBaseVisualConfig(item)
  const textConfig = TimelineItemQueries.getBaseTextConfig(item)
  const nextText = options.text ?? textConfig?.text ?? ''
  const nextStyle: TextStyleConfig = {
    ...DEFAULT_TEXT_STYLE,
    ...(textConfig?.style ?? {}),
    ...(options.stylePatch ?? {}),
  }

  const oldConfigHeight = visualConfig?.height ?? 0
  const oldConfigWidth = visualConfig?.width ?? 0
  const oldBitmapHeight = item.runtime.textBitmap?.height ?? oldConfigHeight
  const oldBitmapWidth = item.runtime.textBitmap?.width ?? oldConfigWidth

  const bitmapHeightRatio = oldBitmapHeight > 0 ? oldConfigHeight / oldBitmapHeight : 1
  const bitmapWidthRatio = oldBitmapWidth > 0 ? oldConfigWidth / oldBitmapWidth : 1

  const newTextBitmap = await textToImageBitmap2(nextText, nextStyle)

  TimelineItemMutations.patchBaseTextConfig(item, {
    text: nextText,
    style: nextStyle,
  })
  TimelineItemMutations.patchBaseVisualConfig(item, {
    height: newTextBitmap.height * bitmapHeightRatio,
    width: newTextBitmap.width * bitmapWidthRatio,
  })

  item.runtime.textBitmap?.close()
  item.runtime.textBitmap = newTextBitmap
  item.runtime.textBitmapVersion = (item.runtime.textBitmapVersion ?? 0) + 1
}
