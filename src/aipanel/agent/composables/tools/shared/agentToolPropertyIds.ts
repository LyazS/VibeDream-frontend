import type { AnimatablePropertyId } from '@/core/property-system'

export const AGENT_TOOL_KEYFRAME_VALUE_SHAPES = {
  'visual.position': { kind: 'object', keys: ['x', 'y'] },
  'visual.size': { kind: 'object', keys: ['width', 'height'] },
  'visual.rotation': { kind: 'scalar', keys: ['rotation'] },
  'visual.blendIntensity': { kind: 'scalar', keys: ['blendIntensity'] },
  'audio.volume': { kind: 'scalar', keys: ['volume'] },
} as const satisfies Partial<
  Record<
    AnimatablePropertyId,
    {
      kind: 'scalar' | 'object'
      keys: readonly string[]
    }
  >
>

export type AgentToolKeyframePropertyId = keyof typeof AGENT_TOOL_KEYFRAME_VALUE_SHAPES

export const AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP = {
  'visual.position.x': 'visual.position',
  'visual.position.y': 'visual.position',
  'visual.size.width': 'visual.size',
  'visual.size.height': 'visual.size',
  'visual.rotation': 'visual.rotation',
  'visual.blendIntensity': 'visual.blendIntensity',
  'audio.volume': 'audio.volume',
} as const satisfies Record<string, AnimatablePropertyId>
