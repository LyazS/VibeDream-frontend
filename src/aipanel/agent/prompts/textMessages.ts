// 前端打包的完整原系统提示词，所有文本测试调用共用且不由传输层修改。
import systemPrompt from './system-prompt.txt?raw'
import type { TextMessage } from '../transport/AgentClient'

export type ProjectContext = {
  projectId: string
  projectName: string
  fps: number
  selectedClipIds: string[]
}

/** 在前端组装完整系统提示词、文本阶段限制和工程快照，不修改传入的历史。 */
export function buildTextMessages(history: TextMessage[], context: ProjectContext): TextMessage[] {
  return [
    {
      role: 'system',
      content: `${systemPrompt}\n\n当前阶段仅提供文本对话，没有可用工具。不能声称已读取或修改工程。\n工程上下文：${JSON.stringify(
        {
          project_id: context.projectId,
          project_name: context.projectName,
          fps: context.fps,
          selected_clip_ids: context.selectedClipIds,
        },
      )}`,
    },
    ...history,
  ]
}
