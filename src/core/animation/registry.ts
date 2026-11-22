import type { MediaType } from '@/core/mediaitem'
import type {
  AudioProps,
  UnifiedTimelineItemData,
  VisualProps,
} from '@/core/timelineitem/model/timelineItem'
import {
  ALL_ANIMATION_GROUPS,
  type AnimationGroupId,
  type PropertyAnimationGroupId,
  type PropertyAnimationValueByGroup,
} from '@/core/timelineitem/model/render'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

export type AnimationScope = 'visual' | 'audio'

export interface AnimationGroupDefinition<G extends PropertyAnimationGroupId = AnimationGroupId> {
  id: G
  scope: AnimationScope
  supports: (item: UnifiedTimelineItemData<MediaType>) => boolean
  isEnabled: (item: UnifiedTimelineItemData<MediaType>) => boolean
  getBaseValue: (item: UnifiedTimelineItemData<MediaType>) => PropertyAnimationValueByGroup<G>
  applyValueToConfig: (
    config: object,
    value: PropertyAnimationValueByGroup<G> | Record<string, number>,
  ) => void
  interpolate: (
    from: PropertyAnimationValueByGroup<G> | Record<string, number>,
    to: PropertyAnimationValueByGroup<G> | Record<string, number>,
    t: number,
  ) => PropertyAnimationValueByGroup<G> | Record<string, number>
  uiMeta: {
    order: number
    allowDeferred: boolean
    allowNavigation: boolean
  }
  historyMeta: {
    description: string
  }
}

type StaticAnimationGroupDefinition = {
  [G in AnimationGroupId]: AnimationGroupDefinition<G>
}[AnimationGroupId]

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

function interpolateObject<K extends string>(
  from: Record<K, number>,
  to: Record<K, number>,
  t: number,
): Record<K, number> {
  const next = {} as Record<K, number>
  for (const key of Object.keys(from) as K[]) {
    next[key] = lerp(from[key], to[key], t)
  }
  return next
}

function interpolateNumericRecord<T>(from: T, to: T, t: number): T {
  return interpolateObject(
    from as Record<keyof T & string, number>,
    to as Record<keyof T & string, number>,
    t,
  ) as T
}

function getVisualConfigRecord(item: UnifiedTimelineItemData<MediaType>): VisualProps {
  if (!TimelineItemQueries.hasVisualProperties(item)) {
    throw new Error(`时间轴项缺少视觉配置: ${item.id}`)
  }
  return TimelineItemQueries.getResolvedRenderConfig(item).visual
}

function getAudioConfigRecord(item: UnifiedTimelineItemData<MediaType>): AudioProps {
  if (!TimelineItemQueries.hasAudioProperties(item)) {
    throw new Error(`时间轴项缺少音频配置: ${item.id}`)
  }
  return TimelineItemQueries.getResolvedRenderConfig(item).audio
}

const animationGroupDefinitions: {
  [G in AnimationGroupId]: AnimationGroupDefinition<G>
} = {
  'visual.position': {
    id: 'visual.position',
    scope: 'visual',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => {
      const visual = getVisualConfigRecord(item)
      return { x: visual.x, y: visual.y }
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 10, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改位置关键帧' },
  },
  'visual.size': {
    id: 'visual.size',
    scope: 'visual',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => {
      const visual = getVisualConfigRecord(item)
      return { width: visual.width, height: visual.height }
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 20, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改尺寸关键帧' },
  },
  'visual.rotation': {
    id: 'visual.rotation',
    scope: 'visual',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => ({ rotation: getVisualConfigRecord(item).rotation }),
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 30, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改旋转关键帧' },
  },
  'visual.blendIntensity': {
    id: 'visual.blendIntensity',
    scope: 'visual',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => ({ blendIntensity: getVisualConfigRecord(item).blendIntensity }),
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 40, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改混合强度关键帧' },
  },
  'audio.volume': {
    id: 'audio.volume',
    scope: 'audio',
    supports: (item) => TimelineItemQueries.hasAudioProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasAudioProperties(item),
    getBaseValue: (item) => ({ volume: getAudioConfigRecord(item).volume ?? 1 }),
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 50, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改音量关键帧' },
  },
}

export const AnimationRegistry = {
  ids: ALL_ANIMATION_GROUPS,
  get<G extends PropertyAnimationGroupId>(groupId: G): AnimationGroupDefinition<G> {
    return animationGroupDefinitions[groupId as AnimationGroupId] as AnimationGroupDefinition<G>
  },
  list(): StaticAnimationGroupDefinition[] {
    return ALL_ANIMATION_GROUPS.map(
      (groupId) => animationGroupDefinitions[groupId as AnimationGroupId],
    )
  },
}
