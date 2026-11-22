import type { MediaType } from '@/core/mediaitem'
import type { AnimationGroupId } from '@/core/timelineitem/model/render'

export const STATIC_ANIMATABLE_PROPERTY_IDS = [
  'visual.rotation',
  'visual.position',
  'visual.size',
  'visual.blendIntensity',
  'audio.volume',
] as const satisfies readonly AnimationGroupId[]

export type StaticAnimatablePropertyId = (typeof STATIC_ANIMATABLE_PROPERTY_IDS)[number]
export type AnimatablePropertyId = StaticAnimatablePropertyId

export const CONFIG_PROPERTY_IDS = [
  'visual.blendMode',
  'visual.proportionalScale',
  'audio.isMuted',
] as const

export type ConfigPropertyId = (typeof CONFIG_PROPERTY_IDS)[number]

export const DIRECT_ONLY_PROPERTY_IDS = [] as const
export type DirectOnlyPropertyId = (typeof DIRECT_ONLY_PROPERTY_IDS)[number]
export type DirectPropertyId = AnimatablePropertyId | DirectOnlyPropertyId

export type ClipPropertyGroupId = 'visual' | 'audio'
export type StaticPropertyId = StaticAnimatablePropertyId | ConfigPropertyId | DirectOnlyPropertyId

export const CLIP_PROPERTY_GROUP_SUPPORT = {
  video: ['visual', 'audio'],
  image: ['visual'],
  audio: ['audio'],
} as const satisfies Record<MediaType, readonly ClipPropertyGroupId[]>

export function getSupportedClipPropertyGroups(mediaType: MediaType): readonly ClipPropertyGroupId[] {
  return CLIP_PROPERTY_GROUP_SUPPORT[mediaType]
}

type ClipPropertyPathDefinition = {
  path: string
  propertyId: StaticPropertyId
  groupId: ClipPropertyGroupId
  animationGroupId?: StaticAnimatablePropertyId
}

export const CLIP_PROPERTY_PATH_DEFINITIONS = [
  { path: 'visual.position.x', propertyId: 'visual.position', groupId: 'visual', animationGroupId: 'visual.position' },
  { path: 'visual.position.y', propertyId: 'visual.position', groupId: 'visual', animationGroupId: 'visual.position' },
  { path: 'visual.size.width', propertyId: 'visual.size', groupId: 'visual', animationGroupId: 'visual.size' },
  { path: 'visual.size.height', propertyId: 'visual.size', groupId: 'visual', animationGroupId: 'visual.size' },
  { path: 'visual.rotation', propertyId: 'visual.rotation', groupId: 'visual', animationGroupId: 'visual.rotation' },
  { path: 'visual.blendIntensity', propertyId: 'visual.blendIntensity', groupId: 'visual', animationGroupId: 'visual.blendIntensity' },
  { path: 'visual.blendMode', propertyId: 'visual.blendMode', groupId: 'visual' },
  { path: 'visual.proportionalScale', propertyId: 'visual.proportionalScale', groupId: 'visual' },
  { path: 'audio.volume', propertyId: 'audio.volume', groupId: 'audio', animationGroupId: 'audio.volume' },
  { path: 'audio.isMuted', propertyId: 'audio.isMuted', groupId: 'audio' },
] as const satisfies readonly ClipPropertyPathDefinition[]

export type ClipPropertyPath = (typeof CLIP_PROPERTY_PATH_DEFINITIONS)[number]['path']

export const CLIP_PROPERTY_PATH_DEFINITION_MAP = Object.fromEntries(
  CLIP_PROPERTY_PATH_DEFINITIONS.map((definition) => [definition.path, definition]),
) as {
  [K in ClipPropertyPath]: Extract<(typeof CLIP_PROPERTY_PATH_DEFINITIONS)[number], { path: K }>
}

const staticPropertyToAnimationGroupMap: Partial<
  Record<ClipPropertyPath, StaticAnimatablePropertyId>
> = {}

for (const definition of CLIP_PROPERTY_PATH_DEFINITIONS) {
  if ('animationGroupId' in definition) {
    staticPropertyToAnimationGroupMap[definition.path] = definition.animationGroupId
  }
}

export const AGENT_TOOL_STATIC_PROPERTY_TO_ANIMATION_GROUP_MAP = staticPropertyToAnimationGroupMap

type AgentToolKeyframeValueShape = {
  kind: 'scalar' | 'object'
  keys: readonly string[]
}

type AgentToolKeyframePropertyDefinition = {
  propertyId: StaticAnimatablePropertyId
  kind: AgentToolKeyframeValueShape['kind']
  keys: readonly string[]
}

export const AGENT_TOOL_KEYFRAME_PROPERTY_DEFINITIONS = [
  { propertyId: 'visual.position', kind: 'object', keys: ['x', 'y'] },
  { propertyId: 'visual.size', kind: 'object', keys: ['width', 'height'] },
  { propertyId: 'visual.rotation', kind: 'scalar', keys: ['rotation'] },
  { propertyId: 'visual.blendIntensity', kind: 'scalar', keys: ['blendIntensity'] },
  { propertyId: 'audio.volume', kind: 'scalar', keys: ['volume'] },
] as const satisfies readonly AgentToolKeyframePropertyDefinition[]

export type AgentToolKeyframePropertyId =
  (typeof AGENT_TOOL_KEYFRAME_PROPERTY_DEFINITIONS)[number]['propertyId']

export const AGENT_TOOL_KEYFRAME_PROPERTY_IDS = AGENT_TOOL_KEYFRAME_PROPERTY_DEFINITIONS.map(
  (definition) => definition.propertyId,
) as readonly AgentToolKeyframePropertyId[]

const keyframeValueShapeMap: Partial<
  Record<AgentToolKeyframePropertyId, AgentToolKeyframeValueShape>
> = {}

for (const definition of AGENT_TOOL_KEYFRAME_PROPERTY_DEFINITIONS) {
  keyframeValueShapeMap[definition.propertyId] = {
    kind: definition.kind,
    keys: definition.keys,
  }
}

export const AGENT_TOOL_KEYFRAME_VALUE_SHAPES =
  keyframeValueShapeMap as Record<AgentToolKeyframePropertyId, AgentToolKeyframeValueShape>

export function isAgentToolKeyframePropertyId(
  propertyId: string,
): propertyId is AgentToolKeyframePropertyId {
  return propertyId in AGENT_TOOL_KEYFRAME_VALUE_SHAPES
}
