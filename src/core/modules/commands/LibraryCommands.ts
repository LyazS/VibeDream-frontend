import { generateCommandId } from '@/core/utils/idGenerator'
import type { DisplayItem, VirtualDirectory } from '@/core/directory/types'
import type { SimpleCommand } from './types'
import { HistoryPreconditionError } from './HistoryPreconditionError'
import { historyLabels, type HistoryLabel } from '@/core/modules/historyLabel'

type DirectoryMutationResult =
  | { success: true; directory: VirtualDirectory }
  | { success: false; error: string; code?: string }

interface DirectoryOperations {
  createDirectory(name: string, parentId: string | null): DirectoryMutationResult
  renameDirectory(id: string, name: string): DirectoryMutationResult
  getDirectory(id: string): VirtualDirectory | undefined
  getDirectoryChildIndex(parentId: string, childId: string): number
  isDirectoryEmpty(id: string): boolean
  removeEmptyDirectory(id: string): DirectoryMutationResult
  restoreDirectory(
    directory: VirtualDirectory,
    parentId: string,
    parentIndex: number,
  ): DirectoryMutationResult
  moveDirectoryToParent(
    folderId: string,
    targetFolderId: string,
    targetIndex?: number,
  ): { success: boolean; error?: string; code?: string }
  getAssetDirectoryId(assetId: string): string | null
  moveAssetsAtomically(
    moves: Array<{ assetId: string; targetDirectoryId: string }>,
  ): Promise<{ success: boolean; error?: string; code?: string }>
}

interface MediaOperations {
  getAsset(assetId: string): { id: string; name: string } | undefined
  renameAsset(
    assetId: string,
    name: string,
  ): Promise<{ success: boolean; error?: string; code?: string }>
}

function cloneDirectory(directory: VirtualDirectory): VirtualDirectory {
  return {
    ...directory,
    childDirIds: [...directory.childDirIds],
  }
}

function requireSuccess(
  result: { success: boolean; error?: string; code?: string },
  fallback: string,
): void {
  if (!result.success) {
    throw Object.assign(new HistoryPreconditionError(result.error || fallback), {
      toolCode: result.code === 'not_found' ? 'item_not_found' : result.code,
    })
  }
}

abstract class LibraryCommandBase implements SimpleCommand {
  public readonly id = generateCommandId()
  protected disposed = false

  constructor(public readonly historyLabel: HistoryLabel) {}

  abstract execute(): Promise<void>
  abstract undo(): Promise<void>

  get isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    this.disposed = true
  }
}

export class CreateDirectoryCommand extends LibraryCommandBase {
  private directory: VirtualDirectory | null = null

  constructor(
    private readonly name: string,
    private readonly parentId: string,
    private readonly directoryModule: DirectoryOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.createDirectory(name.trim()))
  }

  get createdDirectory(): VirtualDirectory | null {
    return this.directory ? cloneDirectory(this.directory) : null
  }

  async execute(): Promise<void> {
    if (this.directory) {
      const restored = this.directoryModule.restoreDirectory(
        this.directory,
        this.parentId,
        Number.MAX_SAFE_INTEGER,
      )
      requireSuccess(restored, '无法恢复创建的文件夹')
      return
    }

    const result = this.directoryModule.createDirectory(this.name, this.parentId)
    if (!result.success) {
      throw Object.assign(new HistoryPreconditionError(result.error || '无法创建文件夹'), {
        toolCode: result.code === 'not_found' ? 'directory_not_found' : result.code,
      })
    }
    this.directory = cloneDirectory(result.directory)
  }

  async undo(): Promise<void> {
    if (!this.directory) {
      throw new HistoryPreconditionError('创建文件夹的历史数据不存在')
    }

    const current = this.directoryModule.getDirectory(this.directory.id)
    if (
      !current ||
      current.parentId !== this.parentId ||
      current.name !== this.directory.name ||
      !this.directoryModule.isDirectoryEmpty(current.id)
    ) {
      throw new HistoryPreconditionError('文件夹已被修改或不再为空，无法撤销创建')
    }

    requireSuccess(this.directoryModule.removeEmptyDirectory(current.id), '无法撤销创建文件夹')
  }
}

export class RenameDirectoryCommand extends LibraryCommandBase {
  private oldName: string | null = null

  constructor(
    private readonly directoryId: string,
    private readonly newName: string,
    private readonly directoryModule: DirectoryOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.renameDirectory(newName.trim()))
  }

  async execute(): Promise<void> {
    const directory = this.directoryModule.getDirectory(this.directoryId)
    if (!directory) {
      throw new HistoryPreconditionError('文件夹不存在，无法重命名')
    }
    if (this.oldName === null) {
      this.oldName = directory.name
    } else if (directory.name !== this.oldName) {
      throw new HistoryPreconditionError('文件夹名称已被修改，无法重做')
    }

    requireSuccess(
      this.directoryModule.renameDirectory(this.directoryId, this.newName),
      '无法重命名文件夹',
    )
  }

  async undo(): Promise<void> {
    const directory = this.directoryModule.getDirectory(this.directoryId)
    if (!directory || this.oldName === null || directory.name !== this.newName.trim()) {
      throw new HistoryPreconditionError('文件夹已被修改或删除，无法撤销重命名')
    }

    requireSuccess(
      this.directoryModule.renameDirectory(this.directoryId, this.oldName),
      '无法撤销文件夹重命名',
    )
  }
}

export class MoveDirectoryCommand extends LibraryCommandBase {
  private sourceParentId: string | null = null
  private sourceIndex = -1

  constructor(
    private readonly directoryId: string,
    private readonly targetParentId: string,
    private readonly directoryModule: DirectoryOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.moveDirectory())
  }

  async execute(): Promise<void> {
    const directory = this.directoryModule.getDirectory(this.directoryId)
    if (!directory) {
      throw new HistoryPreconditionError('文件夹不存在，无法移动')
    }

    if (this.sourceParentId === null) {
      if (!directory.parentId) {
        throw new HistoryPreconditionError('不能移动根目录')
      }
      this.sourceParentId = directory.parentId
      this.sourceIndex = this.directoryModule.getDirectoryChildIndex(
        directory.parentId,
        directory.id,
      )
    } else if (directory.parentId !== this.sourceParentId) {
      throw new HistoryPreconditionError('文件夹位置已被修改，无法重做')
    }

    requireSuccess(
      this.directoryModule.moveDirectoryToParent(this.directoryId, this.targetParentId),
      '无法移动文件夹',
    )
  }

  async undo(): Promise<void> {
    const directory = this.directoryModule.getDirectory(this.directoryId)
    if (!directory || !this.sourceParentId || directory.parentId !== this.targetParentId) {
      throw new HistoryPreconditionError('文件夹位置已被修改或删除，无法撤销移动')
    }

    requireSuccess(
      this.directoryModule.moveDirectoryToParent(
        this.directoryId,
        this.sourceParentId,
        this.sourceIndex,
      ),
      '无法撤销文件夹移动',
    )
  }
}

export class DeleteEmptyDirectoryCommand extends LibraryCommandBase {
  private snapshot: VirtualDirectory | null = null
  private parentId: string | null = null
  private parentIndex = -1

  constructor(
    private readonly directoryId: string,
    private readonly directoryModule: DirectoryOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.deleteDirectory())
  }

  async execute(): Promise<void> {
    const directory = this.directoryModule.getDirectory(this.directoryId)
    if (!directory) {
      throw Object.assign(new HistoryPreconditionError('文件夹不存在，无法删除'), {
        toolCode: 'directory_not_found',
      })
    }
    if (directory.parentId === null) {
      throw Object.assign(new HistoryPreconditionError('不能删除根目录'), {
        toolCode: 'root_directory_protected',
      })
    }
    if (!this.directoryModule.isDirectoryEmpty(this.directoryId)) {
      throw Object.assign(new HistoryPreconditionError('文件夹不为空，无法删除'), {
        toolCode: 'directory_not_empty',
      })
    }

    if (this.snapshot === null) {
      this.snapshot = cloneDirectory(directory)
      this.parentId = directory.parentId
      this.parentIndex = this.directoryModule.getDirectoryChildIndex(
        directory.parentId,
        directory.id,
      )
    } else if (
      directory.parentId !== this.parentId ||
      directory.name !== this.snapshot.name ||
      directory.type !== this.snapshot.type
    ) {
      throw Object.assign(new HistoryPreconditionError('文件夹已被修改，无法重做删除'), {
        toolCode: 'state_mismatch',
      })
    }

    requireSuccess(this.directoryModule.removeEmptyDirectory(this.directoryId), '无法删除空文件夹')
  }

  async undo(): Promise<void> {
    if (!this.snapshot || !this.parentId) {
      throw new HistoryPreconditionError('删除文件夹的历史数据不存在')
    }

    requireSuccess(
      this.directoryModule.restoreDirectory(this.snapshot, this.parentId, this.parentIndex),
      '父文件夹已被修改或删除，无法撤销删除',
    )
  }
}

export class RenameAssetCommand extends LibraryCommandBase {
  private oldName: string | null = null

  constructor(
    private readonly assetId: string,
    private readonly newName: string,
    private readonly mediaModule: MediaOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.renameAsset(newName.trim()))
  }

  async execute(): Promise<void> {
    const asset = this.mediaModule.getAsset(this.assetId)
    if (!asset) {
      throw new HistoryPreconditionError('素材不存在，无法重命名')
    }
    if (this.oldName === null) {
      this.oldName = asset.name
    } else if (asset.name !== this.oldName) {
      throw new HistoryPreconditionError('素材名称已被修改，无法重做')
    }

    requireSuccess(await this.mediaModule.renameAsset(this.assetId, this.newName), '无法重命名素材')
  }

  async undo(): Promise<void> {
    const asset = this.mediaModule.getAsset(this.assetId)
    if (!asset || this.oldName === null || asset.name !== this.newName.trim()) {
      throw new HistoryPreconditionError('素材已被修改或删除，无法撤销重命名')
    }

    requireSuccess(
      await this.mediaModule.renameAsset(this.assetId, this.oldName),
      '无法撤销素材重命名',
    )
  }
}

type MoveDescriptor =
  | { type: 'directory'; id: string; name: string; sourceParentId: string; sourceIndex: number }
  | { type: 'asset'; id: string; sourceParentId: string }

export class MoveLibraryItemsCommand extends LibraryCommandBase {
  private descriptors: MoveDescriptor[] | null = null

  constructor(
    private readonly items: DisplayItem[],
    private readonly targetDirectoryId: string,
    private readonly directoryModule: DirectoryOperations,
    historyLabel?: HistoryLabel,
  ) {
    super(historyLabel ?? historyLabels.moveLibraryItems(items.length))
  }

  private captureDescriptors(): MoveDescriptor[] {
    if (this.items.length === 0) {
      throw new HistoryPreconditionError('没有可移动的项目')
    }

    const itemIds = new Set<string>()
    const descriptors: MoveDescriptor[] = []

    for (const item of this.items) {
      if (itemIds.has(item.id)) {
        throw new HistoryPreconditionError('移动项目中存在重复项')
      }
      itemIds.add(item.id)

      if (item.type === 'directory') {
        const directory = this.directoryModule.getDirectory(item.id)
        if (!directory || !directory.parentId) {
          throw new HistoryPreconditionError('文件夹不存在或不能移动根目录')
        }
        const sourceIndex = this.directoryModule.getDirectoryChildIndex(
          directory.parentId,
          directory.id,
        )
        if (sourceIndex < 0) {
          throw new HistoryPreconditionError('文件夹目录结构不完整')
        }
        descriptors.push({
          type: 'directory',
          id: directory.id,
          name: directory.name,
          sourceParentId: directory.parentId,
          sourceIndex,
        })
      } else {
        const sourceParentId = this.directoryModule.getAssetDirectoryId(item.id)
        if (!sourceParentId) {
          throw new HistoryPreconditionError('素材不存在或所属文件夹无效')
        }
        descriptors.push({ type: 'asset', id: item.id, sourceParentId })
      }
    }

    return descriptors
  }

  private assertAtSource(): void {
    for (const descriptor of this.descriptors || []) {
      if (descriptor.type === 'directory') {
        if (
          this.directoryModule.getDirectory(descriptor.id)?.parentId !== descriptor.sourceParentId
        ) {
          throw new HistoryPreconditionError('文件夹位置已被修改，无法重做')
        }
      } else if (
        this.directoryModule.getAssetDirectoryId(descriptor.id) !== descriptor.sourceParentId
      ) {
        throw new HistoryPreconditionError('素材位置已被修改或删除，无法重做')
      }
    }
  }

  private assertAtTarget(): void {
    for (const descriptor of this.descriptors || []) {
      if (descriptor.type === 'directory') {
        if (this.directoryModule.getDirectory(descriptor.id)?.parentId !== this.targetDirectoryId) {
          throw new HistoryPreconditionError('文件夹位置已被修改或删除，无法撤销移动')
        }
      } else if (
        this.directoryModule.getAssetDirectoryId(descriptor.id) !== this.targetDirectoryId
      ) {
        throw new HistoryPreconditionError('素材位置已被修改或删除，无法撤销移动')
      }
    }
  }

  private async moveAssets(
    targetFor: (descriptor: Extract<MoveDescriptor, { type: 'asset' }>) => string,
  ) {
    const assetMoves = (this.descriptors || [])
      .filter(
        (descriptor): descriptor is Extract<MoveDescriptor, { type: 'asset' }> =>
          descriptor.type === 'asset',
      )
      .map((descriptor) => ({ assetId: descriptor.id, targetDirectoryId: targetFor(descriptor) }))

    if (assetMoves.length === 0) {
      return
    }

    requireSuccess(await this.directoryModule.moveAssetsAtomically(assetMoves), '无法移动素材')
  }

  private moveDirectories(
    descriptors: Array<Extract<MoveDescriptor, { type: 'directory' }>>,
    targetFor: (descriptor: Extract<MoveDescriptor, { type: 'directory' }>) => string,
    indexFor?: (descriptor: Extract<MoveDescriptor, { type: 'directory' }>) => number | undefined,
  ): void {
    for (const descriptor of descriptors) {
      requireSuccess(
        this.directoryModule.moveDirectoryToParent(
          descriptor.id,
          targetFor(descriptor),
          indexFor?.(descriptor),
        ),
        '无法移动文件夹',
      )
    }
  }

  private restoreDirectories(
    descriptors: Array<Extract<MoveDescriptor, { type: 'directory' }>>,
    restored: Array<Extract<MoveDescriptor, { type: 'directory' }>> = [],
  ): void {
    const errors: string[] = []
    // 同一父目录按原索引升序插回，避免多个同级文件夹恢复后顺序错乱。
    const ordered = [...descriptors].sort((a, b) =>
      a.sourceParentId === b.sourceParentId
        ? a.sourceIndex - b.sourceIndex
        : a.sourceParentId.localeCompare(b.sourceParentId),
    )
    for (const descriptor of ordered) {
      try {
        if (this.directoryModule.getDirectory(descriptor.id)?.parentId !== this.targetDirectoryId) {
          throw new HistoryPreconditionError('文件夹位置已被修改或删除，无法恢复')
        }
        this.moveDirectories(
          [descriptor],
          () => descriptor.sourceParentId,
          () => descriptor.sourceIndex,
        )
        restored.push(descriptor)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : descriptor.id)
      }
    }
    if (errors.length > 0) {
      throw Object.assign(new HistoryPreconditionError('恢复文件夹失败：' + errors.join('；')), {
        toolCode: 'rollback_failed',
      })
    }
  }

  async execute(): Promise<void> {
    if (!this.directoryModule.getDirectory(this.targetDirectoryId)) {
      throw new HistoryPreconditionError('目标文件夹不存在')
    }
    if (this.descriptors === null) {
      this.descriptors = this.captureDescriptors()
    } else {
      this.assertAtSource()
    }

    const directoryDescriptors = this.descriptors.filter(
      (descriptor): descriptor is Extract<MoveDescriptor, { type: 'directory' }> =>
        descriptor.type === 'directory',
    )
    const movedDirectories: Array<Extract<MoveDescriptor, { type: 'directory' }>> = []
    let assetsMoved = false

    try {
      for (const descriptor of directoryDescriptors) {
        this.moveDirectories([descriptor], () => this.targetDirectoryId)
        movedDirectories.push(descriptor)
      }
      await this.moveAssets(() => this.targetDirectoryId)
      assetsMoved = true
      if (
        directoryDescriptors.some((descriptor) => {
          const current = this.directoryModule.getDirectory(descriptor.id)
          return current?.parentId !== this.targetDirectoryId || current.name !== descriptor.name
        })
      ) {
        throw Object.assign(new HistoryPreconditionError('保存期间文件夹状态发生变化'), {
          toolCode: 'state_mismatch',
        })
      }
    } catch (error) {
      // 素材已完成时，后续目录复核失败也需要恢复素材。
      const rollbackErrors: string[] = []
      if (assetsMoved) {
        try {
          await this.moveAssets((descriptor) => descriptor.sourceParentId)
        } catch (rollbackError) {
          rollbackErrors.push(
            rollbackError instanceof Error ? rollbackError.message : '恢复素材失败',
          )
        }
      }
      try {
        this.restoreDirectories(movedDirectories)
      } catch (rollbackError) {
        rollbackErrors.push(
          rollbackError instanceof Error ? rollbackError.message : '恢复文件夹失败',
        )
      }
      if (rollbackErrors.length > 0) {
        throw Object.assign(
          new HistoryPreconditionError('移动失败且回滚失败：' + rollbackErrors.join('；')),
          {
            toolCode: 'rollback_failed',
          },
        )
      }
      throw error
    }
  }

  async undo(): Promise<void> {
    if (!this.descriptors) {
      throw new HistoryPreconditionError('移动项目的历史数据不存在')
    }
    this.assertAtTarget()

    const directoryDescriptors = this.descriptors.filter(
      (descriptor): descriptor is Extract<MoveDescriptor, { type: 'directory' }> =>
        descriptor.type === 'directory',
    )

    await this.moveAssets((descriptor) => descriptor.sourceParentId)
    const restoredDirectories: Array<Extract<MoveDescriptor, { type: 'directory' }>> = []
    try {
      this.restoreDirectories(directoryDescriptors, restoredDirectories)
    } catch (error) {
      try {
        this.moveDirectories(restoredDirectories, () => this.targetDirectoryId)
        await this.moveAssets(() => this.targetDirectoryId)
      } catch (rollbackError) {
        throw Object.assign(
          new HistoryPreconditionError(
            rollbackError instanceof Error ? rollbackError.message : '撤销失败且回滚失败',
          ),
          { toolCode: 'rollback_failed' },
        )
      }
      throw error
    }
  }
}
