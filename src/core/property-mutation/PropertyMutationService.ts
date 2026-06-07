import { normalizeAngle } from '@/core/utils/rotationTransform'
import type {
  ChangePlan,
  DirectPropertyMutationIntent,
  PropertyKeyframeToggleIntent,
  PropertyMutationIntent,
} from './types'
import {
  type ClipPropertySchema,
  transformPositionSchema,
  transformRotationSchema,
  transformSizeSchema,
} from '@/core/property-schema'
import {
  findKeyframeAtFrame,
  getCurrentGroupValue,
  getKeyframeButtonState,
  getPosition,
  getRelativeFrame,
} from '@/core/animation/engine'
import type { AnimationGroupValueMap } from '@/core/timelineitem/bunnytype'

export class PropertyMutationService {
  plan(intent: PropertyMutationIntent): ChangePlan {
    const schema = this.getSchema(intent.propertyId)
    if (!schema) {
      throw new Error(`Unsupported property mutation: ${intent.propertyId}`)
    }

    if (intent.kind === 'direct') {
      return this.planDirect(intent, schema)
    }

    return this.planKeyframeToggle(intent, schema)
  }

  private getSchema(propertyId: PropertyMutationIntent['propertyId']): ClipPropertySchema | null {
    if (propertyId === transformRotationSchema.propertyId) return transformRotationSchema
    if (propertyId === transformPositionSchema.propertyId) return transformPositionSchema
    if (propertyId === transformSizeSchema.propertyId) return transformSizeSchema
    return null
  }

  private planDirect(intent: DirectPropertyMutationIntent, schema: ClipPropertySchema): ChangePlan {
    if (!schema.supportsDirectCommit) {
      throw new Error(`Direct commit is not supported: ${intent.propertyId}`)
    }

    const groupId = schema.animationGroupId
    const nextPatch = this.normalizeDirectValue(intent, schema)
    const buttonState = getKeyframeButtonState(intent.item, intent.frame, groupId)
    const relativeFrame = getRelativeFrame(intent.item, intent.frame)
    const descriptionTarget = this.getDescriptionTarget(schema)

    if (buttonState === 'none') {
      return {
        propertyId: schema.propertyId,
        description: `修改${descriptionTarget}`,
        operations: [
          {
            kind: 'static-config-patch',
            timelineItemId: intent.timelineItemId,
            frame: intent.frame,
            groupId,
            patch: nextPatch,
          },
        ],
      }
    }

    if (buttonState === 'on-keyframe') {
      const existingKeyframe = findKeyframeAtFrame(intent.item, intent.frame, groupId)
      const baseValue = existingKeyframe?.value ?? getCurrentGroupValue(intent.item, intent.frame, groupId)
      const nextValue = {
        ...baseValue,
        ...nextPatch,
      } as AnimationGroupValueMap[typeof groupId]
      return {
        propertyId: schema.propertyId,
        description: `修改${descriptionTarget}关键帧`,
        operations: [
          {
            kind: 'animation-keyframe-update',
            timelineItemId: intent.timelineItemId,
            frame: intent.frame,
            groupId,
            relativeFrame,
            value: nextValue,
          },
        ],
      }
    }

    const currentValue = getCurrentGroupValue(intent.item, intent.frame, groupId)
    const keyframeValue = {
      ...currentValue,
      ...nextPatch,
    } as AnimationGroupValueMap[typeof groupId]

    return {
      propertyId: schema.propertyId,
      description: `创建${descriptionTarget}关键帧`,
      operations: [
        {
          kind: 'animation-keyframe-create',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          groupId,
          keyframe: {
            position: getPosition(intent.item, relativeFrame),
            frame: relativeFrame,
            cachedFrame: relativeFrame,
            value: keyframeValue,
            properties: keyframeValue,
            easing: { type: 'linear' },
          },
        },
      ],
    }
  }

  private planKeyframeToggle(intent: PropertyKeyframeToggleIntent, schema: ClipPropertySchema): ChangePlan {
    if (!schema.supportsKeyframeToggle) {
      throw new Error(`Keyframe toggle is not supported: ${intent.propertyId}`)
    }

    const groupId = schema.animationGroupId
    const existingKeyframe = findKeyframeAtFrame(intent.item, intent.frame, groupId)
    const relativeFrame = getRelativeFrame(intent.item, intent.frame)
    const descriptionTarget = this.getDescriptionTarget(schema)

    if (existingKeyframe) {
      return {
        propertyId: schema.propertyId,
        description: `删除${descriptionTarget}关键帧`,
        operations: [
          {
            kind: 'animation-keyframe-delete',
            timelineItemId: intent.timelineItemId,
            frame: intent.frame,
            groupId,
            relativeFrame,
          },
        ],
      }
    }

    const keyframeValue = getCurrentGroupValue(intent.item, intent.frame, groupId)

    return {
      propertyId: schema.propertyId,
      description: `创建${descriptionTarget}关键帧`,
      operations: [
        {
          kind: 'animation-keyframe-create',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          groupId,
          keyframe: {
            position: getPosition(intent.item, relativeFrame),
            frame: relativeFrame,
            cachedFrame: relativeFrame,
            value: keyframeValue,
            properties: keyframeValue,
            easing: { type: 'linear' },
          },
        },
      ],
    }
  }

  private normalizeDirectValue(
    intent: DirectPropertyMutationIntent,
    schema: ClipPropertySchema,
  ): Partial<AnimationGroupValueMap[typeof schema.animationGroupId]> {
    if (schema.propertyId === 'transform.rotation') {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error('transform.rotation requires a finite numeric value')
      }
      return {
        rotation: normalizeAngle(intent.value),
      } as Partial<AnimationGroupValueMap[typeof schema.animationGroupId]>
    }

    if (schema.propertyId === 'transform.position') {
      if (!this.isFiniteNumberRecord(intent.value, schema.valueFields)) {
        throw new Error('transform.position requires finite numeric x/y patch values')
      }
      return intent.value as Partial<AnimationGroupValueMap[typeof schema.animationGroupId]>
    }

    if (schema.propertyId === 'transform.size') {
      if (!this.isFiniteNumberRecord(intent.value, schema.valueFields)) {
        throw new Error('transform.size requires finite numeric width/height patch values')
      }
      return intent.value as Partial<AnimationGroupValueMap[typeof schema.animationGroupId]>
    }

    throw new Error(`Unsupported direct value normalization: ${schema.propertyId}`)
  }

  private getDescriptionTarget(schema: ClipPropertySchema): string {
    if (schema.propertyId === 'transform.rotation') return '旋转'
    if (schema.propertyId === 'transform.position') return '位置'
    if (schema.propertyId === 'transform.size') return '尺寸'
    return schema.propertyId
  }

  private isFiniteNumberRecord(value: unknown, allowedFields: readonly string[]): value is Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const entries = Object.entries(value)
    return (
      entries.length > 0 &&
      entries.every(([key, entryValue]) => allowedFields.includes(key) && Number.isFinite(entryValue))
    )
  }
}

export const propertyMutationService = new PropertyMutationService()
