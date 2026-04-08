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
import type { TransitionShaderResource } from '@/core/transition/types'

interface TransitionTemplateResolvedCandidate extends TransitionTemplateDropCandidate {
  snappedFrame: number | null
  preview: EffectTemplatePreviewData | null
}

function resolveTemplateDurationFrames(dragData: MediaItemDragData): number {
  return Math.max(2, Math.round(Number((dragData.templatePayload as any)?.durationFrames ?? 30)))
}

function resolveTemplateShader(dragData: MediaItemDragData): TransitionShaderResource | null {
  const shader = (dragData.templatePayload as any)?.shader as TransitionShaderResource | undefined
  if (!shader?.fragmentShader) {
    return null
  }
  return shader
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
    const shader = resolveTemplateShader(dragData)
    if (!shader) {
      return { success: false, error: '模板资产缺少 shader 资源' }
    }

    store.pause()
    await store.updateTransitionOutWithHistory(candidate.sourceItemId, {
      durationFrames,
      templateAssetId: dragData.assetId,
      shader,
    })

    return { success: true }
  }
}
