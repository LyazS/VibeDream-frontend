import type { ModelTool } from '../../transport/AgentClient'

export const askUserDefinition: ModelTool = {
  name: 'ask_user',
  description: `What It Does
-------------
向用户发起一次澄清提问，并等待用户回答后继续任务。

Use When
---------
- 继续执行所需的关键信息缺失
- 缺失信息无法通过素材、轨道、片段或关键帧读取工具获得
- 贸然默认会改变用户意图或造成错误编辑

Do NOT Use When
---------------
- 可以通过读取素材、轨道、片段等现有信息直接取得答案
- 能安全采用常识默认值且不会影响编辑结果
- 任务已经完成，应直接回复用户

Returns
--------
最终返回给你的是用户回答文本，格式如下：

[ASK_RESULT]
<answer>

Limitations
-----------
一次只问一个最阻塞的问题。候选项应简短、互斥、易选择；不要提供“其他/自定义”选项，用户仍可自由补充回答。`,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          '直接展示给用户的单个澄清问题。必须具体说明你需要用户决定什么，不要一次询问多个问题。',
      },
      suggested_options: {
        type: 'array',
        items: {
          type: 'string',
          description: '一个简短、互斥、可点击的候选回答。',
        },
        description: '建议回答选项。优先提供 2-3 个简短且互斥的候选；不要包含“其他/自定义”。',
      },
    },
    required: ['question', 'suggested_options'],
  },
}
