/**
 * BizyAir 请求构建器
 *
 * 将用户配置转换为 BizyAir API 请求格式，支持 input_mapping 参数映射。
 * 处理三种参数类型：string/number/boolean（基本类型）、array（数组类型）、arrayurl（URL 数组类型）。
 *
 * @module BizyAirRequestBuilder
 */

import type { BizyAirAppConfig, InputMappingItem, ArrayMappingItem, ArrayUrlMappingItem } from './types'

/**
 * 扩展的映射项接口，支持更多配置选项
 */
interface ExtendedMappingItem extends InputMappingItem {
  /** 是否跳过 API 映射（不发送到后端） */
  skip_mapping?: boolean
  /** 数组元素配置（仅当 type 为 'array' 时） */
  items?: InputMappingItem[]
  /** URL 分隔符（仅当 type 为 'arrayurl' 时） */
  separator?: string
}

/**
 * 扩展的输入映射接口
 */
interface ExtendedInputMapping {
  [key: string]: InputMappingItem | ArrayMappingItem | ArrayUrlMappingItem
}

/**
 * BizyAir 请求构建器类
 *
 * 提供静态方法用于构建 BizyAir API 请求数据。
 */
export class BizyAirRequestBuilder {
  /**
   * 构建请求数据（处理 input_mapping）
   *
   * 根据 appConfig.input_mapping 配置，将用户输入映射到 BizyAir 工作流节点。
   * 支持三种参数类型：
   * - string/number/boolean: 基本类型，直接使用值
   * - array: 数组类型，遍历数组元素并分别映射
   * - arrayurl: URL 数组类型，使用分隔符拼接成字符串
   *
   * @param taskConfig - 用户任务配置（包含用户输入的参数）
   * @param appConfig - BizyAir 应用配置（包含 input_mapping 和 web_app_id）
   * @returns BizyAir API 请求数据
   *
   * @example
   * ```typescript
   * const taskConfig = {
   *   prompt: "A beautiful sunset",
   *   negative_prompt: "blurry, low quality",
   *   width: 1280,
   *   height: 720,
   *   ref_images: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"]
   * }
   *
   * const appConfig: BizyAirAppConfig = {
   *   config_id: "ltx-2",
   *   config_name: "LTX-2 Video Generation",
   *   app_id: "ltx-2",
   *   web_app_id: "12345",
   *   input_mapping: {
   *     prompt: { path: "121:CLIPTextEncode.text", type: "string" },
   *     negative_prompt: { path: "122:CLIPTextEncode.text", type: "string" },
   *     width: { path: "121:KSamplerAdvanced.width", type: "number" },
   *     height: { path: "121:KSamplerAdvanced.height", type: "number" },
   *     ref_images: { path: "123:ImageLoader.images", type: "arrayurl", separator: "\n" }
   *   },
   *   async_task: true
   * }
   *
   * const requestData = BizyAirRequestBuilder.build(taskConfig, appConfig)
   * // 结果:
   * // {
   * //   web_app_id: "12345",
   * //   suppress_preview_output: false,
   * //   input_values: {
   * //     "121:CLIPTextEncode.text": "A beautiful sunset",
   * //     "122:CLIPTextEncode.text": "blurry, low quality",
   * //     "121:KSamplerAdvanced.width": 1280,
   * //     "121:KSamplerAdvanced.height": 720,
   * //     "123:ImageLoader.images": "https://example.com/img1.jpg\nhttps://example.com/img2.jpg"
   * //   }
   * // }
   * ```
   */
  static build(
    taskConfig: Record<string, any>,
    appConfig: BizyAirAppConfig
  ): Record<string, any> {
    const inputMapping = appConfig.input_mapping as ExtendedInputMapping
    const inputValues: Record<string, any> = {}

    // 遍历 input_mapping 中的每个字段
    for (const [userParam, mappingConfig] of Object.entries(inputMapping)) {
      const userValue = taskConfig[userParam]

      // 检查映射配置的类型
      if ('items' in mappingConfig && mappingConfig.type === 'array') {
        // ArrayMappingItem 类型：包含 type: "array" 和 items 字段
        if (userValue !== undefined && Array.isArray(userValue)) {
          const processedArray = this.processArrayType(userValue, mappingConfig.items)
          if (processedArray !== null) {
            // 将数组元素映射到各自的路径
            for (let i = 0; i < processedArray.length; i++) {
              const itemConfig = mappingConfig.items[i]
              if (itemConfig && processedArray[i] !== null) {
                const value = processedArray[i]
                // 直接使用 mapping 路径作为键，不转换为嵌套结构
                inputValues[itemConfig.mapping] = value
              }
            }
          }
        }
      } else if (Array.isArray(mappingConfig)) {
        // 允许直接传入 InputMappingItem[] 形式的映射配置
        if (userValue !== undefined && Array.isArray(userValue)) {
          const processedArray = this.processArrayType(userValue, mappingConfig)
          if (processedArray !== null) {
            // 将数组元素映射到各自的路径
            for (let i = 0; i < processedArray.length; i++) {
              const itemConfig = mappingConfig[i]
              if (itemConfig && processedArray[i] !== null) {
                const value = processedArray[i]
                // 直接使用 mapping 路径作为键，不转换为嵌套结构
                inputValues[itemConfig.mapping] = value
              }
            }
          }
        }
      } else {
        // 处理单个映射配置（InputMappingItem 或 ArrayUrlMappingItem）
        const itemConfig = mappingConfig as InputMappingItem | ArrayUrlMappingItem

        // 检查是否跳过 API 映射
        if ('skip_mapping' in itemConfig && itemConfig.skip_mapping) {
          console.debug(`参数 ${userParam} 标记为 skip_mapping=true，跳过 API 映射`)
          continue
        }

        // 获取值：优先使用用户提供的值，其次使用默认值
        let value: any
        if (userValue !== undefined) {
          value = userValue
        } else if (itemConfig.default !== undefined) {
          value = itemConfig.default
          console.debug(`参数 ${userParam}: 使用默认值 ${itemConfig.default}`)
        } else {
          // 既没有用户值也没有默认值，跳过此参数
          continue
        }

        // 根据类型处理值
        let processedValue: any
        switch (itemConfig.type) {
          case 'arrayurl':
            if ('separator' in itemConfig) {
              processedValue = this.processArrayUrlType(value, itemConfig as ArrayUrlMappingItem)
            } else {
              console.error(`参数 ${userParam}: arrayurl 类型缺少 separator 配置`)
              continue
            }
            break
          case 'random_seed':
            // 特殊处理 random_seed 类型（-1 表示随机生成）
            if (value === -1) {
              // 生成随机种子
              processedValue = Math.floor(Math.random() * 4294967295)
            } else {
              processedValue = value
            }
            break
          case 'string':
          case 'number':
          case 'boolean':
          default:
            // 基本类型直接使用值
            processedValue = value
            break
        }

        if (processedValue !== null) {
          // 直接使用 mapping 路径作为键，不转换为嵌套结构
          inputValues[itemConfig.mapping] = processedValue
        }
      }
    }

    // 构建 BizyAir API 请求数据
    return {
      web_app_id: appConfig.web_app_id,
      suppress_preview_output: false,
      input_values: inputValues,
    }
  }

  /**
   * 设置嵌套值
   *
   * 根据路径字符串设置对象的嵌套属性值。
   * 路径格式：`"nodeId:NodeClass.field"` 或 `"nodeId:NodeClass.field.subfield"`
   *
   * 示例路径：
   * - `"121:CLIPTextEncode.text"` → `{ "121": { "class_type": "CLIPTextEncode", "inputs": { "text": "..." } } }`
   * - `"121:KSamplerAdvanced.width"` → `{ "121": { "class_type": "KSamplerAdvanced", "inputs": { "width": 1280 } } }`
   *
   * @param obj - 目标对象
   * @param path - 嵌套路径（格式：`"nodeId:NodeClass.field.subfield"`）
   * @param value - 要设置的值
   *
   * @example
   * ```typescript
   * const obj = {}
   * BizyAirRequestBuilder.setNestedValue(obj, "121:CLIPTextEncode.text", "Hello")
   * // 结果: { "121": { "class_type": "CLIPTextEncode", "inputs": { "text": "Hello" } } }
   *
   * BizyAirRequestBuilder.setNestedValue(obj, "121:KSamplerAdvanced.width", 1280)
   * // 结果: {
   * //   "121": {
   * //     "class_type": "KSamplerAdvanced",
   * //     "inputs": { "text": "Hello", "width": 1280 }
   * //   }
   * // }
   * ```
   */
  private static setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.')
    if (parts.length < 2) {
      console.error(`无效的路径格式: ${path}，期望格式: "nodeId:NodeClass.field"`)
      return
    }

    // 第一部分是 "nodeId:NodeClass"，后续部分是字段路径
    const nodePart = parts[0] // "121:CLIPTextEncode"
    const fieldPath = parts.slice(1) // ["text"] 或 ["inputs", "seed"]

    // 解析 nodePart
    const nodeParts = nodePart.split(':')
    if (nodeParts.length !== 2) {
      console.error(`无效的节点格式: ${nodePart}，期望格式: "nodeId:NodeClass"`)
      return
    }

    const [nodeId, nodeClass] = nodeParts

    // 初始化节点对象（如果不存在）
    if (!obj[nodeId]) {
      obj[nodeId] = {
        class_type: nodeClass,
        inputs: {},
      }
    }

    // 设置嵌套字段值
    let current = obj[nodeId].inputs
    for (let i = 0; i < fieldPath.length - 1; i++) {
      const field = fieldPath[i]
      if (!current[field]) {
        current[field] = {}
      }
      current = current[field]
    }

    // 设置最终值
    current[fieldPath[fieldPath.length - 1]] = value
  }

  /**
   * 处理数组类型参数
   *
   * 遍历数组元素，根据每个元素的配置进行处理。
   *
   * @param value - 用户提供的数组值
   * @param inputDef - 数组元素配置列表（InputMappingItem[]）
   * @returns 处理后的数组值，如果应该跳过则返回 null
   *
   * @example
   * ```typescript
   * const value = [1280, 720]
   * const inputDef = [
   *   { path: "121:KSamplerAdvanced.width", type: "number" },
   *   { path: "121:KSamplerAdvanced.height", type: "number" }
   * ]
   * const result = BizyAirRequestBuilder.processArrayType(value, inputDef)
   * // 结果: [1280, 720]
   * ```
   */
  private static processArrayType(
    value: any,
    inputDef: InputMappingItem[]
  ): any[] | null {
    if (!Array.isArray(value)) {
      console.error(`期望数组类型，实际类型: ${typeof value}`)
      return null
    }

    // 处理数组元素
    const processedArray: any[] = []
    for (let i = 0; i < value.length; i++) {
      const itemValue = value[i]
      const itemConfig = inputDef[i]

      if (!itemConfig) {
        console.warn(`数组索引 ${i} 没有对应的配置`)
        continue
      }

      // 根据元素类型处理值
      let processedValue: any
      switch (itemConfig.type) {
        case 'string':
        case 'number':
        case 'boolean':
          // 基本类型直接使用值
          processedValue = itemValue
          break
        case 'arrayurl':
          // 嵌套的 arrayurl 类型 - 这种情况在数组元素中不应该出现
          console.warn(`数组元素不支持 arrayurl 类型: ${itemConfig.type}`)
          processedValue = itemValue
          break
        default:
          processedValue = itemValue
          break
      }

      processedArray.push(processedValue)
    }

    return processedArray
  }

  /**
   * 处理数组 URL 类型参数
   *
   * 将 URL 数组使用分隔符拼接成字符串。
   *
   * @param value - 用户提供的 URL 数组
   * @param inputDef - 参数映射配置（包含 separator 配置）
   * @returns 拼接后的字符串，如果应该跳过则返回 null
   *
   * @example
   * ```typescript
   * const value = ["https://example.com/img1.jpg", "https://example.com/img2.jpg"]
   * const inputDef = { mapping: "123:ImageLoader.images", type: "arrayurl", separator: "\n" }
   * const result = BizyAirRequestBuilder.processArrayUrlType(value, inputDef)
   * // 结果: "https://example.com/img1.jpg\nhttps://example.com/img2.jpg"
   * ```
   */
  private static processArrayUrlType(
    value: any,
    inputDef: ArrayUrlMappingItem
  ): string | null {
    // 验证是否为数组
    if (!Array.isArray(value)) {
      console.error(`参数期望数组类型，实际类型: ${typeof value}`)
      return null
    }

    // 获取分隔符（默认为换行符）
    const separator = inputDef.separator || '\n'

    // 拼接 URL
    const result = value.join(separator)
    console.debug(
      `参数: 拼接了 ${value.length} 个URL，分隔符: ${JSON.stringify(separator)}`
    )

    return result
  }
}

/**
 * 导出便捷的函数式 API
 *
 * 提供与类方法相同功能的独立函数，便于函数式编程风格。
 */

/**
 * 构建 BizyAir API 请求数据
 *
 * @param taskConfig - 用户任务配置
 * @param appConfig - BizyAir 应用配置
 * @returns BizyAir API 请求数据
 *
 * @example
 * ```typescript
 * import { buildRequestData } from './BizyAirRequestBuilder'
 *
 * const requestData = buildRequestData(taskConfig, appConfig)
 * ```
 */
export function buildRequestData(
  taskConfig: Record<string, any>,
  appConfig: BizyAirAppConfig
): Record<string, any> {
  return BizyAirRequestBuilder.build(taskConfig, appConfig)
}
