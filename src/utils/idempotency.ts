export function isDefinitiveOperationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const status = error.status
  const code = 'code' in error ? error.code : undefined
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    ![408, 425, 429].includes(status) &&
    code !== 'IDEMPOTENCY_OPERATION_IN_PROGRESS'
  )
}
