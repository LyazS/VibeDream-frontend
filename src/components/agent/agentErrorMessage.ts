const errorKeys: Readonly<Record<string, string>> = {
  CONNECTION_FAILED: 'connectionFailed',
  CONNECTION_LOST: 'connectionLost',
  CONNECTION_TIMEOUT: 'timeout',
  HEARTBEAT_TIMEOUT: 'connectionLost',
  MODEL_CALL_TIMEOUT: 'timeout',
  CANCEL_TIMEOUT: 'timeout',
  MODEL_CALL_BUSY: 'busy',
  MODEL_CALL_CANCELLED: 'cancelled',
  MODEL_CALL_INTERRUPTED: 'interrupted',
  MODEL_CALL_ALREADY_EXISTS: 'callConflict',
  MODEL_CALL_ID_CONFLICT: 'callConflict',
  MODEL_PROVIDER_FAILED: 'modelFailed',
  MODEL_RESPONSE_INVALID: 'modelFailed',
  IDENTITY_INVALID: 'loginRequired',
  IDENTITY_CHANGED: 'loginRequired',
  UNAUTHENTICATED: 'loginRequired',
  INSUFFICIENT_BALANCE: 'insufficientBalance',
  ACCOUNT_DISABLED: 'accountDisabled',
  AGENT_IMAGE_URL_EXPIRED: 'imageExpired',
  AGENT_IMAGE_UPLOAD_FAILED: 'imageUploadFailed',
  AGENT_NOT_CONFIGURED: 'unavailable',
  AGENT_KEY_NOT_CONFIGURED: 'unavailable',
  AGENT_BILLING_CONFIG_INVALID: 'unavailable',
  AGENT_BILLING_PRICE_MISSING: 'unavailable',
  PROTOCOL_INVALID: 'protocolInvalid',
  PROTOCOL_VERSION_UNSUPPORTED: 'protocolInvalid',
  REQUEST_INVALID: 'requestInvalid',
  PROJECT_ID_INVALID: 'projectNotReady',
  PROJECT_NOT_READY: 'projectNotReady',
  ORIGIN_NOT_ALLOWED: 'originNotAllowed',
  QuotaExceededError: 'storageQuotaExceeded',
}

/** Keep diagnostics intact; only translate the message shown by the interface. */
export function getAgentErrorKey(
  error: unknown,
  fallback = 'aiPanel.errors.requestFailed',
): string {
  const code =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : error instanceof Error
          ? error.name === 'QuotaExceededError'
            ? error.name
            : error.message
          : ''
  const key = Object.prototype.hasOwnProperty.call(errorKeys, code) ? errorKeys[code] : undefined
  return key ? `aiPanel.errors.${key}` : fallback
}
