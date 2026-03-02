// 流式消息类型枚举
export enum StreamChunkType {
  TEXT = 'text',
  TOOL_CALL = 'tool_call',      // 工具调用
  TOOL_RESULT = 'tool_result',  // 工具结果
  ERROR = 'error',
  DONE = 'done',                // 完成标记
}

// 流式消息接口定义
export interface StreamChunk {
  type: StreamChunkType
  content: string
  tool_name?: string    // 工具名称
  tool_args?: Record<string, any>  // 工具参数
  tool_call_id?: string  // 工具调用 ID
  is_frontend_tool?: boolean  // 是否为前端工具
}
