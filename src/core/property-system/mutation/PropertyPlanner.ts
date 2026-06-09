import { normalizeAngle } from '@/core/utils/rotationTransform'
import type {
  ChangePlan,
  DirectPropertyPlanIntent,
  PropertyKeyframeTogglePlanIntent,
  PropertyPlanIntent,
} from './types'
import {
  type AnimatablePropertySchema,
  propertySchemaResolver,
} from '@/core/property-system/schema'
import {
  findKeyframeAtFrame,
  getCurrentGroupValue,
  getKeyframeButtonState,
  getPosition,
  getRelativeFrame,
} from '@/core/animation/engine'
import type { PropertyAnimationValueByGroup } from '@/core/timelineitem/bunnytype'

export class PropertyPlanner {
  plan(intent: PropertyPlanIntent): ChangePlan {
    const schema = propertySchemaResolver.getSchema({
      item: intent.item,
      frame: intent.frame,
    }, intent.propertyId)
    if (!schema) {
      throw new Error(`Unsupported property plan: ${intent.propertyId}`)
    }

    if (intent.kind === 'direct') {
      return this.planDirect(intent, schema)
    }

    return this.planKeyframeToggle(intent, schema)
  }

  private planDirect(intent: DirectPropertyPlanIntent, schema: AnimatablePropertySchema): ChangePlan {
    if (!schema.supportsDirectCommit) {
      throw new Error(`Direct commit is not supported: ${intent.propertyId}`)
    }

    const nextStaticPatch = this.normalizeDirectPatchValue(intent, schema)
    const descriptionTarget = this.getDescriptionTarget(schema)
    const groupId = schema.animationGroupId

    if (!groupId) {
      return {
        propertyId: schema.propertyId,
        description: `修改${descriptionTarget}`,
        operations: [
          {
            kind: 'no-animation-group-patch',
            timelineItemId: intent.timelineItemId,
            frame: intent.frame,
            target: schema.target,
            patch: nextStaticPatch,
          },
        ],
      }
    }

    const buttonState = getKeyframeButtonState(intent.item, intent.frame, groupId)
    const relativeFrame = getRelativeFrame(intent.item, intent.frame)

    if (buttonState === 'none') {
      return {
        propertyId: schema.propertyId,
        description: `修改${descriptionTarget}`,
        operations: [
          {
            kind: 'no-animation-group-patch',
            timelineItemId: intent.timelineItemId,
            frame: intent.frame,
            groupId,
            target: schema.target,
            patch: nextStaticPatch,
          },
        ],
      }
    }

    const nextKeyframePatch = this.normalizeKeyframePatchValue(intent, schema)

    if (buttonState === 'on-keyframe') {
      const existingKeyframe = findKeyframeAtFrame(intent.item, intent.frame, groupId)
      const baseValue = existingKeyframe?.value ?? getCurrentGroupValue(intent.item, intent.frame, groupId)
      const nextValue = {
        ...baseValue,
        ...nextKeyframePatch,
      } as PropertyAnimationValueByGroup<typeof groupId>
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
      ...nextKeyframePatch,
    } as PropertyAnimationValueByGroup<typeof groupId>

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

  private planKeyframeToggle(intent: PropertyKeyframeTogglePlanIntent, schema: AnimatablePropertySchema): ChangePlan {
    if (!schema.supportsKeyframeToggle) {
      throw new Error(`Keyframe toggle is not supported: ${intent.propertyId}`)
    }

    const groupId = schema.animationGroupId
    if (!groupId) {
      throw new Error(`Animation group is not configured: ${intent.propertyId}`)
    }
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

  private normalizeDirectPatchValue(
    intent: DirectPropertyPlanIntent,
    schema: AnimatablePropertySchema,
  ): Record<string, unknown> {
    if (schema.propertyId === 'transform.rotation') {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error('transform.rotation requires a finite numeric value')
      }
      return {
        rotation: normalizeAngle(intent.value),
      }
    }

    if (schema.propertyId === 'transform.opacity') {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error('transform.opacity requires a finite numeric value')
      }
      return {
        opacity: Math.min(1, Math.max(0, intent.value)),
      }
    }

    if (schema.propertyId === 'audio.volume') {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error('audio.volume requires a finite numeric value')
      }
      return {
        volume: Math.min(1, Math.max(0, intent.value)),
      }
    }

    if (schema.propertyId === 'filter.intensity') {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error('filter.intensity requires a finite numeric value')
      }
      return {
        intensity: Math.min(1, Math.max(0, intent.value)),
      }
    }

    if (schema.propertyId.startsWith('filter.param.')) {
      if (schema.valueKind !== 'number') {
        throw new Error(`Unsupported filter parameter value kind: ${schema.propertyId}`)
      }
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error(`${schema.propertyId} requires a finite numeric value`)
      }

      const parameterKey = schema.propertyId.slice('filter.param.'.length)
      return {
        params: {
          [parameterKey]: this.clampNumber(intent.value, schema.min, schema.max),
        },
      }
    }

    if (schema.propertyId === 'transform.position') {
      if (!this.isFiniteNumberRecord(intent.value, schema.valueFields)) {
        throw new Error('transform.position requires finite numeric x/y patch values')
      }
      return intent.value
    }

    if (schema.propertyId === 'transform.size') {
      if (!this.isFiniteNumberRecord(intent.value, schema.valueFields)) {
        throw new Error('transform.size requires finite numeric width/height patch values')
      }
      return intent.value
    }

    throw new Error(`Unsupported direct value normalization: ${schema.propertyId}`)
  }

  private normalizeKeyframePatchValue(
    intent: DirectPropertyPlanIntent,
    schema: AnimatablePropertySchema,
  ): Record<string, unknown> {
    if (schema.propertyId.startsWith('filter.param.')) {
      if (typeof intent.value !== 'number' || !Number.isFinite(intent.value)) {
        throw new Error(`${schema.propertyId} requires a finite numeric value`)
      }
      return {
        value: this.clampNumber(intent.value, schema.min, schema.max),
      }
    }

    return this.normalizeDirectPatchValue(intent, schema)
  }

  private getDescriptionTarget(schema: AnimatablePropertySchema): string {
    if (schema.propertyId === 'transform.rotation') return '旋转'
    if (schema.propertyId === 'transform.position') return '位置'
    if (schema.propertyId === 'transform.size') return '尺寸'
    if (schema.propertyId === 'transform.opacity') return '混合强度'
    if (schema.propertyId === 'filter.intensity') return '滤镜强度'
    if (schema.propertyId.startsWith('filter.param.')) return schema.label ?? schema.propertyId
    if (schema.propertyId === 'audio.volume') return '音量'
    return schema.propertyId
  }

  private clampNumber(value: number, min?: number, max?: number): number {
    let nextValue = value
    if (typeof min === 'number' && Number.isFinite(min)) {
      nextValue = Math.max(min, nextValue)
    }
    if (typeof max === 'number' && Number.isFinite(max)) {
      nextValue = Math.min(max, nextValue)
    }
    return nextValue
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

export const propertyPlanner = new PropertyPlanner()
