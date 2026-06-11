import { propertyPlanner } from '@/core/property-system/mutation'
import type {
  AnimatablePropertyId,
  ChangeOperation,
  ChangePlan,
  ChangePlanPropertyId,
  DirectPropertyId,
  DirectPropertyBatchPlanEntry,
} from '@/core/property-system/mutation'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'

export interface PropertyMutationCommitContext {
  item: UnifiedTimelineItemData<MediaType>
  frame: number
  applyChangePlan: (plan: ChangePlan) => Promise<void>
}

export class PropertyMutationCommitter {
  async commitDirect(
    context: PropertyMutationCommitContext,
    propertyId: DirectPropertyId,
    value: unknown,
  ): Promise<void> {
    await context.applyChangePlan(
      propertyPlanner.plan({
        kind: 'direct',
        propertyId,
        timelineItemId: context.item.id,
        frame: context.frame,
        value,
        item: context.item,
      }),
    )
  }

  async commitDirectBatch(
    context: PropertyMutationCommitContext,
    entries: DirectPropertyBatchPlanEntry[],
    description?: string,
  ): Promise<void> {
    if (entries.length === 0) {
      return
    }

    await context.applyChangePlan(
      propertyPlanner.planDirectBatch({
        timelineItemId: context.item.id,
        frame: context.frame,
        item: context.item,
        entries,
        description,
      }),
    )
  }

  async toggleKeyframe(
    context: PropertyMutationCommitContext,
    propertyId: AnimatablePropertyId,
  ): Promise<void> {
    await context.applyChangePlan(
      propertyPlanner.plan({
        kind: 'keyframe-toggle',
        propertyId,
        timelineItemId: context.item.id,
        frame: context.frame,
        item: context.item,
      }),
    )
  }

  createDirectPlan(
    context: Omit<PropertyMutationCommitContext, 'applyChangePlan'>,
    propertyId: DirectPropertyId,
    value: unknown,
  ): ChangePlan {
    return propertyPlanner.plan({
      kind: 'direct',
      propertyId,
      timelineItemId: context.item.id,
      frame: context.frame,
      value,
      item: context.item,
    })
  }

  async commitConfigPatch(
    context: PropertyMutationCommitContext,
    plan: {
      propertyId: ChangePlanPropertyId
      description: string
      operations: ChangeOperation[]
    },
  ): Promise<void> {
    await context.applyChangePlan(plan)
  }

  async commitChangePlan(
    context: PropertyMutationCommitContext,
    plan: ChangePlan,
  ): Promise<void> {
    await context.applyChangePlan(plan)
  }
}

export const propertyMutationCommitter = new PropertyMutationCommitter()
