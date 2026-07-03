import type {
  ChangePlan,
  ChangeOperation,
  DirectPropertyBatchPlanIntent,
  DirectPropertyPlanIntent,
  PropertyKeyframeTogglePlanIntent,
  PropertyPlanIntent,
} from './types'
import {
  type AnimatablePropertySchema,
  isFilterParamPropertyId,
  propertySchemaResolver,
} from '@/core/property-system/schema'
import {
  findKeyframeAtFrame,
  getCurrentGroupValue,
  getKeyframeButtonState,
  getPosition,
  getRelativeFrame,
} from '@/core/animation/engine'
import type { PropertyAnimationValueByGroup } from '@/core/timelineitem/model/render'

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

  planDirectBatch(intent: DirectPropertyBatchPlanIntent): ChangePlan {
    const operations = intent.entries.flatMap((entry) => {
      const schema = propertySchemaResolver.getSchema({
        item: intent.item,
        frame: intent.frame,
      }, entry.propertyId)
      if (!schema) {
        throw new Error(`Unsupported property plan: ${entry.propertyId}`)
      }

      return this.createDirectOperations({
        kind: 'direct',
        propertyId: entry.propertyId,
        timelineItemId: intent.timelineItemId,
        frame: intent.frame,
        value: entry.value,
        item: intent.item,
      }, schema)
    })

    return {
      propertyId: 'filter.batch',
      description: intent.description ?? '修改滤镜参数',
      operations,
    }
  }

  private planDirect(intent: DirectPropertyPlanIntent, schema: AnimatablePropertySchema): ChangePlan {
    const operations = this.createDirectOperations(intent, schema)
    const descriptionTarget = this.getDescriptionTarget(schema)

    return {
      propertyId: schema.propertyId,
      description: `修改${descriptionTarget}`,
      operations,
    }
  }

  private createDirectOperations(
    intent: DirectPropertyPlanIntent,
    schema: AnimatablePropertySchema,
  ): ChangeOperation[] {
    if (!schema.supportsDirectCommit) {
      throw new Error(`Direct commit is not supported: ${intent.propertyId}`)
    }

    const nextStaticPatch = this.normalizeDirectPatchValue(intent, schema)
    if (schema.propertyId === 'text.content') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          content: String(nextStaticPatch.content ?? ''),
        },
      ]
    }

    if (schema.propertyId === 'text.style.fontSize') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            fontSize: nextStaticPatch.fontSize,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.fontFamily') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            fontFamily: nextStaticPatch.fontFamily,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.fontWeight') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            fontWeight: nextStaticPatch.fontWeight,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.fontStyle') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            fontStyle: nextStaticPatch.fontStyle,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.color') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            color: nextStaticPatch.color,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.backgroundColor') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            backgroundColor: nextStaticPatch.backgroundColor,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.textAlign') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            textAlign: nextStaticPatch.textAlign,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.textShadow') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            textShadow: nextStaticPatch.textShadow,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.textStroke') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            textStroke: nextStaticPatch.textStroke,
          },
        },
      ]
    }

    if (schema.propertyId === 'text.style.textGlow') {
      return [
        {
          kind: 'text-rebuild',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          stylePatch: {
            textGlow: nextStaticPatch.textGlow,
          },
        },
      ]
    }

    const groupId = schema.animationGroupId

    if (!groupId) {
      return [
        {
          kind: 'no-animation-group-patch',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          target: schema.target,
          patch: nextStaticPatch,
        },
      ]
    }

    const buttonState = getKeyframeButtonState(intent.item, intent.frame, groupId)
    const relativeFrame = getRelativeFrame(intent.item, intent.frame)

    if (buttonState === 'none') {
      return [
        {
          kind: 'no-animation-group-patch',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          groupId,
          target: schema.target,
          patch: nextStaticPatch,
        },
      ]
    }

    const nextKeyframePatch = this.normalizeKeyframePatchValue(intent, schema)

    if (buttonState === 'on-keyframe') {
      const existingKeyframe = findKeyframeAtFrame(intent.item, intent.frame, groupId)
      const baseValue = existingKeyframe?.value ?? getCurrentGroupValue(intent.item, intent.frame, groupId)
      const nextValue = {
        ...baseValue,
        ...nextKeyframePatch,
      } as PropertyAnimationValueByGroup<typeof groupId>
      return [
        {
          kind: 'animation-keyframe-update',
          timelineItemId: intent.timelineItemId,
          frame: intent.frame,
          groupId,
          relativeFrame,
          value: nextValue,
        },
      ]
    }

    const currentValue = getCurrentGroupValue(intent.item, intent.frame, groupId)
    const keyframeValue = {
      ...currentValue,
      ...nextKeyframePatch,
    } as PropertyAnimationValueByGroup<typeof groupId>

    return [
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
    ]
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
    if (!schema.normalizeDirectValue) {
      throw new Error(`Direct value normalization is not configured: ${schema.propertyId}`)
    }

    return schema.normalizeDirectValue(intent.value)
  }

  private normalizeKeyframePatchValue(
    intent: DirectPropertyPlanIntent,
    schema: AnimatablePropertySchema,
  ): Record<string, unknown> {
    if (schema.normalizeKeyframeValue) {
      return schema.normalizeKeyframeValue(intent.value)
    }

    return this.normalizeDirectPatchValue(intent, schema)
  }

  private getDescriptionTarget(schema: AnimatablePropertySchema): string {
    if (schema.propertyId === 'visual.rotation') return '旋转'
    if (schema.propertyId === 'visual.position') return '位置'
    if (schema.propertyId === 'visual.size') return '尺寸'
    if (schema.propertyId === 'visual.blendIntensity') return '混合强度'
    if (schema.propertyId === 'filter.intensity') return '滤镜强度'
    if (isFilterParamPropertyId(schema.propertyId)) return schema.label ?? schema.propertyId
    if (schema.propertyId === 'audio.volume') return '音量'
    if (schema.propertyId === 'text.content') return '文本内容'
    if (schema.propertyId === 'text.style.fontFamily') return '字体'
    if (schema.propertyId === 'text.style.fontSize') return '字号'
    if (schema.propertyId === 'text.style.fontStyle') return '字体样式'
    if (schema.propertyId === 'text.style.fontWeight') return '字重'
    if (schema.propertyId === 'text.style.color') return '文字颜色'
    if (schema.propertyId === 'text.style.backgroundColor') return '背景颜色'
    if (schema.propertyId === 'text.style.textAlign') return '文本对齐'
    if (schema.propertyId === 'text.style.textGlow') return '文字发光'
    if (schema.propertyId === 'text.style.textStroke') return '文字描边'
    if (schema.propertyId === 'text.style.textShadow') return '文字阴影'
    if (schema.propertyId === 'mask.center') return '蒙版中心'
    if (schema.propertyId === 'mask.rectangle.size') return '矩形蒙版尺寸'
    if (schema.propertyId === 'mask.rectangle.cornerRadius') return '矩形蒙版圆角'
    if (schema.propertyId === 'mask.ellipse.size') return '椭圆蒙版尺寸'
    if (schema.propertyId === 'mask.mirror.length') return '镜像蒙版长度'
    if (schema.propertyId === 'mask.feather') return '蒙版羽化'
    if (schema.propertyId === 'mask.intensity') return '蒙版强度'
    if (schema.propertyId === 'mask.rotation') return '蒙版旋转'
    return schema.propertyId
  }
}

export const propertyPlanner = new PropertyPlanner()
