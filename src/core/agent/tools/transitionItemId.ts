/** Stable Agent-facing identity for a transition owned by its left clip. */
export function buildTransitionItemId(leftClipId: string, templateId: string): string {
  return `transition:${encodeURIComponent(leftClipId)}:${encodeURIComponent(templateId)}`
}

export function parseTransitionItemId(itemId: string): { leftClipId: string; templateId: string } | null {
  if (!itemId.startsWith('transition:')) {
    return null
  }

  const encoded = itemId.slice('transition:'.length)
  const separatorIndex = encoded.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === encoded.length - 1 || encoded.indexOf(':', separatorIndex + 1) !== -1) {
    return null
  }

  try {
    return {
      leftClipId: decodeURIComponent(encoded.slice(0, separatorIndex)),
      templateId: decodeURIComponent(encoded.slice(separatorIndex + 1)),
    }
  } catch {
    return null
  }
}
