import { useUnifiedStore } from '@/core/unifiedStore'
import type { DisplayItem, VirtualDirectory } from '@/core/directory/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { isMediaAsset } from '@/core/asset/types'
import type { ToolResult } from './types'
import { buildToolError, buildToolException } from './utils/result'
import {
  buildCanonicalDirectoryPath,
  getDirectoryParentPath,
  normalizeDirectoryPath,
  resolveDirectoryPath,
} from './libraryPath'

type LibraryItemType = 'directory' | 'media'

interface LibraryItemMatch {
  name: string
  parentPath: string
}

export interface LibraryItemSnapshot {
  type: LibraryItemType
  id: string
  name: string
  path?: string
  mediaId?: string
  parentPath: string | null
}

export interface ResolvedLibraryItem {
  displayItem: DisplayItem
  snapshot: LibraryItemSnapshot
}

export interface LibraryItemState {
  itemId: string
  name: string
  parentDirId: string
}

export function getDirectoryAncestorIds(dirId: string): Set<string> {
  const store = useUnifiedStore()
  const ids = new Set<string>()
  let currentId: string | null = dirId
  while (currentId !== null) {
    const directory = store.getDirectory(currentId)
    if (!directory || ids.has(currentId)) {
      throw new LibraryToolError('invalid_directory_structure', '目录的父目录链存在循环或缺失。')
    }
    ids.add(currentId)
    currentId = directory.parentId
  }
  return ids
}

export class LibraryToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function resolveLibraryItemById(itemIdValue: unknown): {
  displayItem: DisplayItem
  state: LibraryItemState
} {
  if (typeof itemIdValue !== 'string' || !itemIdValue.trim()) {
    throw new LibraryToolError('invalid_arguments', 'itemId 必须是非空字符串。')
  }

  const store = useUnifiedStore()
  const directory = store.getDirectory(itemIdValue)
  const asset = store.getAsset(itemIdValue)
  if (directory && asset) {
    throw new LibraryToolError('ambiguous_item_id', 'ID 同时对应文件夹和素材：' + itemIdValue)
  }
  const item = directory ?? asset
  if (!item) {
    throw new LibraryToolError('item_not_found', '未找到项目：' + itemIdValue)
  }
  if (asset && !isMediaAsset(asset)) {
    throw new LibraryToolError('unsupported_item_kind', '不支持操作此类素材：' + itemIdValue)
  }
  if (directory?.parentId === null) {
    throw new LibraryToolError('root_directory_protected', '不能操作根目录。')
  }

  const parentDirId = directory
    ? directory.parentId
    : isMediaAsset(asset)
      ? asset.parentDirectoryId
      : null
  if (typeof parentDirId !== 'string' || !parentDirId.trim() || !store.getDirectory(parentDirId)) {
    throw new LibraryToolError('invalid_location', '项目没有有效的直接父目录：' + itemIdValue)
  }
  getDirectoryAncestorIds(parentDirId)

  return {
    displayItem: { id: itemIdValue, type: directory ? 'directory' : 'asset' },
    state: {
      itemId: itemIdValue,
      name: item.name,
      parentDirId,
    },
  }
}

export function assertLibraryItemNameMatch(
  state: Pick<LibraryItemState, 'name'>,
  value: unknown,
): void {
  const match = getRecord(value, 'match')
  if (typeof match.name !== 'string' || match.name.length === 0) {
    throw new LibraryToolError('invalid_arguments', 'match.name 必须是非空字符串。')
  }
  if (state.name !== match.name) {
    throw new LibraryToolError('state_mismatch', '项目当前状态与预期不一致。', {
      current: { name: state.name },
    })
  }
}

export function assertLibraryItemMatch(state: LibraryItemState, value: unknown): void {
  const match = getRecord(value, 'match')
  if (
    typeof match.name !== 'string' ||
    match.name.length === 0 ||
    typeof match.parentDirId !== 'string' ||
    !match.parentDirId.trim()
  ) {
    throw new LibraryToolError('invalid_arguments', 'match 必须包含非空 name 和 parentDirId。')
  }
  if (state.name !== match.name || state.parentDirId !== match.parentDirId) {
    throw new LibraryToolError('state_mismatch', '项目当前状态与预期不一致。', {
      current: { ...state },
    })
  }
}

function getRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LibraryToolError('invalid_arguments', fieldName + ' 必须是对象。')
  }
  return value as Record<string, unknown>
}

export function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new LibraryToolError('invalid_arguments', fieldName + ' 必须是非空字符串。')
  }
  return value.trim()
}

function readMatch(value: unknown): LibraryItemMatch {
  const record = getRecord(value, 'match')
  const parentPath = requireNonEmptyString(record.parentPath, 'match.parentPath')
  const normalizedParentPath = normalizeDirectoryPath(parentPath)
  if (!normalizedParentPath) {
    throw new LibraryToolError('invalid_arguments', 'match.parentPath 必须是以 / 开头的目录路径。')
  }

  return {
    name: requireNonEmptyString(record.name, 'match.name'),
    parentPath: normalizedParentPath,
  }
}

export function resolveDirectoryByPath(pathValue: unknown): {
  directory: VirtualDirectory
  path: string
} {
  const inputPath = requireNonEmptyString(pathValue, 'path')
  const normalizedPath = normalizeDirectoryPath(inputPath)
  if (!normalizedPath) {
    throw new LibraryToolError('invalid_arguments', '路径必须是以 / 开头的目录路径。')
  }

  const resolved = resolveDirectoryPath(normalizedPath)
  if (!resolved) {
    throw new LibraryToolError('directory_not_found', '未找到目录：' + normalizedPath)
  }

  const directory = useUnifiedStore().getDirectory(resolved.dirId)
  if (!directory) {
    throw new LibraryToolError(
      'directory_not_found',
      '目录在读取时已不存在：' + resolved.canonicalPath,
    )
  }

  return { directory, path: resolved.canonicalPath }
}

function assertDirectoryMatch(
  directory: VirtualDirectory,
  expected: LibraryItemMatch,
  currentPath: string,
): void {
  const parentPath = getDirectoryParentPath(directory)
  if (directory.name !== expected.name || parentPath !== expected.parentPath) {
    throw new LibraryToolError('state_mismatch', '文件夹当前状态与预期不一致：' + currentPath)
  }
}

function assertMediaMatch(
  media: UnifiedMediaItemData,
  expected: LibraryItemMatch,
  currentParentPath: string,
): void {
  if (media.name !== expected.name || currentParentPath !== expected.parentPath) {
    throw new LibraryToolError('state_mismatch', '素材当前状态与预期不一致：' + media.id)
  }
}

function snapshotDirectory(directory: VirtualDirectory, path?: string): LibraryItemSnapshot {
  return {
    type: 'directory',
    id: directory.id,
    name: directory.name,
    path: path || buildCanonicalDirectoryPath(directory.id) || undefined,
    parentPath: getDirectoryParentPath(directory),
  }
}

function snapshotMedia(media: UnifiedMediaItemData, parentPath: string): LibraryItemSnapshot {
  return {
    type: 'media',
    id: media.id,
    mediaId: media.id,
    name: media.name,
    parentPath,
  }
}

export function resolveLibraryItem(value: unknown): ResolvedLibraryItem {
  const record = getRecord(value, 'item')
  const itemType = record.type
  const expected = readMatch(record.match)

  if (itemType === 'directory') {
    const resolved = resolveDirectoryByPath(record.path)
    if (resolved.directory.parentId === null) {
      throw new LibraryToolError('root_directory_protected', '不能操作根目录。')
    }
    assertDirectoryMatch(resolved.directory, expected, resolved.path)
    return {
      displayItem: { id: resolved.directory.id, type: 'directory' },
      snapshot: snapshotDirectory(resolved.directory, resolved.path),
    }
  }

  if (itemType === 'media') {
    const mediaId = requireNonEmptyString(record.mediaId, 'item.mediaId')
    const store = useUnifiedStore()
    const media = store.getMediaItem(mediaId)
    if (!media) {
      throw new LibraryToolError('media_not_found', '未找到素材：' + mediaId)
    }

    const parentDirectoryId = store.getAssetDirectoryId(mediaId)
    const parentPath = parentDirectoryId ? buildCanonicalDirectoryPath(parentDirectoryId) : null
    if (!parentPath) {
      throw new LibraryToolError('state_mismatch', '素材没有有效的所属目录：' + mediaId)
    }

    assertMediaMatch(media, expected, parentPath)
    return {
      displayItem: { id: media.id, type: 'asset' },
      snapshot: snapshotMedia(media, parentPath),
    }
  }

  throw new LibraryToolError('invalid_arguments', 'item.type 必须是 directory 或 media。')
}

export function getLibraryItemSnapshot(item: DisplayItem): LibraryItemSnapshot | null {
  const store = useUnifiedStore()

  if (item.type === 'directory') {
    const directory = store.getDirectory(item.id)
    return directory ? snapshotDirectory(directory) : null
  }

  const media = store.getMediaItem(item.id)
  const parentDirectoryId = store.getAssetDirectoryId(item.id)
  const parentPath = parentDirectoryId ? buildCanonicalDirectoryPath(parentDirectoryId) : null
  return media && parentPath ? snapshotMedia(media, parentPath) : null
}

export function getLatestHistoryDescription(): string | null {
  const commands = useUnifiedStore().getHistorySummary().commands
  const latest = commands[commands.length - 1]
  return latest?.description || null
}

export function buildLibraryToolFailure(tool: string, error: unknown): ToolResult {
  if (error instanceof LibraryToolError) {
    return buildToolError(tool, error.code, error.message, error.details)
  }

  return buildToolException(tool, error)
}
