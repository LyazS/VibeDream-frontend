import { textToImageBitmap2 } from '@/core/bunnyUtils/ToBitmap'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { TextStyleConfig } from '@/core/timelineitem/texttype'

export interface RebuildTextRuntimeOptions {
  text?: string
  stylePatch?: Partial<TextStyleConfig>
}

export async function rebuildTextRuntime(
  item: UnifiedTimelineItemData<'text'>,
  options: RebuildTextRuntimeOptions = {},
): Promise<void> {
  const nextText = options.text ?? item.baseRenderConfig.text.text
  const nextStyle: TextStyleConfig = {
    ...item.baseRenderConfig.text.style,
    ...(options.stylePatch ?? {}),
  }

  const oldConfigHeight = item.baseRenderConfig.visual.height
  const oldConfigWidth = item.baseRenderConfig.visual.width
  const oldBitmapHeight = item.runtime.textBitmap?.height ?? oldConfigHeight
  const oldBitmapWidth = item.runtime.textBitmap?.width ?? oldConfigWidth

  const bitmapHeightRatio = oldBitmapHeight > 0 ? oldConfigHeight / oldBitmapHeight : 1
  const bitmapWidthRatio = oldBitmapWidth > 0 ? oldConfigWidth / oldBitmapWidth : 1

  const newTextBitmap = await textToImageBitmap2(nextText, nextStyle)

  item.baseRenderConfig.text.text = nextText
  item.baseRenderConfig.text.style = nextStyle
  item.baseRenderConfig.visual.height = newTextBitmap.height * bitmapHeightRatio
  item.baseRenderConfig.visual.width = newTextBitmap.width * bitmapWidthRatio

  item.runtime.textBitmap?.close()
  item.runtime.textBitmap = newTextBitmap
  item.runtime.textBitmapVersion = (item.runtime.textBitmapVersion ?? 0) + 1
}
