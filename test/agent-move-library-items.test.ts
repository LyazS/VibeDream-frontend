import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeMoveLibraryItems } from '../src/core/agent/tools/moveLibraryItems'
import { executeListMedia } from '../src/core/agent/tools/listMedia'
import { createUnifiedDirectoryModule } from '../src/core/modules/UnifiedDirectoryModule'
import { createUnifiedHistoryModule } from '../src/core/modules/UnifiedHistoryModule'
import { createUnifiedMediaModule } from '../src/core/modules/UnifiedMediaModule'
import { MoveLibraryItemsCommand } from '../src/core/modules/commands/LibraryCommands'
import { ModuleRegistry, MODULE_NAMES } from '../src/core/modules/ModuleRegistry'
import { createUnifiedMediaItemData } from '../src/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '../src/core/datasource/providers/user-selected/UserSelectedFileSource'
import { createTransitionTemplateAssetData } from '../src/core/asset/types'
import type { DisplayItem } from '../src/core/directory/types'

const mocks = vi.hoisted(() => ({
  save: vi.fn<
    (asset: { id: string; name: string; parentDirectoryId: string }) => Promise<boolean>
  >(),
}))
vi.mock('../src/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: { saveMetaFile: mocks.save },
}))
vi.mock('../src/core/composables/useI18n', () => ({
  useAppI18n: () => ({ t: (key: string) => key }),
}))
// Use real directory, media and history modules; isolate unrelated processing dependencies.
vi.mock('../src/core', async () => ({
  createUnifiedMediaItemData: (await import('../src/core/mediaitem/types'))
    .createUnifiedMediaItemData,
  MediaItemQueries: {},
  UnifiedMediaItemActions: {},
}))
vi.mock('../src/core/datasource/registry', () => ({ getDataSourceRegistry: vi.fn() }))
vi.mock('../src/core/effect-template/EffectTemplateManager', () => ({
  EffectTemplateManager: class {},
}))
vi.mock('../src/core/utils/unifiedKeyframeUtils', () => ({ clearChannelKeyframes: vi.fn() }))
vi.mock('../src/core/timelineitem/queries', () => ({ TimelineItemQueries: {} }))
vi.mock('../src/core/unifiedStore', () => ({ useUnifiedStore: () => store }))
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (_name: string, args: Record<string, unknown>) => executeMoveLibraryItems(args),
}))

let directories: ReturnType<typeof createUnifiedDirectoryModule>
let media: ReturnType<typeof createUnifiedMediaModule>
let history: ReturnType<typeof createUnifiedHistoryModule>
let store: ReturnType<typeof createTestStore>
let rootId: string
let parentId: string
let targetId: string
let folderId: string
const mediaId = 'media_take01.mp4'

function createTestStore() {
  return {
    get directories() {
      return directories.directories.value
    },
    getDirectory: directories.getDirectory,
    getAsset: media.getAsset,
    getAllAssets: media.getAllAssets,
    getAssetIdsInDirectory: directories.getAssetIdsInDirectory,
    moveLibraryItemsWithHistory: vi.fn(async (items: DisplayItem[], target: string) => {
      await history.executeCommand(new MoveLibraryItemsCommand(items, target, directories))
    }),
  }
}

function folder(name: string, parent: string | null = parentId) {
  const result = directories.createDirectory(name, parent)
  if (!result.success) throw new Error(result.error)
  return result.directory
}

function addMedia(id = mediaId, name = '镜头01.mp4', parent = parentId) {
  const source = UserSelectedFileSourceFactory.createFromBaseData({ type: 'user-selected' })
  media.mediaItems.value.push(
    createUnifiedMediaItemData(id, name, source, { parentDirectoryId: parent, mediaType: 'video' }),
  )
  expect(directories.registerAssetLocation(id).success).toBe(true)
  return media.getMediaItem(id)!
}

function item(itemId = folderId) {
  const directory = directories.getDirectory(itemId)
  const asset = media.getMediaItem(itemId)
  return {
    itemId,
    match: {
      name: (directory ?? asset)!.name,
      parentDirId: directory ? directory.parentId : asset!.parentDirectoryId,
    },
  }
}

function request(ids = [folderId, mediaId], targetDirId = targetId) {
  return { items: ids.map(item), targetDirId }
}

async function move(args: Record<string, unknown> = request()) {
  const result = await createToolRuntime().execute(
    { id: 'move1', name: 'move_library_items', args },
    {
      toolCallId: 'move1',
      userId: 'u1',
      projectId: 'p1',
      sessionId: 's1',
      modelCallId: 't1',
      signal: new AbortController().signal,
      isCurrent: () => true,
    },
  )
  return { result, output: JSON.parse(result.output) }
}

function expectNoMutation() {
  expect(store.moveLibraryItemsWithHistory).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(history.getHistorySummary().totalCommands).toBe(0)
}

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(true)
  const registry = new ModuleRegistry()
  registry.register(MODULE_NAMES.USENAIVEUI, {
    messageError: vi.fn(),
    messageWarning: vi.fn(),
    messageSuccess: vi.fn(),
  })
  media = createUnifiedMediaModule(registry)
  registry.register(MODULE_NAMES.MEDIA, media)
  directories = createUnifiedDirectoryModule(registry)
  history = createUnifiedHistoryModule(registry)
  store = createTestStore()
  rootId = folder('素材库', null).id
  parentId = folder('视频', rootId).id
  targetId = folder('精选', rootId).id
  folderId = folder('镜头').id
  addMedia()
})

describe('move_library_items ID contract', () => {
  it('moves listed mixed items in input order with one history entry and stable IDs', async () => {
    const rootMedia = addMedia('root_media', '配乐.wav', rootId)
    const listing = JSON.parse((await executeListMedia({ dirId: parentId })).output)
    const args = {
      items: listing.entries.map((entry: { dirId?: string; mediaId?: string; name: string }) => ({
        itemId: entry.dirId ?? entry.mediaId,
        match: { name: entry.name, parentDirId: listing.dirId },
      })),
      targetDirId: targetId,
    }
    args.items.push(item(rootMedia.id))
    const { result, output } = await move(args)
    expect(result.success).toBe(true)
    expect(output).toEqual({
      tool: 'move_library_items',
      before: args.items.map((entry: { match: { parentDirId: string } }) => ({
        parentDirId: entry.match.parentDirId,
      })),
      after: args.items.map(() => ({ parentDirId: targetId })),
    })
    expect(history.getHistorySummary().totalCommands).toBe(1)
    expect(directories.getAssetIdsInDirectory(targetId)).toEqual([mediaId, rootMedia.id])
    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
    expect(rootMedia.parentDirectoryId).toBe(rootId)
    expect(directories.getAssetIdsInDirectory(parentId)).toEqual([mediaId])
    expect(await history.redo()).toBe(true)
    expect(directories.getDirectory(folderId)!.parentId).toBe(targetId)
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(targetId)
    expect(rootMedia.parentDirectoryId).toBe(targetId)
    expect(history.getHistorySummary().totalCommands).toBe(1)
  })

  it.each([false, true])(
    'restores original sibling order regardless of input order: %s',
    async (reverse) => {
      const second = folder('第二').id
      const third = folder('第三').id
      folder('第四')
      const original = [...directories.getDirectory(parentId)!.childDirIds]
      const ids = reverse ? [third, folderId] : [folderId, third]
      expect((await move(request(ids))).result.success).toBe(true)
      expect(await history.undo()).toBe(true)
      expect(directories.getDirectory(parentId)!.childDirIds).toEqual(original)
      expect(directories.getDirectory(second)!.parentId).toBe(parentId)
      expect(await history.redo()).toBe(true)
      expect(await history.undo()).toBe(true)
      expect(directories.getDirectory(parentId)!.childDirIds).toEqual(original)
    },
  )

  it.each([
    {},
    { items: [], targetDirId: 'dir_target' },
    {
      items: [
        { type: 'directory', path: '/视频/镜头/', match: { name: '镜头', parentPath: '/视频/' } },
      ],
      targetPath: '/精选/',
    },
    {
      items: [{ type: 'media', mediaId, match: { name: '镜头01.mp4', parentPath: '/视频/' } }],
      targetDirId: 'dir_target',
    },
    { items: ['{}'], targetDirId: 'dir_target' },
    { items: [{ itemId: 'dir_x', match: '{}' }], targetDirId: 'dir_target' },
    {
      items: [{ itemId: '', match: { name: '镜头', parentDirId: 'dir_parent' } }],
      targetDirId: 'dir_target',
    },
    { items: [{ itemId: 'dir_x', match: { name: '镜头' } }], targetDirId: 'dir_target' },
    {
      items: [{ itemId: 'dir_x', match: { name: '镜头', parentDirId: null } }],
      targetDirId: 'dir_target',
    },
    {
      items: [{ itemId: 'dir_x', match: { name: '镜头', parentDirId: '' } }],
      targetDirId: 'dir_target',
    },
    {
      items: [{ itemId: 'dir_x', match: { name: '', parentDirId: 'dir_parent' } }],
      targetDirId: 'dir_target',
    },
    {
      items: [
        { itemId: 'dir_x', match: { name: '镜头', parentDirId: 'dir_parent', parentPath: '/' } },
      ],
      targetDirId: 'dir_target',
    },
  ])('rejects legacy or malformed schema: %j', async (args) => {
    await expect(move(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expectNoMutation()
  })

  it.each(['type', 'dirId', 'mediaId', 'path'])('rejects extra item field %s', async (field) => {
    const args = request()
    Object.assign(args.items[0]!, { [field]: 'extra' })
    await expect(move(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expectNoMutation()
  })

  it('rejects targetPath even alongside a valid targetDirId', async () => {
    await expect(move({ ...request(), targetPath: '/精选/' })).rejects.toThrow(
      'TOOL_ARGUMENTS_INVALID',
    )
    expectNoMutation()
  })

  it.each(['   ', 'dir_missing', '/精选/'])(
    'never falls back for invalid target ID %j',
    async (targetDirId) => {
      expect((await move({ ...request(), targetDirId })).output.code).toBe(
        targetDirId.trim() ? 'directory_not_found' : 'invalid_arguments',
      )
      expectNoMutation()
    },
  )

  it.each(['   ', 'dir_missing', '/视频/镜头/'])(
    'rejects invalid item ID %j before any mutation',
    async (itemId) => {
      const args = request()
      args.items[1]!.itemId = itemId
      expect((await move(args)).output.code).toBe(
        itemId.trim() ? 'item_not_found' : 'invalid_arguments',
      )
      expectNoMutation()
    },
  )

  it('preserves raw IDs instead of trimming or completing them', async () => {
    expect((await move({ ...request(), targetDirId: ` ${targetId} ` })).output.code).toBe(
      'directory_not_found',
    )
    const args = request()
    args.items[0]!.itemId = ` ${folderId} `
    expect((await move(args)).output.code).toBe('item_not_found')
    expectNoMutation()
  })

  it.each(['name', 'parentDirId'])(
    'returns minimal current state when match.%s differs',
    async (field) => {
      const args = request()
      args.items[1]!.match[field as 'name' | 'parentDirId'] = field === 'name' ? '旧名' : rootId
      const { output } = await move(args)
      expect(output.code).toBe('state_mismatch')
      expect(output.details).toEqual({
        current: { itemId: mediaId, name: '镜头01.mp4', parentDirId: parentId },
      })
      expectNoMutation()
    },
  )

  it.each(['name', 'parentDirId'])('does not trim match.%s', async (field) => {
    const args = request()
    const match = args.items[0]!.match
    match[field as 'name' | 'parentDirId'] = ` ${match[field as 'name' | 'parentDirId']} `
    expect((await move(args)).output.code).toBe('state_mismatch')
    expectNoMutation()
  })

  it('rejects blank expected parent IDs', async () => {
    const args = request()
    args.items[0]!.match.parentDirId = '   '
    expect((await move(args)).output.code).toBe('invalid_arguments')
    expectNoMutation()
  })

  it('protects the root before match validation', async () => {
    expect(
      (
        await move({
          items: [{ itemId: rootId, match: { name: '旧名', parentDirId: 'missing' } }],
          targetDirId: targetId,
        })
      ).output.code,
    ).toBe('root_directory_protected')
    expectNoMutation()
  })

  it('rejects ambiguous IDs and unsupported template assets', async () => {
    addMedia(folderId)
    expect((await move(request([folderId]))).output.code).toBe('ambiguous_item_id')
    const template = createTransitionTemplateAssetData('template', '转场', null)
    media.effectTemplateAssets.value.push(template)
    expect(
      (
        await move({
          items: [{ itemId: template.id, match: { name: template.name, parentDirId: parentId } }],
          targetDirId: targetId,
        })
      ).output.code,
    ).toBe('unsupported_item_kind')
    expectNoMutation()
  })

  it('uses records rather than ID prefixes to route folder and media moves', async () => {
    const directory = directories.getDirectory(folderId)!
    directories.directories.value.delete(folderId)
    directory.id = 'opaque-folder'
    directories.directories.value.set(directory.id, directory)
    directories.getDirectory(parentId)!.childDirIds[0] = directory.id
    addMedia('dir_actually_media')
    expect((await move(request([directory.id, 'dir_actually_media']))).result.success).toBe(true)
  })

  it('allows ancestor and target renames and moves after reading', async () => {
    const args = request()
    const container = folder('容器', rootId).id
    directories.renameDirectory(parentId, '改名视频')
    directories.moveDirectoryToParent(parentId, container)
    directories.renameDirectory(targetId, '改名精选')
    directories.moveDirectoryToParent(targetId, container)
    expect((await move(args)).result.success).toBe(true)
  })

  it.each(['directory', 'media'])('rejects a %s moved since reading', async (kind) => {
    const args = request()
    if (kind === 'directory') directories.moveDirectoryToParent(folderId, rootId)
    else await directories.moveAssetToDirectory(mediaId, rootId)
    mocks.save.mockClear()
    expect((await move(args)).output.code).toBe('state_mismatch')
    expectNoMutation()
  })

  it.each(['directory', 'media'])('rejects duplicate %s references', async (kind) => {
    const id = kind === 'directory' ? folderId : mediaId
    expect((await move(request([id, id]))).output.code).toBe('duplicate_item')
    expectNoMutation()
  })

  it.each(['directory', 'media'])('rejects moving a %s to its current parent', async (kind) => {
    expect(
      (await move(request([kind === 'directory' ? folderId : mediaId], parentId))).output.code,
    ).toBe('invalid_move')
    expectNoMutation()
  })

  it.each(['self', 'descendant'])('rejects moving to %s', async (kind) => {
    const target = kind === 'self' ? folderId : folder('子目录', folderId).id
    expect((await move(request([folderId], target))).output.code).toBe('invalid_move')
    expectNoMutation()
  })

  it.each(['folder', 'nested-media'])(
    'rejects a selected folder and its contained %s',
    async (kind) => {
      const child = folder('子目录', folderId).id
      const id = kind === 'folder' ? child : addMedia('nested', '内部.mp4', child).id
      expect((await move(request([id, folderId]))).output.code).toBe('invalid_move')
      expectNoMutation()
    },
  )

  it('preflights a conflict on the last folder without moving earlier items', async () => {
    const second = folder('第二').id
    folder('第二', targetId)
    expect((await move(request([folderId, mediaId, second]))).output.code).toBe('duplicate_name')
    expectNoMutation()
  })

  it('rejects identical folder names in a batch from different source directories', async () => {
    const second = folder('镜头', rootId).id
    expect((await move(request([folderId, second]))).output.code).toBe('duplicate_name')
    expectNoMutation()
  })

  it('allows duplicate media names, folder/media collisions and case-distinct folder names', async () => {
    media.getMediaItem(mediaId)!.name = '镜头'
    addMedia('media_second', '镜头')
    folder('镜头', targetId)
    const upper = folder('Shots').id
    folder('shots', targetId)
    expect((await move(request([mediaId, 'media_second', upper]))).result.success).toBe(true)
  })

  it.each(['source-cycle', 'source-missing', 'target-cycle', 'target-missing', 'source-index'])(
    'rejects damaged structure %s',
    async (kind) => {
      const args = request()
      if (kind === 'source-cycle') directories.getDirectory(parentId)!.parentId = folderId
      if (kind === 'source-missing') directories.getDirectory(parentId)!.parentId = 'missing'
      if (kind === 'target-cycle') directories.getDirectory(targetId)!.parentId = targetId
      if (kind === 'target-missing') directories.getDirectory(targetId)!.parentId = 'missing'
      if (kind === 'source-index') directories.getDirectory(parentId)!.childDirIds = []
      expect((await move(args)).output.code).toBe('invalid_directory_structure')
      expectNoMutation()
    },
  )

  it('rejects an invalid direct media location', async () => {
    const args = request()
    media.getMediaItem(mediaId)!.parentDirectoryId = 'missing'
    expect((await move(args)).output.code).toBe('invalid_location')
    expectNoMutation()
  })

  it('preflights an unregistered media index before moving any folders', async () => {
    media.mediaItems.value.push(
      createUnifiedMediaItemData(
        'unregistered',
        '未登记.mp4',
        UserSelectedFileSourceFactory.createFromBaseData({ type: 'user-selected' }),
        { parentDirectoryId: parentId, mediaType: 'video' },
      ),
    )
    expect((await move(request([folderId, 'unregistered']))).output.code).toBe('invalid_location')
    expectNoMutation()
  })

  it('enforces folder name uniqueness for the shared UI move operation', () => {
    folder('镜头', targetId)
    expect(directories.moveDirectoryToParent(folderId, targetId)).toMatchObject({
      success: false,
      code: 'duplicate_name',
    })
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
  })
})

describe('move_library_items persistence and concurrency', () => {
  it.each(['false', 'reject'])(
    'restores original metadata, indexes and folder order after a save %s',
    async (failure) => {
      const second = folder('第二').id
      folder('第三')
      const original = [...directories.getDirectory(parentId)!.childDirIds]
      if (failure === 'false') mocks.save.mockResolvedValueOnce(false)
      else mocks.save.mockRejectedValueOnce(new Error('disk error'))
      const { result, output } = await move(request([second, folderId, mediaId]))
      expect(result.success).toBe(false)
      expect(output.code).toBe('persistence_failed')
      expect(directories.getDirectory(parentId)!.childDirIds).toEqual(original)
      expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
      expect(directories.getAssetIdsInDirectory(parentId)).toEqual([mediaId])
      expect(directories.getAssetIdsInDirectory(targetId)).toEqual([])
      expect(mocks.save).toHaveBeenCalledTimes(2)
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it('restores earlier media after a later media save fails', async () => {
    addMedia('second')
    const writes: Array<{ id: string; parentDirectoryId: string }> = []
    mocks.save.mockImplementation(async (asset) => {
      writes.push({ id: asset.id, parentDirectoryId: asset.parentDirectoryId })
      return writes.length !== 2
    })
    expect((await move(request([folderId, mediaId, 'second']))).output.code).toBe(
      'persistence_failed',
    )
    expect(writes).toEqual([
      { id: mediaId, parentDirectoryId: targetId },
      { id: 'second', parentDirectoryId: targetId },
      { id: 'second', parentDirectoryId: parentId },
      { id: mediaId, parentDirectoryId: parentId },
    ])
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(new Set(directories.getAssetIdsInDirectory(parentId))).toEqual(
      new Set([mediaId, 'second']),
    )
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('reports failed recovery writes explicitly', async () => {
    mocks.save.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    expect((await move()).output.code).toBe('rollback_failed')
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('reports a failed rollback of earlier media and keeps its index consistent', async () => {
    addMedia('second')
    mocks.save
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    expect((await move(request([folderId, mediaId, 'second']))).output.code).toBe('rollback_failed')
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(targetId)
    expect(directories.getAssetIdsInDirectory(targetId)).toEqual([mediaId])
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it.each(['rename', 'move', 'delete'])(
    'rechecks later media after an awaited save: %s',
    async (change) => {
      const second = addMedia('second')
      mocks.save.mockImplementationOnce(async () => {
        if (change === 'rename') second.name = '用户改名'
        if (change === 'move') await directories.moveAssetToDirectory(second.id, rootId)
        if (change === 'delete')
          media.mediaItems.value.splice(media.mediaItems.value.indexOf(second), 1)
        return true
      })
      expect((await move(request([folderId, mediaId, second.id]))).output.code).toBe(
        'state_mismatch',
      )
      expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
      expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
      if (change === 'rename')
        expect(second).toMatchObject({ name: '用户改名', parentDirectoryId: parentId })
      if (change === 'move') expect(second.parentDirectoryId).toBe(rootId)
      if (change === 'delete') expect(media.getMediaItem(second.id)).toBeUndefined()
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it('preserves a concurrent rename of the media being saved and restores its position', async () => {
    mocks.save.mockImplementationOnce(async () => {
      media.getMediaItem(mediaId)!.name = '用户改名'
      return true
    })
    expect((await move()).output.code).toBe('state_mismatch')
    expect(media.getMediaItem(mediaId)).toMatchObject({
      name: '用户改名',
      parentDirectoryId: parentId,
    })
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('does not overwrite a concurrent move of the media being saved', async () => {
    mocks.save.mockImplementationOnce(async () => {
      media.getMediaItem(mediaId)!.parentDirectoryId = rootId
      return false
    })
    expect((await move()).output.code).toBe('rollback_failed')
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(rootId)
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('does not recreate media deleted during a save', async () => {
    mocks.save.mockImplementationOnce(async () => {
      media.mediaItems.value.splice(0, 1)
      return true
    })
    expect((await move()).output.code).toBe('rollback_failed')
    expect(media.getMediaItem(mediaId)).toBeUndefined()
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('restores media when the target is deleted during persistence', async () => {
    mocks.save.mockImplementationOnce(async () => {
      directories.directories.value.delete(targetId)
      return true
    })
    expect((await move(request([mediaId]))).output.code).toBe('state_mismatch')
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
    expect(directories.getAssetIdsInDirectory(parentId)).toEqual([mediaId])
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('rechecks moved folders after awaited media saves and restores the mixed batch', async () => {
    mocks.save.mockImplementationOnce(async () => {
      directories.renameDirectory(folderId, '用户改名')
      return true
    })
    expect((await move()).output.code).toBe('state_mismatch')
    expect(directories.getDirectory(folderId)).toMatchObject({ name: '用户改名', parentId })
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('preserves a concurrent folder move and rolls back the media', async () => {
    mocks.save.mockImplementationOnce(async () => {
      directories.moveDirectoryToParent(folderId, rootId)
      return true
    })
    expect((await move()).output.code).toBe('rollback_failed')
    expect(directories.getDirectory(folderId)!.parentId).toBe(rootId)
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('reports directory rollback conflicts while continuing to restore other directories', async () => {
    const second = folder('第二').id
    mocks.save.mockImplementationOnce(async () => {
      folder('镜头')
      return false
    })
    expect((await move(request([folderId, second, mediaId]))).output.code).toBe('rollback_failed')
    expect(directories.getDirectory(folderId)!.parentId).toBe(targetId)
    expect(directories.getDirectory(second)!.parentId).toBe(parentId)
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(parentId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('compensates a partial undo when a source folder name is occupied', async () => {
    const second = folder('第二').id
    expect((await move(request([folderId, second, mediaId]))).result.success).toBe(true)
    folder('第二')
    expect(await history.undo()).toBe(false)
    expect(directories.getDirectory(folderId)!.parentId).toBe(targetId)
    expect(directories.getDirectory(second)!.parentId).toBe(targetId)
    expect(media.getMediaItem(mediaId)!.parentDirectoryId).toBe(targetId)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })
})
