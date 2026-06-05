import type { TransitionPackagePayload } from '@/core/effect-package/types'

export const DEFAULT_CLIP_TRANSITION_DURATION_FRAMES = 30

export interface ClipTransitionOutConfig {
  effectPackageId: string
  templateId: string
  packageVersion: string
  catalogVersion: string
  durationFrames: number
  params: Record<string, unknown>
  packagePayload?: TransitionPackagePayload
}
