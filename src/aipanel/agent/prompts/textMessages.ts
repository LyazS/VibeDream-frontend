// 前端打包的完整原系统提示词，由编排模块组装后随每轮消息发送。
import systemPrompt from './system-prompt.txt?raw'
import type { ModelMessage } from '../transport/AgentClient'

export type ProjectContext = {
  projectId: string
  projectName: string
  fps: number
  selectedClipIds: string[]
}

/** 在前端组装原系统提示词、单工具约束和最新工程快照，不修改传入的配对历史。 */
export function buildTextMessages(
  history: ModelMessage[],
  context: ProjectContext,
): ModelMessage[] {
  return [
    {
      role: 'system',
      content: `${systemPrompt}\n\n每轮最多调用一个工具。读取或修改工程必须依据实际工具结果；需要澄清时使用 ask_user，收到回答后继续。\n工程上下文：${JSON.stringify(
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
