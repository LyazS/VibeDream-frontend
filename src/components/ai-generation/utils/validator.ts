/**
 * AI 配置验证工具
 * 用于验证 AI 配置表单的字段是否满足要求
 */

import type {
  UIConfig,
  ValidationResult,
  FieldValidationError,
  TextareaInputConfig,
  FileInputConfig,
  NumberInputConfig,
  SelectInputConfig,
} from '@/core/datasource/providers/ai-generation/types'
import { ValidationErrorType } from '@/core/datasource/providers/ai-generation/types'
import { getValueByPathWithWrapper } from './pathUtils'

/**
 * 验证整个 AI 配置
 * @param uiConfig UI配置数组
 * @param aiConfig AI配置对象
 * @param locale 当前语言
 * @returns 验证结果
 */
export function validateAiConfig(
  uiConfig: UIConfig[],
  aiConfig: Record<string, unknown>,
  _locale: 'zh' | 'en',
): ValidationResult {
  const errors: FieldValidationError[] = []

  // 遍历所有字段配置进行验证
  for (const fieldConfig of uiConfig) {
    const fieldErrors = validateField(fieldConfig, aiConfig)
    errors.push(...fieldErrors)
  }

  // 构建按路径索引的错误映射
  const errorsByPath = new Map<string, FieldValidationError>()
  errors.forEach((error) => {
    errorsByPath.set(error.path, error)
  })

  return {
    isValid: errors.length === 0,
    errors,
    errorsByPath,
  }
}

/**
 * 验证单个字段
 * @param fieldConfig 字段配置
 * @param aiConfig AI配置对象
 * @param locale 当前语言
 * @returns 该字段的错误列表
 */
export function validateField(
  fieldConfig: UIConfig,
  aiConfig: Record<string, unknown>,
): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  const normalizedPath = normalizePath(fieldConfig.path)
  const value = getValueByPathWithWrapper(aiConfig, normalizedPath)

  // 根据字段类型执行不同的验证
  switch (fieldConfig.type) {
    case 'textarea-input':
      errors.push(...validateTextareaField(fieldConfig, value))
      break
    case 'file-input':
      errors.push(...validateFileInputField(fieldConfig, value))
      break
    case 'number-input':
      errors.push(...validateNumberField(fieldConfig, value))
      break
    case 'select-input':
      errors.push(...validateSelectField(fieldConfig, value))
      break
  }

  return errors
}

/**
 * 规范化路径 - 移除 'aiConfig.' 前缀
 */
function normalizePath(path: string): string {
  return path.startsWith('aiConfig.') ? path.substring(9) : path
}

/**
 * 验证文本域字段
 */
function validateTextareaField(
  config: TextareaInputConfig,
  value: unknown,
): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  const stringValue = String(value || '').trim()

  // 必填验证
  if (config.required && !stringValue) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.REQUIRED,
      message: {
        zh: '此字段为必填项',
        en: 'This field is required',
      },
    })
    return errors // 如果必填验证失败，不再进行其他验证
  }

  // 如果字段为空且不是必填，跳过其他验证
  if (!stringValue) {
    return errors
  }

  // 最小长度验证
  if (config.minLength && stringValue.length < config.minLength) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MIN_LENGTH,
      message: {
        zh: `至少需要 ${config.minLength} 个字符`,
        en: `At least ${config.minLength} characters required`,
      },
    })
  }

  // 最大长度验证
  if (config.maxLength && stringValue.length > config.maxLength) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MAX_LENGTH,
      message: {
        zh: `最多允许 ${config.maxLength} 个字符`,
        en: `Maximum ${config.maxLength} characters allowed`,
      },
    })
  }

  return errors
}

/**
 * 验证文件输入字段
 */
function validateFileInputField(config: FileInputConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  const fileArray = Array.isArray(value) ? value : []
  const fileCount = fileArray.length

  // 最小文件数验证
  if (config.minFiles && fileCount < config.minFiles) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MIN_FILES,
      message: {
        zh: `至少需要 ${config.minFiles} 个文件`,
        en: `At least ${config.minFiles} file(s) required`,
      },
    })
  }

  // 最大文件数验证
  if (config.maxFiles && fileCount > config.maxFiles) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MAX_FILES,
      message: {
        zh: `最多允许 ${config.maxFiles} 个文件`,
        en: `Maximum ${config.maxFiles} file(s) allowed`,
      },
    })
  }

  return errors
}

/**
 * 验证数字字段
 */
function validateNumberField(config: NumberInputConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  const numValue = Number(value)

  // 必填验证（数字字段通常有默认值，较少使用）
  if (config.required && (value === null || value === undefined || isNaN(numValue))) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.REQUIRED,
      message: {
        zh: '此字段为必填项',
        en: 'This field is required',
      },
    })
    return errors
  }

  // 如果值无效，跳过其他验证
  if (isNaN(numValue)) {
    return errors
  }

  // 最小值验证
  if (numValue < config.min) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MIN_VALUE,
      message: {
        zh: `值不能小于 ${config.min}`,
        en: `Value cannot be less than ${config.min}`,
      },
    })
  }

  // 最大值验证
  if (numValue > config.max) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.MAX_VALUE,
      message: {
        zh: `值不能大于 ${config.max}`,
        en: `Value cannot be greater than ${config.max}`,
      },
    })
  }

  return errors
}

/**
 * 验证选择字段
 */
function validateSelectField(config: SelectInputConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = []

  // 必填验证
  if (config.required && (value === null || value === undefined || value === '')) {
    errors.push({
      path: config.path,
      fieldLabel: config.label,
      errorType: ValidationErrorType.REQUIRED,
      message: {
        zh: '请选择一个选项',
        en: 'Please select an option',
      },
    })
  }

  return errors
}
