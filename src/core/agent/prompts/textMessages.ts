// 前端打包的完整原系统提示词，由编排模块组装后随每轮消息发送。
import systemPrompt from './system-prompt.txt?raw'
import type { ModelMessage } from '../transport/AgentClient'

/** 系统规则保持固定；动态上下文随对应用户消息进入历史。 */
export function buildTextMessages(history: ModelMessage[]): ModelMessage[] {
  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...history,
  ]
}
