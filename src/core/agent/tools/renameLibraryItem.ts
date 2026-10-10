import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  assertLibraryItemNameMatch,
  resolveLibraryItemById,
} from './libraryEditShared'

export async function executeRenameLibraryItem(args: Record<string, unknown>) {
  try {
    const item = resolveLibraryItemById(args.itemId)
    assertLibraryItemNameMatch(item.state, args.match)
    if (typeof args.newName !== 'string') {
      throw new LibraryToolError('invalid_arguments', 'newName 必须是字符串。')
    }
    const newName = args.newName.trim()
    if (!newName) {
      throw new LibraryToolError('invalid_name', '新名称不能为空。')
    }
    if (item.state.name === newName) {
      throw new LibraryToolError('no_change', '新名称与当前名称相同。')
    }

    const store = useUnifiedStore()
    if (item.displayItem.type === 'directory') {
      await store.renameDirectoryWithHistory(item.displayItem.id, newName)
    } else {
      await store.renameAssetWithHistory(item.displayItem.id, newName)
    }

    const after = resolveLibraryItemById(item.displayItem.id).state

    return buildToolSuccess('rename_library_item', {
      before: { name: item.state.name },
      after: { name: after.name },
    })
  } catch (error) {
    return buildLibraryToolFailure('rename_library_item', error)
  }
}

export const renameLibraryItemTool: ToolDefinition = {
  name: 'rename_library_item',
  execute: executeRenameLibraryItem,
} as ToolDefinition
