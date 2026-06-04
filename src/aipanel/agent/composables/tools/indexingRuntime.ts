export interface ToolRuntimeI18nMessage {
  key: string
  params?: Record<string, unknown>
}

export interface IndexingRuntimeState {
  indexingTotalCount: number
  indexingResolvedCount: number
  indexingFailedCount: number
  indexingStatus: ToolRuntimeI18nMessage
}

export function createRuntimeI18nMessage(
  key: string,
  params?: Record<string, unknown>,
): ToolRuntimeI18nMessage {
  return { key, params }
}

export function buildIndexingStatusMessage(params: {
  resolvedCount: number
  totalCount: number
  failedCount: number
  idleKey: string
  progressKey: string
  completedKey?: string
}): ToolRuntimeI18nMessage {
  const {
    resolvedCount,
    totalCount,
    failedCount,
    idleKey,
    progressKey,
    completedKey,
  } = params

  if (totalCount <= 0) {
    return createRuntimeI18nMessage(idleKey)
  }

  if (resolvedCount < totalCount) {
    return createRuntimeI18nMessage(progressKey)
  }

  if (completedKey) {
    return createRuntimeI18nMessage(completedKey)
  }

  if (failedCount > 0) {
    return createRuntimeI18nMessage('aiPanel.toolsState.indexingFinishedWithFailure', {
      count: failedCount,
    })
  }

  return createRuntimeI18nMessage('aiPanel.toolsState.indexingFinished')
}
