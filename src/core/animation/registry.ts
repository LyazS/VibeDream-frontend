import type { MediaType } from '@/core/mediaitem'
import type {
  AudioProps,
  UnifiedTimelineItemData,
  VisualProps,
} from '@/core/timelineitem/model/timelineItem'
import {
  ALL_ANIMATION_GROUPS,
  isDynamicFilterParamAnimationGroupId,
  type AnimationGroupId,
  type AnimationGroupValueMap,
  type DynamicFilterParamAnimationGroupId,
  type DynamicFilterParamColorValue,
  type DynamicFilterParamNumberValue,
  type DynamicFilterParamValue,
  type DynamicFilterParamVec2Value,
  type PropertyAnimationGroupId,
  type PropertyAnimationValueByGroup,
} from '@/core/timelineitem/model/render'
import { normalizeFilterParamColor } from '@/core/filter/color'
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
} from '@/core/timelineitem/features/mask'
import { normalizeClipFilterConfig } from '@/core/timelineitem/features/filter'

export type AnimationScope = 'transform' | 'audio' | 'mask' | 'filter'

export interface AnimationGroupDefinition<G extends PropertyAnimationGroupId = AnimationGroupId> {
  id: G
  scope: AnimationScope
  supports: (item: UnifiedTimelineItemData<MediaType>) => boolean
  isEnabled: (item: UnifiedTimelineItemData<MediaType>) => boolean
  getBaseValue: (item: UnifiedTimelineItemData<MediaType>) => PropertyAnimationValueByGroup<G>
  applyValueToConfig: (config: object, value: PropertyAnimationValueByGroup<G> | Record<string, number>) => void
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

function getDynamicFilterParameterTypeFromConfig(
  config: Record<string, unknown>,
  parameterKey: string,
): 'number' | 'vec2' | 'color' | undefined {
  const packagePayload = config.packagePayload as Record<string, unknown> | undefined
  if (typeof packagePayload !== 'object' || packagePayload === null || Array.isArray(packagePayload)) {
    return undefined
  }

  const parameterSchema = packagePayload.parameterSchema as Record<string, unknown> | undefined
  if (
    typeof parameterSchema !== 'object' ||
    parameterSchema === null ||
    Array.isArray(parameterSchema)
  ) {
    return undefined
  }

  const parameterDefinition = parameterSchema[parameterKey]
  if (
    typeof parameterDefinition !== 'object' ||
    parameterDefinition === null ||
    Array.isArray(parameterDefinition)
  ) {
    return undefined
  }

  const parameterType = (parameterDefinition as { type?: unknown }).type
  return parameterType === 'number' || parameterType === 'vec2' || parameterType === 'color'
    ? parameterType
    : undefined
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

function assertDynamicFilterParamColor(
  value: unknown,
  parameterKey: string,
): DynamicFilterParamColorValue {
  try {
    return normalizeFilterParamColor(value)
  } catch {
    throw new Error(`滤镜参数不是有效颜色: ${parameterKey}`)
  }
}

function createDynamicFilterParamDefinition(
  groupId: DynamicFilterParamAnimationGroupId,
): AnimationGroupDefinition<DynamicFilterParamAnimationGroupId> {
  const parameterKey = getFilterParamKey(groupId)
  const getParameterType = (item: UnifiedTimelineItemData<MediaType>) =>
    TimelineItemQueries.getBaseFilter(item)?.packagePayload.parameterSchema[parameterKey]?.type

  return {
    id: groupId,
    scope: 'filter',
    supports: (item) => TimelineItemQueries.supportsClipFilter(item),
    isEnabled: (item) =>
      TimelineItemQueries.supportsClipFilter(item) &&
      (
        getParameterType(item) === 'number' ||
        getParameterType(item) === 'vec2' ||
        getParameterType(item) === 'color'
      ),
    getBaseValue: (item): DynamicFilterParamValue => {
      const filterConfig = TimelineItemQueries.getResolvedFilter(item)
      if (!filterConfig) {
        throw new Error(`滤镜效果不存在，无法读取动态参数: ${parameterKey}`)
      }
      const currentValue = filterConfig.params[parameterKey]
      const parameterType = getParameterType(item)
      if (parameterType === 'color') {
        return assertDynamicFilterParamColor(currentValue, parameterKey)
      }
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
    applyValueToConfig: (config, value) => {
      const mutableConfig = config as Record<string, unknown>
      if (
        typeof mutableConfig.params !== 'object' ||
        !mutableConfig.params ||
        Array.isArray(mutableConfig.params)
      ) {
        throw new Error(`滤镜参数容器非法，无法写入动态参数: ${parameterKey}`)
      }
      const parameterType = getDynamicFilterParameterTypeFromConfig(mutableConfig, parameterKey)
      if (parameterType !== 'number' && parameterType !== 'vec2' && parameterType !== 'color') {
        throw new Error(`滤镜参数类型不支持关键帧: ${parameterKey}`)
      }
      const nextValue = parameterType === 'vec2'
        ? assertDynamicFilterParamVec2(value, parameterKey)
        : parameterType === 'color'
          ? assertDynamicFilterParamColor(value, parameterKey)
          : assertDynamicFilterParamNumber((value as DynamicFilterParamNumberValue).value, parameterKey)
      const currentParams = mutableConfig.params as Record<string, unknown>
      const nextFilterEffect = normalizeClipFilterConfig({
        ...mutableConfig,
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

function getMaskTextureSizeFromConfig(config: Pick<VisualProps, 'width' | 'height'>) {
  const width = typeof config.width === 'number' ? config.width : 0
  const height = typeof config.height === 'number' ? config.height : 0
  return getItemLocalSize(width, height)
}

function getMaskTextureSizeFromItem(item: UnifiedTimelineItemData<MediaType>) {
  const config = getVisualConfigRecord(item)
  return getMaskTextureSizeFromConfig(config)
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
    getBaseValue: (item) => ({ volume: getAudioConfigRecord(item).volume ?? 1 }),
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
      Boolean(TimelineItemQueries.getBaseFilter(item)),
      getBaseValue: (item) => ({
      intensity: normalizeClipFilterConfig(TimelineItemQueries.getResolvedFilter(item)).intensity,
      }),
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).enabled,
      getBaseValue: (item) => {
      return getMaskCenterValue(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item))
      },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskCenterValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).enabled,
      getBaseValue: (item) => {
      return getMaskRotationValue(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item))
      },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskRotationValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).enabled,
      getBaseValue: (item) => {
      return getMaskFeatherValue(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item))
      },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskFeatherValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).enabled,
      getBaseValue: (item) => {
      return getMaskIntensityValue(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item))
      },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskIntensityValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).type === 'rectangle',
      getBaseValue: (item) => {
      return getMaskRectangleSizeValue(
        TimelineItemQueries.getResolvedMask(item),
        getMaskTextureSizeFromItem(item),
      )
    },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskRectangleSizeValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).type === 'rectangle',
      getBaseValue: (item) => {
      return getMaskRectangleCornerRadiusValue(
        TimelineItemQueries.getResolvedMask(item),
        getMaskTextureSizeFromItem(item),
      )
    },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(
        maskConfig,
        applyMaskRectangleCornerRadiusValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value),
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).type === 'ellipse',
      getBaseValue: (item) => {
      return getMaskEllipseSizeValue(
        TimelineItemQueries.getResolvedMask(item),
        getMaskTextureSizeFromItem(item),
      )
    },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskEllipseSizeValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).type === 'linear',
    getBaseValue: () => ({}),
    applyValueToConfig: () => {},
    interpolate: (from) => from as Record<string, never>,
    uiMeta: { order: 120, allowDeferred: false, allowNavigation: false },
    historyMeta: { description: '线性蒙版关键帧' },
  },
  'mask.mirror.length': {
    id: 'mask.mirror.length',
      scope: 'mask',
      supports: (item) => TimelineItemQueries.hasVisualProperties(item),
      isEnabled: (item) =>
        TimelineItemQueries.hasVisualProperties(item) &&
      normalizeMaskConfig(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item)).type === 'mirror',
      getBaseValue: (item) => {
      return getMaskMirrorValue(TimelineItemQueries.getResolvedMask(item), getMaskTextureSizeFromItem(item))
      },
    applyValueToConfig: (maskConfig, value) => {
      Object.assign(maskConfig, applyMaskMirrorValue(maskConfig as Partial<ReturnType<typeof normalizeMaskConfig>>, value))
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
      return createDynamicFilterParamDefinition(groupId) as unknown as AnimationGroupDefinition<G>
    }
    return animationGroupDefinitions[groupId as AnimationGroupId] as AnimationGroupDefinition<G>
  },
  list(): StaticAnimationGroupDefinition[] {
    return ALL_ANIMATION_GROUPS.map(
      (groupId) => animationGroupDefinitions[groupId as AnimationGroupId],
    )
  },
}
