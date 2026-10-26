const cancellationHooks = new Map<string, () => Promise<void> | void>()
const batchCancellationHooks = new Map<string, () => void>()

export function registerToolBatchCancellation(
  toolName: string,
  toolCallId: string,
  hook: () => void,
) {
  const key = buildExecutionKey(toolName, toolCallId)
  batchCancellationHooks.set(key, hook)
  return () => {
    if (batchCancellationHooks.get(key) === hook) batchCancellationHooks.delete(key)
  }
}

function buildExecutionKey(toolName: string, toolCallId: string): string {
  return `${toolName}:${toolCallId}`
}

export function registerToolCancellationHook(
  toolName: string,
  toolCallId: string,
  hook: () => Promise<void> | void,
): void {
  cancellationHooks.set(buildExecutionKey(toolName, toolCallId), hook)
}

export function unregisterToolCancellationHook(toolName: string, toolCallId: string): void {
  cancellationHooks.delete(buildExecutionKey(toolName, toolCallId))
}

export async function cancelToolExecution(toolName: string, toolCallId: string): Promise<boolean> {
  const hook = cancellationHooks.get(buildExecutionKey(toolName, toolCallId))
  if (!hook) {
    return false
  }
  batchCancellationHooks.get(buildExecutionKey(toolName, toolCallId))?.()
  await hook()
  return true
}

export function hasToolCancellationHook(toolName: string, toolCallId: string): boolean {
  return cancellationHooks.has(buildExecutionKey(toolName, toolCallId))
}
