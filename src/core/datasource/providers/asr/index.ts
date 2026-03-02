/**
 * ASR 语音识别数据源模块
 * 统一导出所有 ASR 相关的类型、工厂函数和处理器
 */

// 导出类型定义
export * from './types'

// 导出数据源工厂和类型守卫
export {
  type ASRSourceData,
  ASRSourceFactory,
  ASRTypeGuards,
  extractASRSourceData,
} from './ASRSource'

// 导出处理器
export { ASRProcessor, type ASRTaskSubmitRequest, type ASRTaskSubmitResponse } from './ASRProcessor'
