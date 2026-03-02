/**
 * 内置工具定义
 * 前端特有的工具实现（测试用）
 */

import { toolRegistry, type ToolDefinition } from './registry'

/**
 * 获取天气工具（测试用）
 * 返回随机天气数据
 */
const getWeatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '获取指定城市的天气信息（模拟数据）',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，如北京、上海',
      },
    },
    required: ['city'],
  },
  execute: async (args: Record<string, any>) => {
    const city = args.city || '未知城市'
    const conditions = ['晴', '多云', '阴', '小雨', '大雨', '雪']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temperature = Math.floor(Math.random() * 45) - 10 // -10 到 35 度
    const humidity = Math.floor(Math.random() * 60) + 30 // 30% 到 90%
    
    return `${city}今天${condition}，气温${temperature}°C，湿度${humidity}%`
  },
}

// 注册内置工具
export function registerBuiltinTools(): void {
  toolRegistry.register(getWeatherTool)
}
