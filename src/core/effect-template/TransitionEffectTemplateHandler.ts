import type { MediaItemDragData, DropResult } from '@/core/types/drag'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  resolveTransitionTemplateDropCandidate,
  type TransitionTemplateDropCandidate,
} from '@/core/timelineitem/transition'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type {
  EffectTemplateHandler,
  EffectTemplateResolveContext,
  EffectTemplateApplyContext,
  EffectTemplatePreviewData,
} from '@/core/effect-template/types'

interface TransitionTemplateResolvedCandidate extends TransitionTemplateDropCandidate {
  snappedFrame: number | null
  preview: EffectTemplatePreviewData | null
  invalidReason?: string
}

const INVALID_TEMPLATE_PACKAGE_ERROR = '模板资产缺少有效的转场模板标识或默认时长'

function resolveTransitionDurationFrames(dragData: MediaItemDragData): number | null {
  if (typeof dragData.duration === 'number' && Number.isFinite(dragData.duration) && dragData.duration >= 2) {
    return Math.round(dragData.duration)
  }

  const effectPackageId = dragData.effectPackageId
  if (!effectPackageId) {
    return null
  }

  const state = effectTemplateRegistry.getPackageState(effectPackageId)
  const durationFrames = state?.meta?.transitionDurationFrames
  if (typeof durationFrames === 'number' && Number.isFinite(durationFrames) && durationFrames >= 2) {
    return Math.round(durationFrames)
  }

  return null
}

function createRejectedCandidate(invalidReason?: string): TransitionTemplateResolvedCandidate {
  return {
    canDrop: false,
    seamFrame: null,
    sourceItemId: null,
    matchCount: 0,
    sourceItemStartFrame: null,
    sourceItemEndFrame: null,
    snappedFrame: null,
    preview: null,
    invalidReason,
  }
}

export class TransitionEffectTemplateHandler
  implements EffectTemplateHandler<TransitionTemplateResolvedCandidate>
{
  readonly effectType = 'transition' as const

  resolveDropCandidate(context: EffectTemplateResolveContext): TransitionTemplateResolvedCandidate {
    if (context.targetTrack.type !== 'video') {
      return createRejectedCandidate()
    }

    const requestedDurationFrames = resolveTransitionDurationFrames(context.dragData)
    if (
      !requestedDurationFrames ||
      !context.dragData.effectPackageId ||
      !context.dragData.templateId ||
      !context.dragData.packageVersion ||
      !context.dragData.catalogVersion
    ) {
      return createRejectedCandidate(INVALID_TEMPLATE_PACKAGE_ERROR)
    }

    const candidate = resolveTransitionTemplateDropCandidate(
      context.trackItems,
      context.hoveredFrame,
      context.thresholdFrames,
    )

    if (
      !candidate.canDrop ||
      candidate.seamFrame === null ||
      candidate.sourceItemStartFrame === null ||
      candidate.sourceItemEndFrame === null
    ) {
      return {
        ...candidate,
        snappedFrame: candidate.seamFrame,
        preview: null,
      }
    }

    const durationFrames = Math.min(
      requestedDurationFrames,
      Math.max(2, candidate.sourceItemEndFrame - candidate.sourceItemStartFrame),
    )
    const leftHalfFrames = Math.floor(durationFrames / 2)
    const rightHalfFrames = durationFrames - leftHalfFrames
    const previewStartFrame = Math.max(0, candidate.seamFrame - leftHalfFrames)
    const previewEndFrame = candidate.seamFrame + rightHalfFrames

    return {
      ...candidate,
      snappedFrame: candidate.seamFrame,
      preview: {
        kind: 'clip-tail',
        startFrame: previewStartFrame,
        durationFrames: Math.max(2, previewEndFrame - previewStartFrame),
        seamFrame: candidate.seamFrame,
        label: '转场',
      },
    }
  }

  async applyTemplate(
    context: EffectTemplateApplyContext<TransitionTemplateResolvedCandidate>,
  ): Promise<DropResult> {
    const { candidate, dragData, targetTrack } = context
    if (!candidate.canDrop || !candidate.sourceItemId || targetTrack.type !== 'video') {
      return { success: false }
    }

    const store = useUnifiedStore()
    const durationFrames = resolveTransitionDurationFrames(dragData)
    if (
      !durationFrames ||
      !dragData.effectPackageId ||
      !dragData.templateId ||
      !dragData.packageVersion ||
      !dragData.catalogVersion
    ) {
      return { success: false, error: INVALID_TEMPLATE_PACKAGE_ERROR }
    }

    store.pause()
    await store.updateTransitionConfigWithHistory(candidate.sourceItemId, {
      effectPackageId: dragData.effectPackageId,
      templateId: dragData.templateId,
      packageVersion: dragData.packageVersion,
      catalogVersion: dragData.catalogVersion,
      durationFrames,
      params: {},
    })

    void effectTemplateRegistry.ensureReady(dragData.effectPackageId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      store.messageError(message)
    })

    return { success: true }
  }
}
