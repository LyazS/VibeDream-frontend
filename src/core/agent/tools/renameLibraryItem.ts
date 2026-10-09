import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  getLatestHistoryDescription,
  getLibraryItemSnapshot,
  requireNonEmptyString,
  resolveLibraryItem,
} from './libraryEditShared'

export async function executeRenameLibraryItem(args: Record<string, unknown>) {
  try {
    const item = resolveLibraryItem(args.item)
    const newName = requireNonEmptyString(args.newName, 'newName')
    if (item.snapshot.name === newName) {
      throw new LibraryToolError('no_change', '新名称与当前名称相同。')
    }

    const store = useUnifiedStore()
    if (item.snapshot.type === 'directory') {
      await store.renameDirectoryWithHistory(item.displayItem.id, newName)
    } else {
      await store.renameAssetWithHistory(item.displayItem.id, newName)
    }

    const after = getLibraryItemSnapshot(item.displayItem)
    if (!after) {
      throw new Error('重命名后无法读取结果。')
    }

    return buildToolSuccess('rename_library_item', {
      before: item.snapshot,
      after,
      historyDescription: getLatestHistoryDescription(),
    })
  } catch (error) {
    return buildLibraryToolFailure('rename_library_item', error)
  }
}

export const renameLibraryItemTool: ToolDefinition = {
  name: 'rename_library_item',
  execute: executeRenameLibraryItem,
} as ToolDefinition
