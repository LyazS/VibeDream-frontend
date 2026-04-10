import type { TransitionPackagePayload } from '@/core/effect-package/types'

export const DEFAULT_CLIP_TRANSITION_DURATION_FRAMES = 30

export interface ClipTransitionOutConfig {
  durationFrames: number
  templateAssetId?: string
  packageAssetId?: string
  params?: Record<string, unknown>
  packagePayload?: TransitionPackagePayload
}
