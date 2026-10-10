import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeRenameLibraryItem } from '../src/core/agent/tools/renameLibraryItem'
import { executeListMedia } from '../src/core/agent/tools/listMedia'
import { createUnifiedDirectoryModule } from '../src/core/modules/UnifiedDirectoryModule'
import { createUnifiedHistoryModule } from '../src/core/modules/UnifiedHistoryModule'
import { createUnifiedMediaModule } from '../src/core/modules/UnifiedMediaModule'
import {
  RenameDirectoryCommand,
  RenameAssetCommand,
} from '../src/core/modules/commands/LibraryCommands'
import { ModuleRegistry, MODULE_NAMES } from '../src/core/modules/ModuleRegistry'
import { createUnifiedMediaItemData } from '../src/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '../src/core/datasource/providers/user-selected/UserSelectedFileSource'
import { createTransitionTemplateAssetData } from '../src/core/asset/types'

const mocks = vi.hoisted(() => ({ save: vi.fn<(asset: { name: string }) => Promise<boolean>>() }))
vi.mock('../src/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: { saveMetaFile: mocks.save },
}))
vi.mock('../src/core/composables/useI18n', () => ({
  useAppI18n: () => ({ t: (key: string) => key }),
}))
// Isolate unrelated media processing and timeline dependencies; use real rename and history logic.
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
  executeTool: (_name: string, args: Record<string, unknown>) => executeRenameLibraryItem(args),
}))

let directories: ReturnType<typeof createUnifiedDirectoryModule>
let history: ReturnType<typeof createUnifiedHistoryModule>
let media: ReturnType<typeof createUnifiedMediaModule>
let store: ReturnType<typeof createTestStore>
let rootId: string
let parentId: string
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
    getHistorySummary: history.getHistorySummary,
    renameDirectoryWithHistory: vi.fn(async (id: string, name: string) => {
      await history.executeCommand(new RenameDirectoryCommand(id, name, directories))
    }),
    renameAssetWithHistory: vi.fn(async (id: string, name: string) => {
      await history.executeCommand(new RenameAssetCommand(id, name, media))
    }),
  }
}

function folder(name: string, parent: string | null) {
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

function request(itemId = folderId, name = '镜头', newName = '精选镜头') {
  return { itemId, match: { name }, newName }
}

async function rename(args: Record<string, unknown> = request()) {
  const result = await createToolRuntime().execute(
    { id: 'rename1', name: 'rename_library_item', args },
    {
      toolCallId: 'rename1',
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

function expectNoHistory() {
  expect(history.getHistorySummary().totalCommands).toBe(0)
  expect(store.renameDirectoryWithHistory).not.toHaveBeenCalled()
  expect(store.renameAssetWithHistory).not.toHaveBeenCalled()
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
  folderId = folder('镜头', parentId).id
  addMedia()
})

describe('rename_library_item ID contract', () => {
  it('renames a listed directory and returns only before/after state with one undo entry', async () => {
    const listing = JSON.parse((await executeListMedia({ dirId: parentId })).output)
    const entry = listing.entries.find((item: { dirId?: string }) => item.dirId === folderId)
    const { result, output } = await rename(request(entry.dirId, entry.name, ' 精选镜头 '))
    expect(result.success).toBe(true)
    expect(output).toEqual({
      tool: 'rename_library_item',
      before: { name: '镜头' },
      after: { name: '精选镜头' },
    })
    expect(store.renameDirectoryWithHistory).toHaveBeenCalledWith(folderId, '精选镜头')
    expect(store.renameAssetWithHistory).not.toHaveBeenCalled()
    expect(history.getHistorySummary().totalCommands).toBe(1)
    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(folderId)!.name).toBe('镜头')
    expect(await history.redo()).toBe(true)
    expect(directories.getDirectory(folderId)).toMatchObject({
      id: folderId,
      parentId,
      name: '精选镜头',
    })
  })

  it('routes the identical argument shape to the media history command and preserves media ID', async () => {
    const { result, output } = await rename(request(mediaId, '镜头01.mp4', ' 开场.mp4 '))
    expect(result.success).toBe(true)
    expect(output.before).toEqual({ name: '镜头01.mp4' })
    expect(output.after).toEqual({ name: '开场.mp4' })
    expect(store.renameAssetWithHistory).toHaveBeenCalledWith(mediaId, '开场.mp4')
    expect(store.renameDirectoryWithHistory).not.toHaveBeenCalled()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(await history.undo()).toBe(true)
    expect(media.getMediaItem(mediaId)!.name).toBe('镜头01.mp4')
    expect(await history.redo()).toBe(true)
    expect(media.getMediaItem(mediaId)).toMatchObject({
      id: mediaId,
      name: '开场.mp4',
      parentDirectoryId: parentId,
    })
    expect(history.getHistorySummary().totalCommands).toBe(1)
  })

  it.each([
    {},
    {
      item: {
        type: 'directory',
        path: '/视频/镜头/',
        match: { name: '镜头', parentPath: '/视频/' },
      },
      newName: '新名称',
    },
    {
      item: { type: 'media', mediaId, match: { name: '镜头01.mp4', parentPath: '/视频/' } },
      newName: '新名称',
    },
    { itemId: 'dir_x', match: { name: '镜头', parentPath: '/视频/' }, newName: '新名称' },
    { itemId: '', match: { name: '镜头' }, newName: '新名称' },
    { itemId: 'dir_x', match: '{}', newName: '新名称' },
    { itemId: 'dir_x', match: { name: '' }, newName: '新名称' },
    { itemId: 'dir_x', match: { name: '镜头', parentDirId: 'dir_parent' }, newName: '新名称' },
    { itemId: 'dir_x', match: { name: '镜头', parentDirId: null }, newName: '新名称' },
    { itemId: 'dir_x', match: { name: '镜头', parentDirId: '' }, newName: '新名称' },
    {
      itemId: 'dir_x',
      match: { name: '镜头', type: 'directory' },
      newName: '新名称',
    },
  ])('rejects legacy and malformed arguments via the real schema: %j', async (args) => {
    await expect(rename(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expectNoHistory()
  })

  it.each(['type', 'dirId', 'mediaId', 'path', 'item'])(
    'rejects the extra top-level field %s',
    async (field) => {
      await expect(rename({ ...request(), [field]: 'extra' })).rejects.toThrow(
        'TOOL_ARGUMENTS_INVALID',
      )
      expectNoHistory()
    },
  )

  it.each(['   ', '/视频/镜头/', '镜头', 'dir_missing'])(
    'rejects invalid or unknown item ID %j',
    async (itemId) => {
      expect((await rename({ ...request(), itemId })).output.code).toBe(
        itemId.trim() ? 'item_not_found' : 'invalid_arguments',
      )
      expectNoHistory()
    },
  )

  it('does not trim or complete IDs', async () => {
    for (const itemId of [` ${folderId} `, folderId.slice(0, -1), mediaId.slice(0, -4)]) {
      expect((await rename({ ...request(), itemId })).output.code).toBe('item_not_found')
    }
    expectNoHistory()
  })

  it.each(['directory', 'media'])(
    'returns only current state after %s name changes',
    async (kind) => {
      const isDirectory = kind === 'directory'
      if (isDirectory) directories.renameDirectory(folderId, '用户改名')
      else media.getMediaItem(mediaId)!.name = '用户改名'
      const itemId = isDirectory ? folderId : mediaId
      const { result, output } = await rename(request(itemId, isDirectory ? '镜头' : '镜头01.mp4'))
      expect(result.success).toBe(false)
      expect(output).toEqual({
        tool: 'rename_library_item',
        error: expect.any(String),
        code: 'state_mismatch',
        details: { current: { name: '用户改名' } },
      })
      expectNoHistory()
    },
  )

  it.each(['directory', 'media'])(
    'allows renaming the same %s after its direct parent changes',
    async (kind) => {
      const isDirectory = kind === 'directory'
      if (isDirectory) directories.moveDirectoryToParent(folderId, rootId)
      else media.getMediaItem(mediaId)!.parentDirectoryId = rootId
      const itemId = isDirectory ? folderId : mediaId
      const { result, output } = await rename(request(itemId, isDirectory ? '镜头' : '镜头01.mp4'))
      expect(result.success).toBe(true)
      expect(output.after).toEqual({ name: '精选镜头' })
      expect(
        isDirectory
          ? directories.getDirectory(itemId)!.parentId
          : media.getMediaItem(itemId)!.parentDirectoryId,
      ).toBe(rootId)
      expect(history.getHistorySummary().totalCommands).toBe(1)
    },
  )

  it('checks sibling name conflicts in the current parent after a move', async () => {
    folder('精选镜头', rootId)
    directories.moveDirectoryToParent(folderId, rootId)
    expect((await rename()).output.code).toBe('duplicate_name')
    expect(directories.getDirectory(folderId)!.name).toBe('镜头')
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('allows ancestor rename/move without changing the name match', async () => {
    const target = folder('目标', rootId)
    directories.renameDirectory(parentId, '新视频')
    directories.moveDirectoryToParent(parentId, target.id)
    expect((await rename()).result.success).toBe(true)
    expect((await rename(request(mediaId, '镜头01.mp4'))).result.success).toBe(true)
  })

  it('compares match.name verbatim while normalizing only newName', async () => {
    media.getMediaItem(mediaId)!.name = ' 镜头01.mp4 '
    expect((await rename(request(mediaId, '镜头01.mp4'))).output.code).toBe('state_mismatch')
    expectNoHistory()
    const { output } = await rename(request(mediaId, ' 镜头01.mp4 ', ' 开场.mp4 '))
    expect(output.before.name).toBe(' 镜头01.mp4 ')
    expect(output.after.name).toBe('开场.mp4')
  })

  it('protects the root before match validation', async () => {
    expect((await rename(request(rootId, '错误名称'))).output.code).toBe('root_directory_protected')
    expectNoHistory()
  })

  it('rejects unsupported effects and cross-kind ambiguous IDs', async () => {
    const effect = createTransitionTemplateAssetData('effect_x', '转场', null)
    media.effectTemplateAssets.value.push(effect)
    expect((await rename(request(effect.id, effect.name))).output.code).toBe(
      'unsupported_item_kind',
    )
    addMedia(folderId)
    expect((await rename()).output.code).toBe('ambiguous_item_id')
    expectNoHistory()
  })

  it('uses real records rather than ID prefixes to identify kinds', async () => {
    const original = directories.getDirectory(folderId)!
    const unusualDirId = 'media_is_a_directory'
    directories.directories.value.set(unusualDirId, { ...original, id: unusualDirId })
    const unusualMediaId = 'dir_is_a_media.mp4'
    addMedia(unusualMediaId)
    expect((await rename(request(unusualDirId))).result.success).toBe(true)
    expect((await rename(request(unusualMediaId, '镜头01.mp4'))).result.success).toBe(true)
    expect(store.renameDirectoryWithHistory).toHaveBeenCalledWith(unusualDirId, '精选镜头')
    expect(store.renameAssetWithHistory).toHaveBeenCalledWith(unusualMediaId, '精选镜头')
  })

  it.each(['directory', 'media'])('rejects missing direct-parent records for %s', async (kind) => {
    directories.directories.value.delete(parentId)
    expect(
      (await rename(kind === 'directory' ? request() : request(mediaId, '镜头01.mp4'))).output.code,
    ).toBe('invalid_location')
    expectNoHistory()
  })

  it.each(['cycle', 'broken'])('reports a %s ancestor chain', async (kind) => {
    directories.getDirectory(parentId)!.parentId = kind === 'cycle' ? folderId : 'dir_missing'
    expect((await rename()).output.code).toBe('invalid_directory_structure')
    expectNoHistory()
  })

  it('does not use a same-name replacement after the original ID is deleted', async () => {
    directories.removeEmptyDirectory(folderId)
    const replacement = folder('镜头', parentId)
    expect((await rename()).output.code).toBe('item_not_found')
    expect(replacement.name).toBe('镜头')
    expectNoHistory()
  })

  it('distinguishes historical same-name directories and allows duplicate media names', async () => {
    const other = folder('其他', parentId)
    directories.getDirectory(other.id)!.name = '镜头'
    expect((await rename(request(other.id))).result.success).toBe(true)
    expect(directories.getDirectory(folderId)!.name).toBe('镜头')
    const otherMedia = addMedia('media_other.mp4')
    expect((await rename(request(mediaId, '镜头01.mp4', '镜头'))).result.success).toBe(true)
    expect(otherMedia.name).toBe('镜头01.mp4')
    expect((await rename(request(mediaId, '镜头', otherMedia.name))).result.success).toBe(true)
  })

  it.each(['   ', '.', '..', 'a/b', 'a\\b', 'a\u0000b', 'a\nb', 'a\u007fb'])(
    'rejects illegal folder name %j without changing history',
    async (newName) => {
      expect((await rename({ ...request(), newName })).output.code).toBe('invalid_name')
      expect(directories.getDirectory(folderId)!.name).toBe('镜头')
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it('propagates sibling name conflicts and preserves the directory on failure', async () => {
    folder('已有', parentId)
    expect((await rename({ ...request(), newName: '已有' })).output.code).toBe('duplicate_name')
    expect(directories.getDirectory(folderId)!.name).toBe('镜头')
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('returns no_change without dispatching history commands', async () => {
    expect((await rename({ ...request(), newName: ' 镜头 ' })).output.code).toBe('no_change')
    expectNoHistory()
  })

  it.each(['false', 'rejection'])(
    'rolls back media memory and Meta after a %s write failure',
    async (failure) => {
      const savedNames: string[] = []
      mocks.save.mockImplementation(async (asset) => {
        savedNames.push(asset.name)
        if (savedNames.length > 1) return true
        if (failure === 'rejection') throw new Error('write failed')
        return false
      })
      const { result, output } = await rename(request(mediaId, '镜头01.mp4', '开场.mp4'))
      expect(result.success).toBe(false)
      expect(output.code).toBe('persistence_failed')
      expect(savedNames).toEqual(['开场.mp4', '镜头01.mp4'])
      expect(media.getMediaItem(mediaId)!.name).toBe('镜头01.mp4')
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it.each(['false', 'rejection'])(
    'reports rollback_failed if the recovery write returns %s',
    async (failure) => {
      mocks.save.mockResolvedValueOnce(false)
      if (failure === 'false') mocks.save.mockResolvedValueOnce(false)
      else mocks.save.mockRejectedValueOnce(new Error('rollback failed'))
      expect((await rename(request(mediaId, '镜头01.mp4'))).output.code).toBe('rollback_failed')
      expect(media.getMediaItem(mediaId)!.name).toBe('镜头01.mp4')
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it.each(['rename', 'delete'])(
    'does not overwrite a concurrent %s while recovering a failed write',
    async (change) => {
      mocks.save.mockImplementationOnce(async () => {
        if (change === 'rename') media.getMediaItem(mediaId)!.name = '用户的新名称'
        else media.mediaItems.value.splice(0, 1)
        return false
      })
      expect((await rename(request(mediaId, '镜头01.mp4'))).output.code).toBe('rollback_failed')
      expect(mocks.save).toHaveBeenCalledTimes(1)
      if (change === 'rename') expect(media.getMediaItem(mediaId)!.name).toBe('用户的新名称')
      else expect(media.getMediaItem(mediaId)).toBeUndefined()
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )
})
