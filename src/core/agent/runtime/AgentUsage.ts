import { addMoney, type MoneyString } from '@/utils/money'

export type AgentTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
}

export type AgentUsageRecord = {
  usage: AgentTokenUsage | null
  chargedAmount: MoneyString | null
  contextWindowTokens?: number
}

export type UsageTotal<T> = { value: T | null; complete: boolean }

/** 使用最近一次可确认的上下文快照，而非累计消耗；新调用执行时保留最近的测量值。 */
export function getAgentContextUsage(
  records: Record<string, AgentUsageRecord>,
  latestCallId?: string,
) {
  const candidates = Object.values(records).reverse()
  if (latestCallId && records[latestCallId]) candidates.unshift(records[latestCallId])
  const latest = candidates.find(
    (record) =>
      record.usage !== null &&
      record.usage.totalTokens > 0 &&
      Number.isSafeInteger(record.contextWindowTokens) &&
      Number(record.contextWindowTokens) > 0,
  )
  const usedTokens = latest?.usage?.totalTokens ?? null
  const limitTokens = latest?.contextWindowTokens ?? null
  return {
    usedTokens,
    limitTokens,
    ratio:
      usedTokens !== null && limitTokens !== null
        ? Math.min(1, Math.max(0, usedTokens / limitTokens))
        : null,
  }
}

/** 缺失数据保留为未知；缓存是输入的子集，费用只累加服务端结算金额。 */
export function summarizeAgentUsage(records: Record<string, AgentUsageRecord>) {
  const values = Object.values(records)
  const sumTokens = (field: 'inputTokens' | 'outputTokens' | 'cachedInputTokens') => {
    const known = values.flatMap((record) => {
      const value = record.usage?.[field]
      return value === undefined ? [] : [value]
    })
    return {
      value: values.length && !known.length ? null : known.reduce((sum, value) => sum + value, 0),
      complete: known.length === values.length,
    } satisfies UsageTotal<number>
  }
  const charges = values.flatMap((record) =>
    record.chargedAmount === null ? [] : [record.chargedAmount],
  )
  return {
    inputTokens: sumTokens('inputTokens'),
    outputTokens: sumTokens('outputTokens'),
    cachedInputTokens: sumTokens('cachedInputTokens'),
    chargedAmount: {
      value: values.length && !charges.length ? null : charges.reduce(addMoney, '0'),
      complete: charges.length === values.length,
    } satisfies UsageTotal<MoneyString>,
  }
}
