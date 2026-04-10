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
import type { TransitionPackagePayload } from '@/core/effect-package/types'

interface TransitionTemplateResolvedCandidate extends TransitionTemplateDropCandidate {
  snappedFrame: number | null
  preview: EffectTemplatePreviewData | null
}

function resolveTemplateDurationFrames(dragData: MediaItemDragData): number {
  const payload = dragData.templatePayload as any
  return Math.max(
    2,
    Math.round(Number(payload?.defaultDurationFrames ?? payload?.durationFrames ?? 30)),
  )
}

function resolveTemplatePackage(dragData: MediaItemDragData): TransitionPackagePayload | null {
  const payload = dragData.templatePayload as TransitionPackagePayload | undefined
  return payload && 'packageId' in payload ? payload : null
}

export class TransitionEffectTemplateHandler
  implements EffectTemplateHandler<TransitionTemplateResolvedCandidate>
{
  readonly effectType = 'transition' as const

  resolveDropCandidate(context: EffectTemplateResolveContext): TransitionTemplateResolvedCandidate {
    if (context.targetTrack.type !== 'video') {
      return {
        canDrop: false,
        seamFrame: null,
        sourceItemId: null,
        matchCount: 0,
        sourceItemStartFrame: null,
        sourceItemEndFrame: null,
        snappedFrame: null,
        preview: null,
      }
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
      resolveTemplateDurationFrames(context.dragData),
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
    const durationFrames = resolveTemplateDurationFrames(dragData)
    const packagePayload = resolveTemplatePackage(dragData)
    if (!packagePayload) {
      return { success: false, error: '模板资产缺少可下载的 effect package' }
    }

    store.pause()
    await store.updateTransitionOutWithHistory(candidate.sourceItemId, {
      durationFrames,
      templateAssetId: dragData.assetId,
      packageAssetId: dragData.assetId,
      packagePayload: packagePayload,
      params: JSON.parse(JSON.stringify(packagePayload.defaultParams)),
    })

    return { success: true }
  }
}
