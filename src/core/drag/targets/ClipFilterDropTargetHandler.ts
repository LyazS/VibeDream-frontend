import type {
  ClipFilterDropTargetInfo,
  DropResult,
  DropTargetHandler,
  DropTargetInfo,
  DropTargetType,
  MediaItemDragData,
  UnifiedDragData,
} from '@/core/types/drag'
import { DragSourceType, DropTargetType as TargetType } from '@/core/types/drag'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import { useUnifiedStore } from '@/core/unifiedStore'
import { supportsClipFilter } from '@/core/timelineitem/filter'
import { isFilterPackagePayload } from '@/core/effect-package/types'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { cancelFilterDeferredInteractionByTimelineItemId } from '@/core/composables/useUnifiedFilterControls'

export class ClipFilterDropTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.CLIP_FILTER_DROPZONE

  constructor(
    private readonly timelineModule: UnifiedTimelineModule,
    private readonly mediaModule: UnifiedMediaModule,
  ) {}

  canAccept(dragData: UnifiedDragData): boolean {
    if (dragData.sourceType !== DragSourceType.ASSET && dragData.sourceType !== DragSourceType.MEDIA_ITEM) {
      return false
    }

    const mediaData = dragData as MediaItemDragData
    return mediaData.assetKind === 'effect-template'
      && mediaData.effectType === 'filter'
      && isFilterPackagePayload(mediaData.templatePayload)
  }

  handleDragOver(_event: DragEvent, dragData: UnifiedDragData, targetInfo: DropTargetInfo): boolean {
    if (!this.canAccept(dragData) || targetInfo.targetType !== TargetType.CLIP_FILTER_DROPZONE) {
      return false
    }

    const item = this.timelineModule.getTimelineItem((targetInfo as ClipFilterDropTargetInfo).timelineItemId)
    if (!item || !supportsClipFilter(item)) {
      return false
    }

    const mediaData = dragData as MediaItemDragData
    const effectPackageId = mediaData.effectPackageId ?? mediaData.assetId
    return effectTemplateRegistry.getPackageState(effectPackageId)?.status === 'ready'
  }

  async handleDrop(
    _event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    if (targetInfo.targetType !== TargetType.CLIP_FILTER_DROPZONE) {
      return { success: false }
    }

    const timelineItemId = (targetInfo as ClipFilterDropTargetInfo).timelineItemId
    const item = this.timelineModule.getTimelineItem(timelineItemId)
    if (!item || !supportsClipFilter(item)) {
      return { success: false }
    }

    const mediaData = dragData as MediaItemDragData
    if (!this.canAccept(mediaData)) {
      return { success: false }
    }

    const templatePayload = mediaData.templatePayload
    if (!isFilterPackagePayload(templatePayload)) {
      return { success: false, error: '滤镜素材缺少有效 package 配置' }
    }

    const effectPackageId = mediaData.effectPackageId ?? ''
    if (effectTemplateRegistry.getPackageState(effectPackageId)?.status !== 'ready') {
      return { success: false, error: '滤镜素材尚未就绪' }
    }

    const store = useUnifiedStore()
    cancelFilterDeferredInteractionByTimelineItemId(timelineItemId)
    store.pause()
    await store.updateFilterEffectWithHistory(timelineItemId, {
      effectPackageId,
      templateId: mediaData.templateId ?? templatePayload.packageId,
      packageVersion: mediaData.packageVersion ?? templatePayload.version,
      catalogVersion: mediaData.catalogVersion ?? '',
      intensity: 1,
      params: JSON.parse(JSON.stringify(templatePayload.defaultParams)),
      packagePayload: templatePayload,
    })

    return { success: true }
  }
}
