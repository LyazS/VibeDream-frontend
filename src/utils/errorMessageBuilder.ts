import { TaskSubmitErrorCode } from '@/types/taskApi'
import { formatMoneyForDisplay } from '@/utils/money'

/**
 * 根据错误码和详细信息组装错误消息
 */
export function buildTaskErrorMessage(
  errorCode: TaskSubmitErrorCode,
  errorDetails: Record<string, any>,
  t: (key: string, params?: any) => string = (key) => key
): string {
  switch (errorCode) {
    case TaskSubmitErrorCode.INSUFFICIENT_BALANCE:
      return t('media.error.insufficientBalance', {
        current: formatMoneyForDisplay((errorDetails.current_balance as string | undefined) ?? '0'),
        required: formatMoneyForDisplay((errorDetails.required_amount as string | undefined) ?? '0'),
        shortage: formatMoneyForDisplay((errorDetails.shortage as string | undefined) ?? '0'),
      })

    case TaskSubmitErrorCode.INVALID_CONFIG:
      if (errorDetails.missing_fields?.length > 0) {
        return t('media.error.invalidConfigMissingFields', {
          fields: errorDetails.missing_fields.join(', '),
        })
      }
      return t('media.error.invalidConfig', {
        error: errorDetails.validation_error || '',
      })

    case TaskSubmitErrorCode.UNSUPPORTED_TASK_TYPE:
      return t('media.error.unsupportedTaskType', {
        type: errorDetails.requested_type || '',
      })

    case TaskSubmitErrorCode.USER_NOT_FOUND:
      return t('media.error.userNotFound')

    case TaskSubmitErrorCode.DATABASE_ERROR:
      if (errorDetails.error_type === 'connection') {
        return t('media.error.databaseConnection')
      } else if (errorDetails.error_type === 'conflict') {
        return t('media.error.databaseConflict')
      }
      return t('media.error.databaseError')

    case TaskSubmitErrorCode.INTERNAL_ERROR:
      return t('media.error.internalError')

    case TaskSubmitErrorCode.UNKNOWN_ERROR:
      return t('media.error.unknownError', {
        error: errorDetails.error || '',
      })

    default:
      return t('media.error.unknownError', {
        error: errorDetails.error || '',
      })
  }
}

/**
 * 判断是否应该显示充值引导
 */
export function shouldShowRechargePrompt(errorCode: TaskSubmitErrorCode): boolean {
  return errorCode === TaskSubmitErrorCode.INSUFFICIENT_BALANCE
}

/**
 * 判断是否可以重试
 */
export function isRetryableError(errorCode: TaskSubmitErrorCode): boolean {
  return [
    TaskSubmitErrorCode.DATABASE_ERROR,
    TaskSubmitErrorCode.INTERNAL_ERROR,
  ].includes(errorCode)
}
