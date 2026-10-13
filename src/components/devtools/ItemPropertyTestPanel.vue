<template>
  <section class="property-panel" :aria-label="t('aiPanel.devtools.property.title')">
    <form class="query-form" @submit.prevent="runQuery">
      <n-radio-group
        v-model:value="usage"
        class="usage-switch"
        :disabled="loading"
        :aria-label="t('aiPanel.devtools.property.usage')"
      >
        <n-radio-button value="static_edit">{{
          t('aiPanel.devtools.property.static')
        }}</n-radio-button>
        <n-radio-button value="keyframe_edit">{{
          t('aiPanel.devtools.property.keyframe')
        }}</n-radio-button>
        <n-radio-button value="transition_edit">{{
          t('aiPanel.devtools.property.transition')
        }}</n-radio-button>
      </n-radio-group>

      <label v-if="usage === 'transition_edit'" class="field">
        <span>{{ t('aiPanel.devtools.property.templateId') }}</span>
        <n-input
          v-model:value="templateId"
          :disabled="loading"
          placeholder="gl-bow-tie-with-parameter"
          clearable
          :input-props="{ 'aria-label': t('aiPanel.devtools.property.templateId') }"
        />
      </label>
      <label class="field">
        <span>{{ t('aiPanel.devtools.property.propertyId') }}</span>
        <n-input
          v-model:value="propertyText"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          :disabled="loading"
          placeholder="visual.position.x"
          :input-props="{
            'aria-label': t('aiPanel.devtools.property.propertyId'),
            spellcheck: false,
          }"
        />
      </label>
      <div class="query-actions">
        <n-select
          v-model:value="presetId"
          :options="presetOptions"
          :disabled="loading"
          :placeholder="t('aiPanel.devtools.property.example')"
          :aria-label="t('aiPanel.devtools.property.examples')"
          @update:value="applyPreset"
        />
        <n-button type="primary" attr-type="submit" :loading="loading" :disabled="!canQuery">
          <template #icon><component :is="IconComponents.SEARCH" size="16px" /></template>
          {{ t('aiPanel.devtools.property.query') }}
        </n-button>
      </div>
    </form>

    <p v-if="error" class="notice error" role="alert">{{ t(error) }}</p>
    <div v-if="response" class="response-summary" role="status">
      <span>HTTP {{ httpStatus }}</span>
      <span v-if="!response.error">{{
        t('aiPanel.devtools.property.resultCount', { success: successCount, total: results.length })
      }}</span>
      <span>{{ elapsedMs }} ms</span>
    </div>
    <p v-if="response?.error" class="notice error" role="alert">
      {{ t(getAgentErrorKey(response.error, 'aiPanel.devtools.property.queryFailed')) }}
    </p>

    <ol v-if="results.length" class="result-list">
      <li v-for="item in results" :key="item.requestedPropertyId" class="result-item">
        <div class="result-heading">
          <code>{{ item.requestedPropertyId }}</code>
          <component
            :is="item.success ? IconComponents.SUCCESS : IconComponents.ERROR"
            :class="item.success ? 'success' : 'error'"
            size="17px"
            :aria-label="t(item.success ? 'aiPanel.devtools.success' : 'aiPanel.devtools.failure')"
          />
        </div>
        <p v-if="!item.success" class="notice error">
          {{ t(getAgentErrorKey(item.error, 'aiPanel.devtools.property.lookupFailed')) }}
        </p>
        <template v-else>
          <dl class="property-details">
            <dt>{{ t('aiPanel.devtools.property.resolvedId') }}</dt>
            <dd>
              <code>{{ item.resolvedPropertyId }}</code>
            </dd>
            <dt>{{ t('aiPanel.devtools.property.type') }}</dt>
            <dd>{{ item.valueType || '-' }}</dd>
            <dt>{{ t('aiPanel.devtools.property.group') }}</dt>
            <dd>{{ item.groupId }}</dd>
            <dt>{{ t('aiPanel.devtools.property.editable') }}</dt>
            <dd>{{ t(item.editable ? 'aiPanel.devtools.yes' : 'aiPanel.devtools.no') }}</dd>
            <dt>{{ t('aiPanel.devtools.property.animatable') }}</dt>
            <dd>{{ t(item.animatable ? 'aiPanel.devtools.yes' : 'aiPanel.devtools.no') }}</dd>
            <template v-if="item.componentHint">
              <dt>{{ t('aiPanel.devtools.property.component') }}</dt>
              <dd>
                <code>{{ item.componentHint }}</code>
              </dd>
            </template>
            <template v-if="item.valueShape">
              <dt>{{ t('aiPanel.devtools.property.valueShape') }}</dt>
              <dd>
                <code>{{ formatValue(item.valueShape) }}</code>
              </dd>
            </template>
            <template v-for="key in parameterKeys" :key="key">
              <template v-if="item[key] !== undefined && item[key] !== null">
                <dt>{{ t(`aiPanel.devtools.property.parameters.${key}`) }}</dt>
                <dd>
                  <code>{{ formatValue(item[key]) }}</code>
                </dd>
              </template>
            </template>
          </dl>
          <p class="description">{{ item.description }}</p>
          <ul v-if="item.constraints?.length" class="constraints">
            <li v-for="constraint in item.constraints" :key="constraint">{{ constraint }}</li>
          </ul>
        </template>
      </li>
    </ol>

    <div v-if="response" class="raw-section">
      <details>
        <summary>{{ t('aiPanel.devtools.property.rawResponse') }}</summary>
        <pre>{{ responseJson }}</pre>
      </details>
      <details>
        <summary>{{ t('aiPanel.devtools.property.request') }}</summary>
        <pre>{{ requestJson }}</pre>
        <p v-if="requestId" class="request-id">
          {{ t('aiPanel.devtools.property.requestId', { id: requestId }) }}
        </p>
      </details>
      <div class="copy-actions">
        <n-button
          quaternary
          :title="t('aiPanel.devtools.property.copy')"
          :aria-label="t('aiPanel.devtools.property.copy')"
          @click="copyResponse"
        >
          <template #icon><component :is="IconComponents.COPY" size="16px" /></template>
        </n-button>
        <span v-if="copyMessage" role="status">{{ t(copyMessage) }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NInput, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from '@/components/agent/agentErrorMessage'
import {
  describeItemProperties,
  type ItemPropertyRequest,
  type ItemPropertyResponse,
  type ItemPropertyUsage,
} from '@/core/agent/services/itemPropertyService'

const { t } = useAppI18n()
const presets = {
  static_edit: [
    {
      label: 'staticBasic',
      value: 'basic',
      ids: ['visual.position.x', 'visual.rotation', 'audio.volume'],
    },
    { label: 'mixed', value: 'mixed', ids: ['visual.position.x', 'unknown.property'] },
    {
      label: 'normalize',
      value: 'normalize',
      ids: [' visual.position.x ', 'visual.position.x', 'audio.volume'],
    },
  ],
  keyframe_edit: [
    {
      label: 'keyframeBasic',
      value: 'basic',
      ids: ['visual.position.y', 'mask.ellipse.size.height', 'audio.volume'],
    },
    {
      label: 'nonAnimatable',
      value: 'mixed',
      ids: ['audio.isMuted', 'text.content', 'visual.rotation'],
    },
  ],
  transition_edit: [
    {
      label: 'transitionBasic',
      value: 'basic',
      templateId: 'gl-bow-tie-with-parameter',
      ids: [
        'timeline.bindingState',
        'transition.duration',
        'transition.params.adjust',
        'transition.params.reverse',
      ],
    },
    {
      label: 'hidden',
      value: 'hidden',
      templateId: 'parameterized-demo',
      ids: ['timeline.start', 'transition.duration'],
    },
    {
      label: 'missing',
      value: 'missing',
      templateId: 'does-not-exist',
      ids: ['timeline.start'],
    },
  ],
}
const usage = ref<ItemPropertyUsage>('static_edit')
const presetId = ref<string | null>('basic')
const propertyText = ref(presets.static_edit[0].ids.join('\n'))
const templateId = ref('gl-bow-tie-with-parameter')
const loading = ref(false)
const response = ref<ItemPropertyResponse | null>(null)
const lastRequest = ref<ItemPropertyRequest | null>(null)
const error = ref('')
const copyMessage = ref('')
const httpStatus = ref(0)
const elapsedMs = ref(0)
const requestId = ref('')
let controller: AbortController | undefined

const propertyIds = computed(() => propertyText.value.split(/[\r\n,，]/).filter((id) => id.trim()))
const canQuery = computed(
  () =>
    propertyIds.value.length > 0 &&
    (usage.value !== 'transition_edit' || !!templateId.value.trim()),
)
const presetOptions = computed(() =>
  presets[usage.value].map(({ label, value }) => ({
    label: t(`aiPanel.devtools.property.presets.${label}`),
    value,
  })),
)
const results = computed(() => response.value?.propertyDescriptions ?? [])
const successCount = computed(() => results.value.filter((item) => item.success).length)
const responseJson = computed(() => JSON.stringify(response.value, null, 2))
const requestJson = computed(() => JSON.stringify(lastRequest.value, null, 2))
const parameterKeys = ['default', 'min', 'max', 'step', 'options'] as const

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function applyPreset(value: string | null): void {
  const preset = presets[usage.value].find((item) => item.value === value)
  if (!preset) return
  propertyText.value = preset.ids.join('\n')
  if ('templateId' in preset && typeof preset.templateId === 'string') {
    templateId.value = preset.templateId
  }
}

watch(usage, () => {
  presetId.value = 'basic'
  applyPreset('basic')
  response.value = null
  error.value = ''
  copyMessage.value = ''
})

async function runQuery(): Promise<void> {
  if (!canQuery.value || loading.value) return
  const body: ItemPropertyRequest = { usage: usage.value, propertyIds: [...propertyIds.value] }
  if (usage.value === 'transition_edit') body.templateId = templateId.value
  lastRequest.value = body
  response.value = null
  error.value = ''
  copyMessage.value = ''
  loading.value = true
  controller = new AbortController()
  const activeController = controller
  const started = performance.now()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    activeController.abort()
  }, 30_000)
  try {
    const result = await describeItemProperties(body, { signal: activeController.signal })
    response.value = result.data
    httpStatus.value = result.status
    requestId.value = result.headers.get('x-request-id') ?? ''
  } catch (cause) {
    if (!activeController.signal.aborted || timedOut) console.error('Property query failed:', cause)
    if (timedOut) error.value = 'aiPanel.devtools.requestTimeout'
    else if (!activeController.signal.aborted)
      error.value = getAgentErrorKey(cause, 'aiPanel.devtools.property.queryFailed')
  } finally {
    clearTimeout(timeout)
    elapsedMs.value = Math.round(performance.now() - started)
    loading.value = false
    controller = undefined
  }
}

async function copyResponse(): Promise<void> {
  try {
    await navigator.clipboard.writeText(responseJson.value)
    copyMessage.value = 'aiPanel.devtools.copied'
  } catch {
    copyMessage.value = 'aiPanel.devtools.copyFailed'
  }
}

onUnmounted(() => controller?.abort())
</script>

<style scoped>
.property-panel {
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
  color: var(--color-text-primary);
  font-size: 12px;
}
.query-form,
.field {
  display: grid;
  gap: var(--spacing-sm);
  min-width: 0;
}
.query-form {
  gap: var(--spacing-md);
}
.usage-switch {
  display: flex;
  width: 100%;
}
.usage-switch :deep(.n-radio-button) {
  flex: 1;
  text-align: center;
}
.query-actions,
.response-summary,
.result-heading,
.copy-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.query-actions :deep(.n-select) {
  flex: 1;
  min-width: 0;
}
.query-actions :deep(.n-button) {
  flex-shrink: 0;
  min-height: 40px;
}
.response-summary {
  flex-wrap: wrap;
  margin: var(--spacing-md) 0;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.result-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.result-item {
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border);
}
.result-heading {
  justify-content: space-between;
  align-items: flex-start;
  font-weight: 600;
}
.result-heading > svg {
  flex-shrink: 0;
}
.property-details {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr);
  gap: 6px var(--spacing-sm);
  margin: var(--spacing-sm) 0;
}
.property-details dt {
  color: var(--color-text-secondary);
}
.property-details dd {
  margin: 0;
  min-width: 0;
}
.notice,
.description {
  margin: var(--spacing-sm) 0;
  line-height: 1.6;
  text-wrap: pretty;
}
.constraints {
  margin: var(--spacing-sm) 0 0;
  padding-left: 18px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.success {
  color: var(--color-success);
}
.error {
  color: var(--color-error);
}
code,
pre,
.request-id {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.raw-section {
  margin-top: var(--spacing-md);
  border-top: 1px solid var(--color-border);
}
summary {
  cursor: pointer;
  min-height: 40px;
  display: flex;
  align-items: center;
}
summary::before {
  content: '+';
  margin-right: 8px;
}
details[open] > summary::before {
  content: '-';
}
pre {
  margin: 0 0 var(--spacing-sm);
  white-space: pre-wrap;
  line-height: 1.5;
  font-size: 11px;
}
.copy-actions {
  color: var(--color-text-secondary);
}
.copy-actions :deep(.n-button) {
  width: 40px;
  height: 40px;
}
</style>
