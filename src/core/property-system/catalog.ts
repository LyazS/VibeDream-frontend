import type { MediaType } from '@/core/mediaitem'
import type { AnimationGroupId } from '@/core/timelineitem/model/render'
import type { DynamicFilterParamPropertyId } from './schema/propertyIds'

export const STATIC_ANIMATABLE_PROPERTY_IDS = [
  'visual.rotation',
  'visual.position',
  'visual.size',
  'visual.blendIntensity',
  'filter.intensity',
  'audio.volume',
  'mask.rotation',
  'mask.center',
  'mask.rectangle.size',
  'mask.rectangle.cornerRadius',
  'mask.ellipse.size',
  'mask.mirror.length',
  'mask.feather',
  'mask.intensity',
] as const satisfies readonly Exclude<AnimationGroupId, 'mask.linear'>[]

export type StaticAnimatablePropertyId = (typeof STATIC_ANIMATABLE_PROPERTY_IDS)[number]
export type AnimatablePropertyId = StaticAnimatablePropertyId | DynamicFilterParamPropertyId

export const CONFIG_PROPERTY_IDS = [
  'visual.blendMode',
  'visual.proportionalScale',
  'audio.isMuted',
  'mask.enabled',
  'mask.type',
  'mask.inverted',
] as const

export type ConfigPropertyId = (typeof CONFIG_PROPERTY_IDS)[number]

export const DIRECT_ONLY_PROPERTY_IDS = [
  'text.content',
  'text.style.fontSize',
  'text.style.fontFamily',
  'text.style.fontWeight',
  'text.style.fontStyle',
  'text.style.color',
  'text.style.backgroundColor',
  'text.style.textAlign',
  'text.style.textShadow',
  'text.style.textStroke',
  'text.style.textGlow',
] as const

export type DirectOnlyPropertyId = (typeof DIRECT_ONLY_PROPERTY_IDS)[number]
export type DirectPropertyId = AnimatablePropertyId | DirectOnlyPropertyId

export type ClipPropertyGroupId = 'visual' | 'audio' | 'text' | 'mask'
export type StaticPropertyId = StaticAnimatablePropertyId | ConfigPropertyId | DirectOnlyPropertyId

export const CLIP_PROPERTY_GROUP_SUPPORT = {
  video: ['visual', 'audio', 'mask'],
  image: ['visual', 'mask'],
  audio: ['audio'],
  text: ['visual', 'text', 'mask'],
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
  {
    path: 'visual.position.x',
    propertyId: 'visual.position',
    groupId: 'visual',
    animationGroupId: 'visual.position',
  },
  {
    path: 'visual.position.y',
    propertyId: 'visual.position',
    groupId: 'visual',
    animationGroupId: 'visual.position',
  },
  {
    path: 'visual.size.width',
    propertyId: 'visual.size',
    groupId: 'visual',
    animationGroupId: 'visual.size',
  },
  {
    path: 'visual.size.height',
    propertyId: 'visual.size',
    groupId: 'visual',
    animationGroupId: 'visual.size',
  },
  {
    path: 'visual.rotation',
    propertyId: 'visual.rotation',
    groupId: 'visual',
    animationGroupId: 'visual.rotation',
  },
  {
    path: 'visual.blendIntensity',
    propertyId: 'visual.blendIntensity',
    groupId: 'visual',
    animationGroupId: 'visual.blendIntensity',
  },
  {
    path: 'visual.blendMode',
    propertyId: 'visual.blendMode',
    groupId: 'visual',
  },
  {
    path: 'visual.proportionalScale',
    propertyId: 'visual.proportionalScale',
    groupId: 'visual',
  },
  {
    path: 'audio.volume',
    propertyId: 'audio.volume',
    groupId: 'audio',
    animationGroupId: 'audio.volume',
  },
  {
    path: 'audio.isMuted',
    propertyId: 'audio.isMuted',
    groupId: 'audio',
  },
  {
    path: 'mask.enabled',
    propertyId: 'mask.enabled',
    groupId: 'mask',
  },
  {
    path: 'mask.type',
    propertyId: 'mask.type',
    groupId: 'mask',
  },
  {
    path: 'mask.inverted',
    propertyId: 'mask.inverted',
    groupId: 'mask',
  },
  {
    path: 'mask.center.x',
    propertyId: 'mask.center',
    groupId: 'mask',
    animationGroupId: 'mask.center',
  },
  {
    path: 'mask.center.y',
    propertyId: 'mask.center',
    groupId: 'mask',
    animationGroupId: 'mask.center',
  },
  {
    path: 'mask.rotation',
    propertyId: 'mask.rotation',
    groupId: 'mask',
    animationGroupId: 'mask.rotation',
  },
  {
    path: 'mask.feather',
    propertyId: 'mask.feather',
    groupId: 'mask',
    animationGroupId: 'mask.feather',
  },
  {
    path: 'mask.intensity',
    propertyId: 'mask.intensity',
    groupId: 'mask',
    animationGroupId: 'mask.intensity',
  },
  {
    path: 'mask.rectangle.size.width',
    propertyId: 'mask.rectangle.size',
    groupId: 'mask',
    animationGroupId: 'mask.rectangle.size',
  },
  {
    path: 'mask.rectangle.size.height',
    propertyId: 'mask.rectangle.size',
    groupId: 'mask',
    animationGroupId: 'mask.rectangle.size',
  },
  {
    path: 'mask.rectangle.cornerRadius',
    propertyId: 'mask.rectangle.cornerRadius',
    groupId: 'mask',
    animationGroupId: 'mask.rectangle.cornerRadius',
  },
  {
    path: 'mask.ellipse.size.width',
    propertyId: 'mask.ellipse.size',
    groupId: 'mask',
    animationGroupId: 'mask.ellipse.size',
  },
  {
    path: 'mask.ellipse.size.height',
    propertyId: 'mask.ellipse.size',
    groupId: 'mask',
    animationGroupId: 'mask.ellipse.size',
  },
  {
    path: 'mask.mirror.length',
    propertyId: 'mask.mirror.length',
    groupId: 'mask',
    animationGroupId: 'mask.mirror.length',
  },
  {
    path: 'text.content',
    propertyId: 'text.content',
    groupId: 'text',
  },
  {
    path: 'text.style.fontFamily',
    propertyId: 'text.style.fontFamily',
    groupId: 'text',
  },
  {
    path: 'text.style.fontSize',
    propertyId: 'text.style.fontSize',
    groupId: 'text',
  },
  {
    path: 'text.style.color',
    propertyId: 'text.style.color',
    groupId: 'text',
  },
  {
    path: 'text.style.fontWeight',
    propertyId: 'text.style.fontWeight',
    groupId: 'text',
  },
  {
    path: 'text.style.fontStyle',
    propertyId: 'text.style.fontStyle',
    groupId: 'text',
  },
  {
    path: 'text.style.backgroundColor',
    propertyId: 'text.style.backgroundColor',
    groupId: 'text',
  },
  {
    path: 'text.style.textAlign',
    propertyId: 'text.style.textAlign',
    groupId: 'text',
  },
  {
    path: 'text.style.textShadow',
    propertyId: 'text.style.textShadow',
    groupId: 'text',
  },
  {
    path: 'text.style.textStroke',
    propertyId: 'text.style.textStroke',
    groupId: 'text',
  },
  {
    path: 'text.style.textGlow',
    propertyId: 'text.style.textGlow',
    groupId: 'text',
  },
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
  { propertyId: 'mask.center', kind: 'object', keys: ['centerX', 'centerY'] },
  { propertyId: 'mask.rotation', kind: 'scalar', keys: ['rotation'] },
  { propertyId: 'mask.feather', kind: 'scalar', keys: ['outerRange'] },
  { propertyId: 'mask.intensity', kind: 'scalar', keys: ['decayRate'] },
  { propertyId: 'mask.rectangle.size', kind: 'object', keys: ['width', 'height'] },
  { propertyId: 'mask.rectangle.cornerRadius', kind: 'scalar', keys: ['cornerRadius'] },
  { propertyId: 'mask.ellipse.size', kind: 'object', keys: ['ellipseWidth', 'ellipseHeight'] },
  { propertyId: 'mask.mirror.length', kind: 'scalar', keys: ['length'] },
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
