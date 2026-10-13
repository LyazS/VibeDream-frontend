import { beforeEach, expect, it, vi } from 'vitest'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createI18n } from 'vue-i18n'
import en from '../src/locales/en-US/aiPanel.json'
import zh from '../src/locales/zh-CN/aiPanel.json'
import enCommon from '../src/locales/en-US/common.json'
import zhCommon from '../src/locales/zh-CN/common.json'
import { getAgentErrorKey } from '../src/components/agent/agentErrorMessage'
import { AgentClientError } from '../src/core/agent/transport/AgentClient'
import MessageList from '../src/components/agent/MessageList.vue'
import SessionHistoryPanel from '../src/components/agent/SessionHistoryPanel.vue'
import ItemPropertyTestPanel from '../src/components/devtools/ItemPropertyTestPanel.vue'
import MediaSearchTestPanel from '../src/components/devtools/MediaSearchTestPanel.vue'
import TransitionTestPanel from '../src/components/devtools/TransitionTestPanel.vue'

const mocks = vi.hoisted(() => ({
  store: {
    agentMessages: [],
    agentRunning: false,
    agentModelCall: { status: 'failed', error: 'AGENT_IMAGE_URL_EXPIRED' },
    agentStorageError: '',
    agentHistoryLoading: false,
    agentSessionId: 'active',
    agentSessionHistory: [{ id: 'old', updatedAt: '2020-01-02T12:00:00Z', preview: 'history' }],
    projectId: '',
    tracks: [],
  },
}))
const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': { ...en, ...enCommon }, 'zh-CN': { ...zh, ...zhCommon } },
})
vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => mocks.store }))
vi.mock('@/core/composables/useI18n', () => ({ useAppI18n: () => i18n.global }))
vi.mock('@/constants/iconComponents', () => ({
  IconComponents: { SEARCH: 'span', COPY: 'span', HISTORY: 'span', REFRESH: 'span' },
}))
vi.mock('@/components/agent/AgentMessage.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/agent/UserMessage.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/agent/ThinkingIndicator.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/agent/InteractionCard.vue', () => ({ default: { render: () => null } }))
vi.mock('@/core/agent/services/itemPropertyService', () => ({ describeItemProperties: vi.fn() }))
vi.mock('@/core/agent/services/mediaIndexService', () => ({ searchMedia: vi.fn() }))
vi.mock('@/core/effect-template/TransitionTemplateCatalogService', () => ({
  transitionTemplateCatalogService: {},
}))
vi.mock('@/core/agent/tools/transitionTools', () => ({ executeApplyTransition: vi.fn() }))
vi.mock('@/core/agent/tools/transitionItemShared', () => ({
  getTrackItems: vi.fn(),
  resolveTransitionTemplate: vi.fn(),
}))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const wrapper = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return {
    NButton: wrapper,
    NRadioGroup: wrapper,
    NRadioButton: wrapper,
    NInputNumber: wrapper,
    NInput: defineComponent({
      props: ['placeholder'],
      setup: (props) => () => h('input', { placeholder: props.placeholder }),
    }),
    NSelect: defineComponent({
      props: ['options', 'placeholder'],
      setup: (props) => () =>
        h(
          'select',
          { 'aria-label': props.placeholder },
          (props.options ?? []).map((option: { label: string; value: string }) =>
            h('option', { value: option.value }, option.label),
          ),
        ),
    }),
  }
})

beforeEach(() => {
  i18n.global.locale.value = 'en-US'
  mocks.store.agentStorageError = ''
})

const render = (component: Component) => renderToString(createSSRApp(component))

it.each([
  ['CONNECTION_FAILED', 'connectionFailed'],
  ['MODEL_CALL_TIMEOUT', 'timeout'],
  ['AGENT_IMAGE_URL_EXPIRED', 'imageExpired'],
  ['AGENT_IMAGE_UPLOAD_FAILED', 'imageUploadFailed'],
  ['INSUFFICIENT_BALANCE', 'insufficientBalance'],
  ['IDENTITY_INVALID', 'loginRequired'],
  ['ACCOUNT_DISABLED', 'accountDisabled'],
])('translates error code %s in both languages without changing diagnostics', (code, key) => {
  const error = new AgentClientError(code, 'call', 'accepted')
  expect(getAgentErrorKey(error)).toBe(`aiPanel.errors.${key}`)
  expect(i18n.global.t(getAgentErrorKey(error))).not.toMatch(/\p{Script=Han}/u)
  i18n.global.locale.value = 'zh-CN'
  expect(i18n.global.t(getAgentErrorKey(error))).toMatch(/\p{Script=Han}/u)
  expect(error.message).toBe(code)
})

it('uses localized fallbacks for unknown errors and recognizes quota failures', () => {
  const fallback = 'aiPanel.errors.imageReadFailed'
  expect(getAgentErrorKey(new Error('无法读取对话图片'), fallback)).toBe(fallback)
  expect(getAgentErrorKey(null, fallback)).toBe(fallback)
  expect(getAgentErrorKey('toString', fallback)).toBe(fallback)
  expect(getAgentErrorKey(new DOMException('full', 'QuotaExceededError'))).toBe(
    'aiPanel.errors.storageQuotaExceeded',
  )
})

it('renders model and storage errors in the selected language', async () => {
  mocks.store.agentStorageError = '对话图片存储事务失败'
  let html = await render(MessageList)
  expect(html).toContain(en.aiPanel.errors.imageExpired)
  expect(html).toContain(en.aiPanel.errors.storageFailed)
  expect(html).not.toContain('AGENT_IMAGE_URL_EXPIRED')
  expect(html).not.toContain('对话图片存储事务失败')
  i18n.global.locale.value = 'zh-CN'
  html = await render(MessageList)
  expect(html).toContain(zh.aiPanel.errors.imageExpired)
  expect(html).toContain(zh.aiPanel.errors.storageFailed)
})

it('formats older history dates using the selected locale', async () => {
  const date = new Date(mocks.store.agentSessionHistory[0].updatedAt)
  expect(await render(SessionHistoryPanel)).toContain(date.toLocaleDateString('en-US'))
  i18n.global.locale.value = 'zh-CN'
  expect(await render(SessionHistoryPanel)).toContain(date.toLocaleDateString('zh-CN'))
})

it('renders test panel labels, presets, placeholders and notices in both languages', async () => {
  for (const language of ['en-US', 'zh-CN'] as const) {
    i18n.global.locale.value = language
    const messages = language === 'en-US' ? en.aiPanel.devtools : zh.aiPanel.devtools
    const property = await render(ItemPropertyTestPanel)
    expect(property).toContain(messages.property.title)
    expect(property).toContain(messages.property.presets.staticBasic)
    expect(property).toContain(messages.property.query)
    const media = await render(MediaSearchTestPanel)
    expect(media).toContain(messages.mediaSearch.placeholder)
    expect(media).toContain(messages.mediaSearch.openProject)
    const transition = await render(TransitionTestPanel)
    expect(transition).toContain(messages.transition.placeholder)
    expect(transition).toContain(messages.transition.noSeams)
    if (language === 'en-US') expect(property + media + transition).not.toMatch(/\p{Script=Han}/u)
  }
})

it('keeps error and test panel translation keys and parameters aligned', () => {
  function entries(value: object, prefix = ''): [string, string][] {
    return Object.entries(value).flatMap(([key, item]) =>
      typeof item === 'string' ? [[`${prefix}${key}`, item]] : entries(item, `${prefix}${key}.`),
    )
  }
  const english = entries({ errors: en.aiPanel.errors, devtools: en.aiPanel.devtools })
  const chinese = new Map(entries({ errors: zh.aiPanel.errors, devtools: zh.aiPanel.devtools }))
  expect(english.map(([key]) => key)).toEqual([...chinese.keys()])
  for (const [key, text] of english) {
    const params = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    expect(params(text), key).toEqual(params(chinese.get(key)!))
  }
})
