/**
 * ASR datasource 统一导出。
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
