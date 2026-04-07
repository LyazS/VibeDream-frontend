import type { EffectType } from '@/core/asset/types'
import type { EffectTemplateHandler } from '@/core/effect-template/types'
import { TransitionEffectTemplateHandler } from '@/core/effect-template/TransitionEffectTemplateHandler'

class EffectTemplateHandlerRegistry {
  private readonly handlers = new Map<EffectType, EffectTemplateHandler>()

  register(handler: EffectTemplateHandler): void {
    this.handlers.set(handler.effectType, handler)
  }

  get(effectType: EffectType | undefined): EffectTemplateHandler | undefined {
    if (!effectType) {
      return undefined
    }
    return this.handlers.get(effectType)
  }
}

export const effectTemplateHandlerRegistry = new EffectTemplateHandlerRegistry()

effectTemplateHandlerRegistry.register(new TransitionEffectTemplateHandler())
