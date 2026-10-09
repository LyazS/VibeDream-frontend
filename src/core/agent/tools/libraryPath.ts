import { useUnifiedStore } from '@/core/unifiedStore'
import type { VirtualDirectory } from '@/core/directory/types'

export interface ResolvedDirectoryPath {
  dirId: string
  canonicalPath: string
}

function getDirectories(): Map<string, VirtualDirectory> {
  return useUnifiedStore().directories || new Map<string, VirtualDirectory>()
}

export function normalizeDirectoryPath(inputPath: string): string | null {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    return null
  }

  const normalizedSlashes = trimmed.replace(/\/+/g, '/')
  if (!normalizedSlashes.startsWith('/')) {
    return null
  }

  if (normalizedSlashes === '/') {
    return '/'
  }

  return normalizedSlashes.endsWith('/') ? normalizedSlashes : `${normalizedSlashes}/`
}

export function buildCanonicalDirectoryPath(dirId: string): string | null {
  const directories = getDirectories()
  const pathParts: string[] = []
  const visited = new Set<string>()
  let currentId: string | null = dirId

  while (currentId !== null) {
    if (visited.has(currentId)) {
      return null
    }
    visited.add(currentId)

    const directory = directories.get(currentId)
    if (!directory) {
      return null
    }

    if (directory.parentId !== null) {
      pathParts.unshift(directory.name)
    }
    currentId = directory.parentId
  }

  return pathParts.length === 0 ? '/' : `/${pathParts.join('/')}/`
}

export function resolveDirectoryPath(inputPath: string): ResolvedDirectoryPath | null {
  const normalizedPath = normalizeDirectoryPath(inputPath)
  if (!normalizedPath) {
    return null
  }

  const directories = getDirectories()
  const rootDirectory = Array.from(directories.values()).find((directory) => directory.parentId === null)
  if (!rootDirectory) {
    return null
  }

  if (normalizedPath === '/') {
    return { dirId: rootDirectory.id, canonicalPath: '/' }
  }

  const pathSegments = normalizedPath
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
  let currentDirectory = rootDirectory

  for (const segment of pathSegments) {
    const childDirectory = currentDirectory.childDirIds
      .map((childId) => directories.get(childId))
      .find((directory): directory is VirtualDirectory => directory?.name === segment)

    if (!childDirectory) {
      return null
    }
    currentDirectory = childDirectory
  }

  return {
    dirId: currentDirectory.id,
    canonicalPath: buildCanonicalDirectoryPath(currentDirectory.id) || normalizedPath,
  }
}

export function explainDirectoryPathResolutionFailure(inputPath: string): {
  failedSegment: string | null
  resolvedParentPath: string
} {
  const normalizedPath = normalizeDirectoryPath(inputPath)
  if (!normalizedPath || normalizedPath === '/') {
    return { failedSegment: null, resolvedParentPath: '/' }
  }

  const directories = getDirectories()
  const rootDirectory = Array.from(directories.values()).find((directory) => directory.parentId === null)
  if (!rootDirectory) {
    return { failedSegment: null, resolvedParentPath: '/' }
  }

  const pathSegments = normalizedPath
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
  let currentDirectory = rootDirectory

  for (const segment of pathSegments) {
    const childDirectory = currentDirectory.childDirIds
      .map((childId) => directories.get(childId))
      .find((directory): directory is VirtualDirectory => directory?.name === segment)

    if (!childDirectory) {
      return {
        failedSegment: segment,
        resolvedParentPath: buildCanonicalDirectoryPath(currentDirectory.id) || '/',
      }
    }
    currentDirectory = childDirectory
  }

  return {
    failedSegment: null,
    resolvedParentPath: buildCanonicalDirectoryPath(currentDirectory.id) || '/',
  }
}

export function getDirectoryParentPath(directory: VirtualDirectory): string | null {
  return directory.parentId ? buildCanonicalDirectoryPath(directory.parentId) : null
}
