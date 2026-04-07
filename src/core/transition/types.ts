export const DEFAULT_CLIP_TRANSITION_DURATION_FRAMES = 12

export interface TransitionShaderResource {
  vertexShader?: string
  fragmentShader: string
}

export interface ClipTransitionOutConfig {
  durationFrames: number
  templateAssetId?: string
  shader: TransitionShaderResource
}
