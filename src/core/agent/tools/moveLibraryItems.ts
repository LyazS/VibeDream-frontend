import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  getLatestHistoryDescription,
  getLibraryItemSnapshot,
  resolveDirectoryByPath,
  resolveLibraryItem,
  type ResolvedLibraryItem,
} from './libraryEditShared'

function assertMovableItems(items: ResolvedLibraryItem[], targetDirectoryId: string, targetPath: string): void {
  const store = useUnifiedStore()
  const seenItemIds = new Set<string>()
  const directoryPaths: string[] = []

  for (const item of items) {
    if (seenItemIds.has(item.displayItem.id)) {
      throw new LibraryToolError('duplicate_item', '移动项目中存在重复项。')
    }
    seenItemIds.add(item.displayItem.id)

    if (item.snapshot.parentPath === targetPath) {
      throw new LibraryToolError('invalid_move', '不能移动到当前父文件夹。')
    }

    if (item.snapshot.type === 'directory') {
      if (!store.canDragToFolder(item.displayItem.id, targetDirectoryId)) {
        throw new LibraryToolError('invalid_move', '不能将文件夹移动到目标位置。')
      }
      if (item.snapshot.path) {
        directoryPaths.push(item.snapshot.path)
      }
    }
  }

  for (const path of directoryPaths) {
    if (directoryPaths.some((candidate) => candidate !== path && path.startsWith(candidate))) {
      throw new LibraryToolError('invalid_move', '不能同时移动存在父子关系的文件夹。')
    }
  }
}

export async function executeMoveLibraryItems(args: Record<string, unknown>) {
  try {
    if (!Array.isArray(args.items) || args.items.length === 0) {
      throw new LibraryToolError('invalid_arguments', 'items 必须是非空数组。')
    }

    const target = resolveDirectoryByPath(args.targetPath)
    const items = args.items.map((item: unknown) => resolveLibraryItem(item))
    assertMovableItems(items, target.directory.id, target.path)

    const store = useUnifiedStore()
    await store.moveLibraryItemsWithHistory(
      items.map((item) => item.displayItem),
      target.directory.id,
    )

    const after = items.map((item) => getLibraryItemSnapshot(item.displayItem))
    if (after.some((item) => item === null)) {
      throw new Error('移动后无法读取全部项目。')
    }

    return buildToolSuccess('move_library_items', {
      before: items.map((item) => item.snapshot),
      after,
      targetPath: target.path,
      historyDescription: getLatestHistoryDescription(),
    })
  } catch (error) {
    return buildLibraryToolFailure('move_library_items', error)
  }
}

export const moveLibraryItemsTool: ToolDefinition = {
  name: 'move_library_items',
  execute: executeMoveLibraryItems,
} as ToolDefinition
