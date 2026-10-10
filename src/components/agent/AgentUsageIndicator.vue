<template>
  <div class="agent-usage-anchor" @mouseenter="open" @mouseleave="scheduleClose">
    <button
      ref="trigger"
      type="button"
      class="agent-usage-button"
      :aria-label="`${t('aiPanel.usage.label')} · ${t('aiPanel.usage.context')} ${percentage}`"
      :aria-describedby="show ? tooltipId : undefined"
      @focus="open"
      @blur="scheduleClose"
      @click="open"
    >
      <svg class="usage-ring" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="usage-ring-track" cx="12" cy="12" r="9" />
        <circle
          v-if="context.ratio !== null && context.ratio > 0"
          class="usage-ring-value"
          cx="12"
          cy="12"
          r="9"
          pathLength="100"
          :stroke-dasharray="`${context.ratio * 100} 100`"
        />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="usage-tooltip">
        <div
          v-if="show"
          :id="tooltipId"
          ref="tooltip"
          class="agent-usage-detail"
          role="tooltip"
          :style="position"
          @mouseenter="open"
          @mouseleave="scheduleClose"
        >
          <div class="usage-heading">{{ t('aiPanel.usage.session') }}</div>
          <dl>
            <dt>{{ t('aiPanel.usage.input') }}</dt>
            <dd>{{ formatTokens(store.agentUsage.inputTokens) }}</dd>
            <dt>{{ t('aiPanel.usage.output') }}</dt>
            <dd>{{ formatTokens(store.agentUsage.outputTokens) }}</dd>
            <dt>{{ t('aiPanel.usage.cached') }}</dt>
            <dd>{{ formatTokens(store.agentUsage.cachedInputTokens) }}</dd>
            <dt>{{ t('aiPanel.usage.context') }}</dt>
            <dd>{{ percentage }}</dd>
            <dt>{{ t('aiPanel.usage.contextTokens') }}</dt>
            <dd>
              {{ context.usedTokens === null ? '--' : formatCount(context.usedTokens) }}
              <span class="usage-muted"
                >/
                {{
                  context.limitTokens === null ? '--' : formatCount(context.limitTokens)
                }}
                Token</span
              >
            </dd>
            <dt class="usage-fee">{{ t('aiPanel.usage.cost') }}</dt>
            <dd class="usage-fee">{{ cost }}</dd>
          </dl>
          <div v-if="incomplete" class="usage-note usage-incomplete">
            {{ t('aiPanel.usage.incomplete') }}
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import type { UsageTotal } from '@/core/agent/runtime/AgentUsage'

const store = useUnifiedStore()
const { t, locale } = useAppI18n()
const tooltipId = useId()
const show = ref(false)
const trigger = ref<HTMLButtonElement>()
const tooltip = ref<HTMLDivElement>()
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })
let closeTimer: ReturnType<typeof setTimeout> | undefined
const context = computed(() => store.agentContextUsage)
const percentage = computed(() =>
  context.value.ratio === null
    ? t('aiPanel.usage.unknown')
    : new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(
        context.value.ratio,
      ),
)
const incomplete = computed(() => Object.values(store.agentUsage).some((total) => !total.complete))
const cost = computed(() => {
  const total = store.agentUsage.chargedAmount
  if (total.value === null) return '--'
  const [whole, fraction = ''] = total.value.split('.')
  return `${total.complete ? '' : '≥ '}¥${whole}.${fraction.padEnd(2, '0')}`
})
function formatCount(value: number) {
  return new Intl.NumberFormat(locale.value).format(value)
}
function formatTokens(total: UsageTotal<number>) {
  if (total.value === null) return '--'
  return `${total.complete ? '' : '≥ '}${formatCount(total.value)}`
}
function updatePosition() {
  if (!show.value || !trigger.value || !tooltip.value) return
  const button = trigger.value.getBoundingClientRect()
  const detail = tooltip.value.getBoundingClientRect()
  const left = Math.max(
    12,
    Math.min(button.right - detail.width, window.innerWidth - detail.width - 12),
  )
  const above = button.top - detail.height - 8
  const top =
    above >= 12
      ? above
      : Math.max(12, Math.min(button.bottom + 8, window.innerHeight - detail.height - 12))
  position.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
}
function open() {
  clearTimeout(closeTimer)
  if (!show.value) position.value.visibility = 'hidden'
  show.value = true
}
function close() {
  clearTimeout(closeTimer)
  show.value = false
}
function scheduleClose() {
  clearTimeout(closeTimer)
  if (document.activeElement === trigger.value) return
  closeTimer = setTimeout(close, 120)
}
function handlePointerDown(event: PointerEvent) {
  if (
    !trigger.value?.contains(event.target as Node) &&
    !tooltip.value?.contains(event.target as Node)
  )
    close()
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
watch(
  [show, () => store.agentUsage, context],
  async () => {
    await nextTick()
    updatePosition()
  },
  { deep: true },
)
onMounted(() => {
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  clearTimeout(closeTimer)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', handlePointerDown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.agent-usage-anchor {
  position: absolute;
  right: 10px;
  top: 2px;
  width: 40px;
  height: 40px;
}
.agent-usage-button {
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}
.agent-usage-button:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}
.usage-ring {
  width: 22px;
  height: 22px;
  fill: none;
  stroke-width: 3;
}
.usage-ring-track {
  stroke: rgba(255, 255, 255, 0.12);
}
.usage-ring-value {
  stroke: currentColor;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dasharray 180ms ease;
}
.agent-usage-detail {
  position: fixed;
  z-index: 3000;
  box-sizing: border-box;
  width: 296px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 14px 16px;
  border-radius: var(--border-radius-large);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.3),
    0 3px 10px rgba(0, 0, 0, 0.18);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.usage-muted,
.usage-note,
dt,
.usage-heading {
  color: var(--color-text-tertiary);
}
.usage-note {
  font-size: 11px;
}
.usage-heading {
  margin-bottom: 8px;
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 12px;
  margin: 0;
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.usage-fee {
  margin-top: 4px;
  padding-top: 8px;
  box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.06);
}
.usage-incomplete {
  margin-top: 8px;
}
.usage-tooltip-enter-active,
.usage-tooltip-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}
.usage-tooltip-enter-from,
.usage-tooltip-leave-to {
  opacity: 0;
  transform: translateY(3px);
}
@media (prefers-reduced-motion: reduce) {
  .usage-ring-value,
  .usage-tooltip-enter-active,
  .usage-tooltip-leave-active {
    transition: none;
  }
}
</style>
