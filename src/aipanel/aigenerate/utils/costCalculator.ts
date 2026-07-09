import type { AIGenerateConfig } from '@/aipanel/aigenerate/types'
import { addMoney, type MoneyString } from '@/utils/money'
import { getValueByPathWithWrapper } from './pathUtils'

/**
 * 计算动态成本
 * @param config AI生成配置
 * @param aiConfig 用户选择的AI配置
 * @returns 计算后的总成本
 */
export function calculateTotalCost(
  config: AIGenerateConfig,
  aiConfig: Record<string, any>
): MoneyString {
  let totalCost = config.cost // 基础成本

  // 遍历所有 UI 配置项，查找 select-input 类型的 add_cost
  for (const fieldConfig of config.uiConfig) {
    if (fieldConfig.type === 'select-input') {
      const selectConfig = fieldConfig
      
      // 处理路径：如果 path 以 "aiConfig." 开头，则去掉该前缀
      const path = selectConfig.path.startsWith('aiConfig.')
        ? selectConfig.path.slice(9)
        : selectConfig.path
      
      const selectedValue = getValueByPathWithWrapper(aiConfig, path)
      
      // 查找选中选项的 add_cost
      const selectedOption = selectConfig.options.find(
        (opt: any) => opt.value === selectedValue
      )
      
      if (selectedOption?.add_cost) {
        totalCost = addMoney(totalCost, selectedOption.add_cost)
      }
    }
  }

  return totalCost
}
