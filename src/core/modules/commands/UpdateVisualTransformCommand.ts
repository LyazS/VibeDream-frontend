import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type {
  BlendMode,
  VisualPropPatch,
  UnifiedTimelineItemData,
  VideoMediaConfig,
} from '@/core/timelineitem'
import { BLEND_MODE_HISTORY_LABELS } from '@/core/timelineitem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem'

export interface VisualTransformUpdate {
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  opacity?: number
  blendMode?: BlendMode
}

export class UpdateVisualTransformCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private oldValues: VisualTransformUpdate,
    private newValues: VisualTransformUpdate,
    private timelineModule: {
      setTimelineItemVisualPropsForCmd: (id: string, patch: VisualPropPatch) => void
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ) {
    this.id = generateCommandId()

    const timelineItem = this.timelineModule.getTimelineItem(timelineItemId)
    const mediaItem = timelineItem ? this.mediaModule.getMediaItem(timelineItem.mediaItemId) : null
    this.description = this.generateDescription(mediaItem?.name || '未知素材')
  }

  async execute(): Promise<void> {
    this.applyValues(this.newValues, '更新视觉属性')
  }

  async undo(): Promise<void> {
    this.applyValues(this.oldValues, '撤销视觉属性')
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    console.log(`🗑️ [UpdateVisualTransformCommand] 命令资源已清理: ${this.id}`)
  }

  private applyValues(values: VisualTransformUpdate, action: string): void {
    const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!timelineItem) {
      console.warn(`⚠️ 时间轴项目不存在，无法${action}: ${this.timelineItemId}`)
      return
    }

    const transformValues: VisualPropPatch = {
      x: values.x,
      y: values.y,
      width: values.width,
      height: values.height,
      rotation: values.rotation,
      opacity: values.opacity,
      blendMode: values.blendMode,
    }

    const filteredTransform = Object.fromEntries(
      Object.entries(transformValues).filter(([_, value]) => value !== undefined),
    ) as VisualPropPatch

    if (Object.keys(filteredTransform).length > 0) {
      this.timelineModule.setTimelineItemVisualPropsForCmd(this.timelineItemId, filteredTransform)
    }
  }

  private generateDescription(mediaName: string): string {
    const changes: string[] = []

    if (
      (this.newValues.x !== undefined && this.oldValues.x !== undefined) ||
      (this.newValues.y !== undefined && this.oldValues.y !== undefined)
    ) {
      const oldX = this.oldValues.x ?? 0
      const oldY = this.oldValues.y ?? 0
      const newX = this.newValues.x ?? oldX
      const newY = this.newValues.y ?? oldY
      changes.push(
        `位置: (${oldX.toFixed(0)}, ${oldY.toFixed(0)}) → (${newX.toFixed(0)}, ${newY.toFixed(0)})`,
      )
    }

    if (
      (this.newValues.width !== undefined && this.oldValues.width !== undefined) ||
      (this.newValues.height !== undefined && this.oldValues.height !== undefined)
    ) {
      const oldWidth = this.oldValues.width ?? 0
      const oldHeight = this.oldValues.height ?? 0
      const newWidth = this.newValues.width ?? oldWidth
      const newHeight = this.newValues.height ?? oldHeight
      changes.push(
        `大小: ${oldWidth.toFixed(0)}×${oldHeight.toFixed(0)} → ${newWidth.toFixed(0)}×${newHeight.toFixed(0)}`,
      )
    }

    if (this.newValues.rotation !== undefined && this.oldValues.rotation !== undefined) {
      changes.push(`旋转: ${this.oldValues.rotation.toFixed(1)}° → ${this.newValues.rotation.toFixed(1)}°`)
    }

    if (this.newValues.opacity !== undefined && this.oldValues.opacity !== undefined) {
      changes.push(
        `透明度: ${(this.oldValues.opacity * 100).toFixed(0)}% → ${(this.newValues.opacity * 100).toFixed(0)}%`,
      )
    }

    if (this.newValues.blendMode !== undefined && this.oldValues.blendMode !== undefined) {
      changes.push(
        `混合模式: ${BLEND_MODE_HISTORY_LABELS[this.oldValues.blendMode]} → ${BLEND_MODE_HISTORY_LABELS[this.newValues.blendMode]}`,
      )
    }

    const changeText = changes.length > 0 ? ` (${changes.join(', ')})` : ''
    return `更新视觉属性: ${mediaName}${changeText}`
  }
}
