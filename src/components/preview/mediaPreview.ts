/** 文件 URL 由预览组件释放；传入的 ImageBitmap 归调用方所有，预览不能关闭它。 */
export type MediaPreviewSource =
  | { type: 'image' | 'video' | 'audio'; blob: Blob; name: string }
  | { type: 'image'; bitmap: ImageBitmap; name: string }
