/**
 * 路径工具函数
 * 用于处理对象路径的读取和设置
 */
import { isRecord } from '@/utils/typeGuards'

function resolveParent(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return keys.reduce((current, key) => {
    const child = current[key]
    if (!child || typeof child !== 'object') {
      const next: Record<string, unknown> = {}
      current[key] = next
      return next
    }
    return child as Record<string, unknown>
  }, obj)
}

/**
 * 根据路径获取对象中的值
 * @param obj - 目标对象
 * @param path - 路径字符串，使用点号分隔（如 'a.b.c'）
 * @returns 路径对应的值，如果路径不存在则返回 undefined
 *
 * @example
 * const obj = { a: { b: { c: 1 } } }
 * getValueByPath(obj, 'a.b.c') // 返回 1
 * getValueByPath(obj, 'a.b') // 返回 { c: 1 }
 * getValueByPath(obj, 'x.y') // 返回 undefined
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined

  return path.split('.').reduce<unknown>((current, key) => {
    return current === null || current === undefined ? undefined : Reflect.get(Object(current), key)
  }, obj)
}

/**
 * 根据路径设置对象中的值
 * @param obj - 目标对象
 * @param path - 路径字符串，使用点号分隔（如 'a.b.c'）
 * @param value - 要设置的值
 *
 * @example
 * const obj = { a: { b: { c: 1 } } }
 * setValueByPath(obj, 'a.b.c', 2)
 * // obj 变为 { a: { b: { c: 2 } } }
 *
 * setValueByPath(obj, 'x.y.z', 3)
 * // obj 变为 { a: { b: { c: 2 } }, x: { y: { z: 3 } } }
 */
export function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!obj || !path) return

  const keys = path.split('.')
  const lastKey = keys.pop()!

  // 逐级创建不存在的对象
  const target = resolveParent(obj, keys)

  // 设置最终值
  target[lastKey] = value
}

/**
 * 检查路径是否存在于对象中
 * @param obj - 目标对象
 * @param path - 路径字符串
 * @returns 路径是否存在
 *
 * @example
 * const obj = { a: { b: { c: 1 } } }
 * hasPath(obj, 'a.b.c') // 返回 true
 * hasPath(obj, 'a.b.d') // 返回 false
 */
export function hasPath(obj: unknown, path: string): boolean {
  if (!obj || !path) return false

  const keys = path.split('.')
  let current = obj

  for (const key of keys) {
    if (
      !current ||
      (typeof current !== 'object' && typeof current !== 'function') ||
      !(key in current)
    ) {
      return false
    }
    current = Reflect.get(current, key)
  }

  return true
}

// ==================== 包装器结构支持 ====================

/**
 * 根据路径获取对象中的值（支持包装器结构）
 * @param obj - 目标对象
 * @param path - 路径字符串，使用点号分隔（如 'a.b.c'）
 * @returns 路径对应的值，如果路径不存在则返回 undefined
 *
 * @example
 * const obj = { a: { b: { c: { type: 'string', value: 'hello' } } } }
 * getValueByPathWithWrapper(obj, 'a.b.c') // 返回 'hello'
 */
export function getValueByPathWithWrapper(obj: unknown, path: string): unknown {
  const wrappedValue = getValueByPath(obj, path)

  // 如果值是包装器结构，返回其 value 字段
  if (wrappedValue && typeof wrappedValue === 'object' && 'value' in wrappedValue) {
    return wrappedValue.value
  }

  return wrappedValue
}

/**
 * 根据路径设置对象中的值（支持包装器结构）
 * @param obj - 目标对象
 * @param path - 路径字符串，使用点号分隔（如 'a.b.c'）
 * @param value - 要设置的值
 *
 * @example
 * const obj = { a: { b: { c: { type: 'string', value: 'hello' } } } }
 * setValueByPathWithWrapper(obj, 'a.b.c', 'world')
 * // obj 变为 { a: { b: { c: { type: 'string', value: 'world' } } } }
 */
export function setValueByPathWithWrapper(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.')
  const lastKey = keys.pop()!

  // 逐级创建不存在的对象
  const target = resolveParent(obj, keys)

  // 检查是否已存在包装器结构
  const existing = target[lastKey]
  if (isRecord(existing) && 'value' in existing) {
    // 更新现有包装器的 value
    existing.value = value
  } else {
    // 创建新的包装器结构
    target[lastKey] = { value }
  }
}

// ==================== Sora2 标签转换支持 ====================

/**
 * 解码 Sora2 提示词，将标签格式转换为 @value 格式
 * @param prompt - 包含标签的提示词（[[{JSON}]] 格式）
 * @returns 转换后的提示词（@value 格式）
 *
 * @example
 * decodeSora2Prompt('这是一个 [[{"label":"xxx人名","color":"#ef4444","value":"qwer.asdf"}]] 标签')
 * // 返回 '这是一个@qwer.asdf 标签'
 */
export function decodeSora2Prompt(prompt: string): string {
  if (!prompt) return ''

  // 正则匹配 [[{JSON}]] 格式的标签
  const tagRegex = /\[\[(.*?)\]\]/g
  let result = prompt
  let match

  while ((match = tagRegex.exec(prompt)) !== null) {
    try {
      // 解析 JSON 数据
      const tagData: unknown = JSON.parse(match[1])

      // 验证必需字段
      if (isRecord(tagData) && tagData.value) {
        // 替换为 @value 格式
        const replacement = `@${tagData.value} ` // 注意保留空格
        result = result.replace(match[0], replacement)
      }
    } catch (e) {
      // JSON 解析失败，保留原始文本
      console.warn('Failed to parse tag:', match[1], e)
    }
  }

  // 合并多个连续空格为一个空格
  return result.replace(/\s+/g, ' ')
}

/**
 * 扁平化 aiConfig（将包装器结构转换为简单结构）
 * 用于提交到后端时解包
 * @param wrappedConfig - 带包装器的配置对象
 * @returns 扁平化后的配置对象
 *
 * @example
 * const wrappedConfig = {
 *   prompt: { type: 'sora2prompt', value: '这是一个 [[{"label":"xxx","value":"qwer.asdf"}]] 标签' },
 *   images: { type: 'array', value: [] }
 * }
 * flattenAiConfig(wrappedConfig)
 * // 返回 { prompt: '这是一个@qwer.asdf 标签', images: [] }
 */
export function flattenAiConfig(wrappedConfig: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, wrappedValue] of Object.entries(wrappedConfig)) {
    if (isRecord(wrappedValue) && 'value' in wrappedValue) {
      const { type, value } = wrappedValue

      // 特殊处理 sora2prompt 类型
      if (type === 'sora2prompt' && typeof value === 'string') {
        result[key] = decodeSora2Prompt(value)
      } else {
        // 其他类型直接使用 value
        result[key] = value
      }
    } else {
      result[key] = wrappedValue
    }
  }

  return result
}
