export type DynamicFilterParamPropertyId = `filter.param.${string}`

export const FILTER_PARAM_PROPERTY_PREFIX = 'filter.param.'
export const FILTER_PARAM_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidFilterParamKey(key: string): boolean {
  return FILTER_PARAM_KEY_PATTERN.test(key)
}

export function createFilterParamPropertyId(key: string): DynamicFilterParamPropertyId {
  if (!isValidFilterParamKey(key)) {
    throw new Error(`非法滤镜参数 key: ${key}`)
  }
  return `${FILTER_PARAM_PROPERTY_PREFIX}${key}` as DynamicFilterParamPropertyId
}

export function isFilterParamPropertyId(propertyId: string): propertyId is DynamicFilterParamPropertyId {
  if (!propertyId.startsWith(FILTER_PARAM_PROPERTY_PREFIX)) {
    return false
  }
  return isValidFilterParamKey(propertyId.slice(FILTER_PARAM_PROPERTY_PREFIX.length))
}

export function getFilterParamKey(propertyId: DynamicFilterParamPropertyId): string {
  return propertyId.slice(FILTER_PARAM_PROPERTY_PREFIX.length)
}
