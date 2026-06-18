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
import { supportsClipFilter } from '@/core/timelineitem/features/filter'
import { isFilterPackagePayload } from '@/core/effect-package/types'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { cancelFilterDeferredInteractionByTimelineItemId } from '@/core/composables/useUnifiedFilterControls'

function isFilterTemplateDragData(dragData: UnifiedDragData): dragData is MediaItemDragData {
  if (dragData.sourceType !== DragSourceType.ASSET && dragData.sourceType !== DragSourceType.MEDIA_ITEM) {
    return false
  }

  const mediaData = dragData as MediaItemDragData
  if (mediaData.assetKind !== 'effect-template' || mediaData.effectType !== 'filter') {
    return false
  }

  return isFilterPackagePayload(mediaData.templatePayload)
    || Boolean(
      mediaData.effectPackageId
      && mediaData.templateId
      && mediaData.packageVersion
      && mediaData.catalogVersion,
    )
}

function canResolveFilterPackage(mediaData: MediaItemDragData): boolean {
  if (isFilterPackagePayload(mediaData.templatePayload)) {
    return true
  }

  const effectPackageId = mediaData.effectPackageId ?? mediaData.assetId
  const state = effectTemplateRegistry.getPackageState(effectPackageId)
  return state?.status === 'ready' || state?.status === 'installed' || state?.status === 'loading'
}

export class ClipFilterDropTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.CLIP_FILTER_DROPZONE

  constructor(
    private readonly timelineModule: UnifiedTimelineModule,
    private readonly mediaModule: UnifiedMediaModule,
  ) {}

  canAccept(dragData: UnifiedDragData): boolean {
    return isFilterTemplateDragData(dragData)
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
    return canResolveFilterPackage(mediaData)
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

    const effectPackageId = mediaData.effectPackageId ?? mediaData.assetId
    let templatePayload = mediaData.templatePayload
    if (!isFilterPackagePayload(templatePayload)) {
      try {
        await effectTemplateRegistry.ensureReady(effectPackageId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
      templatePayload = effectTemplateRegistry.getReadyPackage(effectPackageId)?.payload
    }

    if (!isFilterPackagePayload(templatePayload)) {
      return { success: false, error: '滤镜素材缺少有效 package 配置' }
    }

    const store = useUnifiedStore()
    cancelFilterDeferredInteractionByTimelineItemId(timelineItemId)
    store.pause()
    await store.updateFilterConfigWithHistory(timelineItemId, {
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
