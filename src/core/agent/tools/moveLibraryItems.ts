import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  assertLibraryItemMatch,
  getDirectoryAncestorIds,
  resolveLibraryItemById,
} from './libraryEditShared'

function assertMovableItems(
  items: ReturnType<typeof resolveLibraryItemById>[],
  targetDirId: string,
): void {
  const store = useUnifiedStore()
  const targetAncestors = getDirectoryAncestorIds(targetDirId)
  const seenItemIds = new Set<string>()
  const selectedDirectoryIds = new Set(
    items.filter((item) => item.displayItem.type === 'directory').map((item) => item.state.itemId),
  )
  const occupiedNames = new Set(
    Array.from(store.directories.values())
      .filter((directory) => directory.parentId === targetDirId)
      .map((directory) => directory.name),
  )

  for (const item of items) {
    if (seenItemIds.has(item.displayItem.id)) {
      throw new LibraryToolError('duplicate_item', '移动项目中存在重复项。')
    }
    seenItemIds.add(item.displayItem.id)

    if (item.state.parentDirId === targetDirId) {
      throw new LibraryToolError('invalid_move', '不能移动到当前父文件夹。')
    }

    if (
      [...getDirectoryAncestorIds(item.state.parentDirId)].some((id) =>
        selectedDirectoryIds.has(id),
      )
    ) {
      throw new LibraryToolError('invalid_move', '不能同时移动文件夹及其内部项目。')
    }
    if (item.displayItem.type === 'directory') {
      if (targetAncestors.has(item.state.itemId)) {
        throw new LibraryToolError('invalid_move', '不能将文件夹移动到自身或后代目录。')
      }
      if (!store.getDirectory(item.state.parentDirId)?.childDirIds.includes(item.state.itemId)) {
        throw new LibraryToolError('invalid_directory_structure', '来源文件夹目录结构不完整。')
      }
      if (occupiedNames.has(item.state.name)) {
        throw new LibraryToolError('duplicate_name', '目标目录或批次中存在同名文件夹。')
      }
      occupiedNames.add(item.state.name)
    } else if (!store.getAssetIdsInDirectory(item.state.parentDirId).includes(item.state.itemId)) {
      throw new LibraryToolError('invalid_location', '来源素材的目录索引无效。')
    }
  }
}

export async function executeMoveLibraryItems(args: Record<string, unknown>) {
  try {
    if (!Array.isArray(args.items) || args.items.length === 0) {
      throw new LibraryToolError('invalid_arguments', 'items 必须是非空数组。')
    }

    const targetDirId = args.targetDirId
    if (typeof targetDirId !== 'string' || !targetDirId.trim()) {
      throw new LibraryToolError('invalid_arguments', 'targetDirId 必须是非空字符串。')
    }
    const store = useUnifiedStore()
    if (!store.getDirectory(targetDirId)) {
      throw new LibraryToolError('directory_not_found', '未找到目标目录：' + targetDirId)
    }
    const items = args.items.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new LibraryToolError('invalid_arguments', 'items 中的每个项目必须是对象。')
      }
      const record = value as Record<string, unknown>
      const item = resolveLibraryItemById(record.itemId)
      assertLibraryItemMatch(item.state, record.match)
      return item
    })
    assertMovableItems(items, targetDirId)

    await store.moveLibraryItemsWithHistory(
      items.map((item) => item.displayItem),
      targetDirId,
    )

    return buildToolSuccess('move_library_items', {
      before: items.map((item) => ({ parentDirId: item.state.parentDirId })),
      after: items.map((item) => ({
        parentDirId: resolveLibraryItemById(item.state.itemId).state.parentDirId,
      })),
    })
  } catch (error) {
    return buildLibraryToolFailure('move_library_items', error)
  }
}

export const moveLibraryItemsTool: ToolDefinition = {
  name: 'move_library_items',
  execute: executeMoveLibraryItems,
} as ToolDefinition
