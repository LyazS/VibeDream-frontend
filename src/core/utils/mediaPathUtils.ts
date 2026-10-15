export interface MediaFileReference {
  readonly id: string
  /** Lowercase extension including the dot; empty for extensionless files. */
  readonly ext: string
}

export function isMediaExtension(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^\.[a-z0-9]+$/.test(value))
}

export function extractExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 && dotIndex < fileName.length - 1
    ? fileName.slice(dotIndex).toLowerCase()
    : ''
}

export function getMediaFileName({ id, ext }: MediaFileReference): string {
  if (!isMediaExtension(ext)) {
    console.error('[MediaIdentity] invalid-extension', { id, ext })
    throw new Error('Invalid media extension')
  }
  return `${id}${ext}`
}

export function getMediaPath(media: MediaFileReference): string {
  return `media/${getMediaFileName(media)}`
}
