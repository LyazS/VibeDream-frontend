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
  const nextText = options.text ?? item.config.text
  const nextStyle: TextStyleConfig = {
    ...item.config.style,
    ...(options.stylePatch ?? {}),
  }

  const oldConfigHeight = item.config.height
  const oldConfigWidth = item.config.width
  const oldBitmapHeight = item.runtime.textBitmap?.height ?? oldConfigHeight
  const oldBitmapWidth = item.runtime.textBitmap?.width ?? oldConfigWidth

  const bitmapHeightRatio = oldBitmapHeight > 0 ? oldConfigHeight / oldBitmapHeight : 1
  const bitmapWidthRatio = oldBitmapWidth > 0 ? oldConfigWidth / oldBitmapWidth : 1

  const newTextBitmap = await textToImageBitmap2(nextText, nextStyle)

  item.config.text = nextText
  item.config.style = nextStyle
  item.config.height = newTextBitmap.height * bitmapHeightRatio
  item.config.width = newTextBitmap.width * bitmapWidthRatio

  item.runtime.textBitmap?.close()
  item.runtime.textBitmap = newTextBitmap
  item.runtime.textBitmapVersion = (item.runtime.textBitmapVersion ?? 0) + 1
}
