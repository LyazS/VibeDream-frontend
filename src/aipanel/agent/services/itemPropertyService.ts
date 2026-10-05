import { fetchClient, type RequestConfig } from '@/utils/fetchClient'

export type ItemPropertyUsage = 'static_edit' | 'keyframe_edit' | 'transition_edit'

export interface ItemPropertyRequest {
  usage: ItemPropertyUsage
  propertyIds: string[]
  templateId?: string
}

export interface ItemPropertyDescription {
  requestedPropertyId: string
  success: boolean
  error?: string
  resolvedPropertyId?: string
  targetKind?: string
  groupId?: string
  editable?: boolean
  animatable?: boolean
  valueType?: string | null
  valueShape?: { kind: 'scalar'; type: 'number' } | { kind: 'object'; keys: string[] } | null
  componentHint?: string | null
  description?: string
  constraints?: string[]
  default?: unknown
  min?: unknown
  max?: unknown
  step?: unknown
  options?: unknown
}

export interface ItemPropertyResponse {
  tool: 'describe_item_property'
  usage?: ItemPropertyUsage
  templateId?: string
  propertyIds?: string[]
  propertyDescriptions?: ItemPropertyDescription[]
  error?: string
}

export function describeItemProperties(body: ItemPropertyRequest, config?: RequestConfig) {
  return fetchClient.post<ItemPropertyResponse>(
    '/api/agent/tools/describe-item-property',
    body,
    config,
  )
}
