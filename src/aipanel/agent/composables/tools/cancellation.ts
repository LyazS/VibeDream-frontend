const cancellationHooks = new Map<string, () => Promise<void> | void>()

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

export async function cancelToolExecution(
  toolName: string,
  toolCallId: string,
): Promise<boolean> {
  const hook = cancellationHooks.get(buildExecutionKey(toolName, toolCallId))
  if (!hook) {
    return false
  }
  await hook()
  return true
}

export function hasToolCancellationHook(toolName: string, toolCallId: string): boolean {
  return cancellationHooks.has(buildExecutionKey(toolName, toolCallId))
}
