import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import {
  ALL_ANIMATION_GROUPS,
  isDynamicFilterParamAnimationGroupId,
  type AnimationGroupId,
  type AnimationGroupValueMap,
  type DynamicFilterParamAnimationGroupId,
  type DynamicFilterParamNumberValue,
  type DynamicFilterParamValue,
  type DynamicFilterParamVec2Value,
  type PropertyAnimationGroupId,
  type PropertyAnimationValueByGroup,
} from '@/core/timelineitem/bunnytype'
import { getFilterParamKey } from '@/core/property-system/schema/propertyIds'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  applyMaskCenterValue,
  applyMaskEllipseSizeValue,
  applyMaskFeatherValue,
  applyMaskIntensityValue,
  applyMaskMirrorValue,
  applyMaskRectangleCornerRadiusValue,
  applyMaskRectangleSizeValue,
  applyMaskRotationValue,
  getItemLocalSize,
  getMaskCenterValue,
  getMaskEllipseSizeValue,
  getMaskFeatherValue,
  getMaskIntensityValue,
  getMaskMirrorValue,
  getMaskRectangleCornerRadiusValue,
  getMaskRectangleSizeValue,
  getMaskRotationValue,
  normalizeMaskConfig,
} from '@/core/timelineitem/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'

export type AnimationScope = 'transform' | 'audio' | 'mask' | 'filter'

export interface AnimationGroupDefinition<G extends PropertyAnimationGroupId = AnimationGroupId> {
  id: G
  scope: AnimationScope
  supports: (item: UnifiedTimelineItemData<MediaType>) => boolean
  isEnabled: (item: UnifiedTimelineItemData<MediaType>) => boolean
  getBaseValue: (item: UnifiedTimelineItemData<MediaType>) => PropertyAnimationValueByGroup<G> | any
  applyValue: (
    item: UnifiedTimelineItemData<MediaType>,
    value: Partial<PropertyAnimationValueByGroup<G>> | Record<string, number>,
  ) => void
  applyValueToConfig: (
    config: Record<string, unknown>,
    value: PropertyAnimationValueByGroup<G> | Record<string, number>,
  ) => void
  interpolate: (
    from: PropertyAnimationValueByGroup<G> | Record<string, number>,
    to: PropertyAnimationValueByGroup<G> | Record<string, number>,
    t: number,
  ) => PropertyAnimationValueByGroup<G> | any
  uiMeta: {
    order: number
    allowDeferred: boolean
    allowNavigation: boolean
  }
  historyMeta: {
    description: string
  }
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

function interpolateObject<T extends Record<string, number>>(from: T, to: T, t: number): T {
  const next = {} as T
  for (const key of Object.keys(from) as Array<keyof T>) {
    ;(next as any)[key] = lerp(from[key], to[key], t)
  }
  return next
}

function interpolateNumericRecord<T>(from: T, to: T, t: number): T {
  return interpolateObject(from as Record<string, number>, to as Record<string, number>, t) as T
}

function getVisualConfigRecord(item: UnifiedTimelineItemData<MediaType>): Record<string, any> {
  return TimelineItemQueries.getRenderConfig(item) as unknown as Record<string, any>
}

function assertDynamicFilterParamNumber(value: unknown, parameterKey: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`滤镜参数不是有效数字: ${parameterKey}`)
  }
  return value
}

function assertDynamicFilterParamVec2(value: unknown, parameterKey: string): DynamicFilterParamVec2Value {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`滤镜参数不是有效二维向量: ${parameterKey}`)
  }

  const record = value as Record<string, unknown>
  if (typeof record.x !== 'number' || !Number.isFinite(record.x)) {
    throw new Error(`滤镜参数不是有效二维向量: ${parameterKey}`)
  }
  if (typeof record.y !== 'number' || !Number.isFinite(record.y)) {
    throw new Error(`滤镜参数不是有效二维向量: ${parameterKey}`)
  }

  return {
    x: record.x,
    y: record.y,
  }
}

function createDynamicFilterParamDefinition(
  groupId: DynamicFilterParamAnimationGroupId,
): AnimationGroupDefinition<DynamicFilterParamAnimationGroupId> {
  const parameterKey = getFilterParamKey(groupId)
  const getParameterType = (item: UnifiedTimelineItemData<MediaType>) =>
    TimelineItemQueries.getFilter(item)?.packagePayload.parameterSchema[parameterKey]?.type

  return {
    id: groupId,
    scope: 'filter',
    supports: (item) => TimelineItemQueries.supportsClipFilter(item),
    isEnabled: (item) =>
      TimelineItemQueries.supportsClipFilter(item) &&
      (getParameterType(item) === 'number' || getParameterType(item) === 'vec2'),
    getBaseValue: (item): DynamicFilterParamValue => {
      const filterEffect = TimelineItemQueries.getRenderFilter(item)
      if (!filterEffect) {
        throw new Error(`滤镜效果不存在，无法读取动态参数: ${parameterKey}`)
      }
      const currentValue = filterEffect.params[parameterKey]
      const parameterType = getParameterType(item)
      if (parameterType === 'vec2') {
        return assertDynamicFilterParamVec2(currentValue, parameterKey)
      }
      if (parameterType !== 'number') {
        throw new Error(`滤镜参数类型不支持关键帧: ${parameterKey}`)
      }
      return {
        value: assertDynamicFilterParamNumber(currentValue, parameterKey),
      }
    },
    applyValue: (item, value) => {
      const currentFilterEffect = TimelineItemQueries.getFilter(item)
      if (!TimelineItemQueries.supportsClipFilter(item) || !currentFilterEffect) {
        throw new Error(`滤镜效果不存在，无法写入动态参数: ${parameterKey}`)
      }
      const parameterType = getParameterType(item)
      if (parameterType !== 'number' && parameterType !== 'vec2') {
        throw new Error(`滤镜参数类型不支持关键帧: ${parameterKey}`)
      }
      const nextValue = parameterType === 'vec2'
        ? assertDynamicFilterParamVec2(value, parameterKey)
        : assertDynamicFilterParamNumber(
            (value as Partial<DynamicFilterParamNumberValue>).value,
            parameterKey,
          )
      const nextFilterEffect = normalizeClipFilterConfig({
        ...currentFilterEffect,
        params: {
          ...currentFilterEffect.params,
          [parameterKey]: nextValue,
        },
      })
      item.exRenderConfig = {
        ...item.exRenderConfig,
        filter: nextFilterEffect,
      }
      item.runtime.exRenderConfig = {
        ...item.runtime.exRenderConfig,
        filter: nextFilterEffect,
      }
    },
    applyValueToConfig: (config, value) => {
      if (typeof config.params !== 'object' || !config.params || Array.isArray(config.params)) {
        throw new Error(`滤镜参数容器非法，无法写入动态参数: ${parameterKey}`)
      }
      const parameterSchema = config.packagePayload &&
        typeof config.packagePayload === 'object' &&
        !Array.isArray(config.packagePayload)
        ? (config.packagePayload as Record<string, any>).parameterSchema
        : null
      const parameterType = parameterSchema &&
        typeof parameterSchema === 'object' &&
        !Array.isArray(parameterSchema)
        ? (parameterSchema as Record<string, any>)[parameterKey]?.type
        : undefined
      if (parameterType !== 'number' && parameterType !== 'vec2') {
        throw new Error(`滤镜参数类型不支持关键帧: ${parameterKey}`)
      }
      const nextValue = parameterType === 'vec2'
        ? assertDynamicFilterParamVec2(value, parameterKey)
        : assertDynamicFilterParamNumber((value as DynamicFilterParamNumberValue).value, parameterKey)
      const currentParams = config.params as Record<string, unknown>
      const nextFilterEffect = normalizeClipFilterConfig({
        ...(config as Record<string, unknown>),
        params: {
          ...currentParams,
          [parameterKey]: nextValue,
        },
      })
      Object.assign(config, nextFilterEffect)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 56, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: `修改滤镜参数 ${parameterKey} 关键帧` },
  }
}

function getMaskTextureSizeFromConfig(config: Record<string, unknown>) {
  const width = typeof config.width === 'number' ? config.width : 0
  const height = typeof config.height === 'number' ? config.height : 0
  return getItemLocalSize(width, height)
}

const animationGroupDefinitions: {
  [G in AnimationGroupId]: AnimationGroupDefinition<G>
} = {
  'transform.position': {
    id: 'transform.position',
    scope: 'transform',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return {
        x: config.x,
        y: config.y,
      }
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      Object.assign(item.config, value)
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 10, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改位置关键帧' },
  },
  'transform.size': {
    id: 'transform.size',
    scope: 'transform',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return {
        width: config.width,
        height: config.height,
      }
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      Object.assign(item.config, value)
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 20, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改尺寸关键帧' },
  },
  'transform.rotation': {
    id: 'transform.rotation',
    scope: 'transform',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => ({ rotation: getVisualConfigRecord(item).rotation }),
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      Object.assign(item.config, value)
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 30, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改旋转关键帧' },
  },
  'transform.opacity': {
    id: 'transform.opacity',
    scope: 'transform',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasVisualProperties(item),
    getBaseValue: (item) => ({ opacity: getVisualConfigRecord(item).opacity }),
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      Object.assign(item.config, value)
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 40, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改透明度关键帧' },
  },
  'audio.volume': {
    id: 'audio.volume',
    scope: 'audio',
    supports: (item) => TimelineItemQueries.hasAudioProperties(item),
    isEnabled: (item) => TimelineItemQueries.hasAudioProperties(item),
    getBaseValue: (item) => ({ volume: getVisualConfigRecord(item).volume ?? 1 }),
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasAudioProperties(item)) return
      Object.assign(item.config, value)
    },
    applyValueToConfig: (config, value) => {
      Object.assign(config, value)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 50, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改音量关键帧' },
  },
  'filter.intensity': {
    id: 'filter.intensity',
    scope: 'filter',
    supports: (item) => TimelineItemQueries.supportsClipFilter(item),
    isEnabled: (item) =>
      TimelineItemQueries.supportsClipFilter(item) &&
      Boolean(TimelineItemQueries.getFilter(item)),
    getBaseValue: (item) => ({
      intensity: normalizeClipFilterConfig(TimelineItemQueries.getRenderFilter(item)).intensity,
    }),
    applyValue: (item, value) => {
      const currentFilterEffect = TimelineItemQueries.getFilter(item)
      if (!TimelineItemQueries.supportsClipFilter(item) || !currentFilterEffect) return
      const nextFilterEffect = normalizeClipFilterConfig({
        ...currentFilterEffect,
        intensity: value.intensity ?? currentFilterEffect.intensity,
      })
      item.exRenderConfig = {
        ...item.exRenderConfig,
        filter: nextFilterEffect,
      }
      item.runtime.exRenderConfig = {
        ...item.runtime.exRenderConfig,
        filter: nextFilterEffect,
      }
    },
    applyValueToConfig: (config, value) => {
      const nextFilterEffect = normalizeClipFilterConfig({
        ...(config as Record<string, unknown>),
        intensity: value.intensity,
      })
      Object.assign(config, nextFilterEffect)
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 55, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改滤镜强度关键帧' },
  },
  'mask.center': {
    id: 'mask.center',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).enabled,
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskCenterValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskCenterValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskCenterValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 60, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改蒙版中心关键帧' },
  },
  'mask.rotation': {
    id: 'mask.rotation',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).enabled,
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskRotationValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskRotationValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskRotationValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 70, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改蒙版旋转关键帧' },
  },
  'mask.feather': {
    id: 'mask.feather',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).enabled,
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskFeatherValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskFeatherValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskFeatherValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 70, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改蒙版羽化关键帧' },
  },
  'mask.intensity': {
    id: 'mask.intensity',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).enabled,
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskIntensityValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskIntensityValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskIntensityValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 80, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改蒙版强度关键帧' },
  },
  'mask.rectangle.size': {
    id: 'mask.rectangle.size',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).type === 'rectangle',
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskRectangleSizeValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskRectangleSizeValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskRectangleSizeValue(
        config.mask as never,
        value,
        getMaskTextureSizeFromConfig(config),
      )
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 90, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改矩形蒙版尺寸关键帧' },
  },
  'mask.rectangle.cornerRadius': {
    id: 'mask.rectangle.cornerRadius',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).type === 'rectangle',
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskRectangleCornerRadiusValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskRectangleCornerRadiusValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskRectangleCornerRadiusValue(
        config.mask as never,
        value,
        getMaskTextureSizeFromConfig(config),
      )
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 100, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改矩形蒙版圆角关键帧' },
  },
  'mask.ellipse.size': {
    id: 'mask.ellipse.size',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).type === 'ellipse',
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskEllipseSizeValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskEllipseSizeValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskEllipseSizeValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 110, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '修改椭圆蒙版尺寸关键帧' },
  },
  'mask.linear': {
    id: 'mask.linear',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).type === 'linear',
    getBaseValue: () => ({}),
    applyValue: () => {},
    applyValueToConfig: () => {},
    interpolate: (from) => from,
    uiMeta: { order: 120, allowDeferred: false, allowNavigation: false },
    historyMeta: { description: '线性蒙版关键帧' },
  },
  'mask.mirror.length': {
    id: 'mask.mirror.length',
    scope: 'mask',
    supports: (item) => TimelineItemQueries.hasVisualProperties(item),
    isEnabled: (item) =>
      TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getRenderConfig(item).mask).type === 'mirror',
    getBaseValue: (item) => {
      const config = getVisualConfigRecord(item)
      return getMaskMirrorValue(config.mask as never, getMaskTextureSizeFromConfig(config))
    },
    applyValue: (item, value) => {
      if (!TimelineItemQueries.hasVisualProperties(item)) return
      item.config.mask = applyMaskMirrorValue(
        item.config.mask,
        value,
        getItemLocalSize(item.config.width, item.config.height),
      )
    },
    applyValueToConfig: (config, value) => {
      config.mask = applyMaskMirrorValue(config.mask as never, value, getMaskTextureSizeFromConfig(config))
    },
    interpolate: interpolateNumericRecord,
    uiMeta: { order: 130, allowDeferred: true, allowNavigation: true },
    historyMeta: { description: '镜像蒙版关键帧' },
  },
}

export const AnimationRegistry = {
  ids: ALL_ANIMATION_GROUPS,
  get<G extends PropertyAnimationGroupId>(groupId: G): AnimationGroupDefinition<G> {
    if (isDynamicFilterParamAnimationGroupId(groupId)) {
      return createDynamicFilterParamDefinition(groupId) as AnimationGroupDefinition<G>
    }
    return animationGroupDefinitions[groupId as AnimationGroupId] as AnimationGroupDefinition<G>
  },
  list(): AnimationGroupDefinition[] {
    return ALL_ANIMATION_GROUPS.map((groupId) => animationGroupDefinitions[groupId]) as any
  },
}
