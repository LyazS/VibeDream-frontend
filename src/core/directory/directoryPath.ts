import type { VirtualDirectory } from './types'

export function buildCanonicalDirectoryPath(
  dirId: string,
  directories: ReadonlyMap<string, VirtualDirectory>,
): string | null {
  const pathParts: string[] = []
  const visited = new Set<string>()
  let currentId: string | null = dirId

  while (currentId !== null) {
    if (visited.has(currentId)) return null
    visited.add(currentId)

    const directory = directories.get(currentId)
    if (!directory) return null
    if (directory.parentId !== null) pathParts.unshift(directory.name)
    currentId = directory.parentId
  }

  return pathParts.length === 0 ? '/' : `/${pathParts.join('/')}/`
}
