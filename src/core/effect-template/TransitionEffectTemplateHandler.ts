import type { MediaItemDragData, DropResult } from '@/core/types/drag'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  resolveTransitionTemplateDropCandidate,
  type TransitionTemplateDropCandidate,
} from '@/core/timelineitem/transition'
import type {
  EffectTemplateHandler,
  EffectTemplateResolveContext,
  EffectTemplateApplyContext,
  EffectTemplatePreviewData,
} from '@/core/effect-template/types'
import { isTransitionPackagePayload, type TransitionPackagePayload } from '@/core/effect-package/types'

interface TransitionTemplateResolvedCandidate extends TransitionTemplateDropCandidate {
  snappedFrame: number | null
  preview: EffectTemplatePreviewData | null
  invalidReason?: string
}

const INVALID_TEMPLATE_PACKAGE_ERROR = '模板资产缺少有效的 transition effect package 配置'

function resolveTemplatePackage(dragData: MediaItemDragData): TransitionPackagePayload | null {
  return isTransitionPackagePayload(dragData.templatePayload) ? dragData.templatePayload : null
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

    const packagePayload = resolveTemplatePackage(context.dragData)
    if (!packagePayload) {
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
      packagePayload.host.transition.defaultDurationFrames,
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
    const packagePayload = resolveTemplatePackage(dragData)
    if (!packagePayload) {
      return { success: false, error: INVALID_TEMPLATE_PACKAGE_ERROR }
    }
    const durationFrames = packagePayload.host.transition.defaultDurationFrames

    store.pause()
    await store.updateTransitionOutWithHistory(candidate.sourceItemId, {
      durationFrames,
      assetId: dragData.assetId,
      packagePayload: packagePayload,
      params: JSON.parse(JSON.stringify(packagePayload.defaultParams)),
    })

    return { success: true }
  }
}
