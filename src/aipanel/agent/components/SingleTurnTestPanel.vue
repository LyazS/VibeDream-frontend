<template>
  <section class="turn-panel" aria-label="单轮对话测试">
    <div class="status-row" role="status">
      <span class="connection" :class="store.agentTestConnection.status">
        <component :is="IconComponents.SPARKLING" size="14px" />
        {{ connectionLabels[store.agentTestConnection.status] }}
      </span>
      <span>{{ statusLabels[result.status] }}</span>
      <n-button
        quaternary
        :disabled="running"
        title="清空结果"
        aria-label="清空结果"
        @click="store.clearAgentTestSingleTurn"
      >
        <template #icon><component :is="IconComponents.DELETE" size="16px" /></template>
      </n-button>
    </div>
    <form class="turn-form" @submit.prevent="submit">
      <n-input
        v-model:value="prompt"
        type="textarea"
        :disabled="running"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="输入消息"
        :input-props="{ 'aria-label': '消息内容' }"
      />
      <div class="actions">
        <span v-if="!store.agentTestReady" class="muted">{{
          store.isLoggedIn ? '工程尚未就绪' : '请先登录'
        }}</span>
        <n-button v-if="running" type="error" secondary @click="store.stopAgentTestSingleTurn">
          <template #icon><component :is="IconComponents.CLOSE" size="16px" /></template>停止
        </n-button>
        <n-button
          v-else
          type="primary"
          attr-type="submit"
          :disabled="!store.agentTestReady || !prompt.trim()"
        >
          <template #icon><component :is="IconComponents.SEND" size="16px" /></template>发送
        </n-button>
      </div>
    </form>
    <div class="turn-output" aria-live="polite">
      <p v-if="result.error" class="error" role="alert">{{ result.error }}</p>
      <p v-if="result.prompt" class="user-message">{{ result.prompt }}</p>
      <p v-if="result.draft || result.completion" class="assistant-message">
        {{ result.completion?.message.content || result.draft }}
      </p>
      <n-spin v-if="running" size="small" />
      <dl v-if="result.turnId" class="metadata">
        <dt>Turn ID</dt>
        <dd>{{ result.turnId }}</dd>
        <template v-if="result.acceptance"
          ><dt>受理状态</dt>
          <dd>{{ acceptanceLabels[result.acceptance] || result.acceptance }}</dd></template
        >
        <template v-if="result.elapsedMs !== null"
          ><dt>耗时</dt>
          <dd>{{ result.elapsedMs }} ms</dd></template
        >
        <template v-if="result.completion"
          ><dt>Usage</dt>
          <dd>
            {{
              result.completion.usage
                ? `${result.completion.usage.inputTokens} / ${result.completion.usage.outputTokens} / ${result.completion.usage.totalTokens}`
                : '缺失'
            }}
          </dd></template
        >
        <template v-if="store.agentTestConnection.closeReason"
          ><dt>连接关闭</dt>
          <dd>{{ store.agentTestConnection.closeReason }}</dd></template
        >
      </dl>
      <details v-if="result.completion">
        <summary>完整结果</summary>
        <pre>{{ JSON.stringify(result.completion, null, 2) }}</pre>
      </details>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NSpin } from 'naive-ui'
import { useUnifiedStore } from '@/core/unifiedStore'
import { IconComponents } from '@/constants/iconComponents'

// 共享业务状态和操作入口，测试连接与轮次生命周期均由独立测试模块管理。
const store = useUnifiedStore()
// 面板输入草稿；发送时由测试模块快照为本轮消息。
const prompt = ref('你好，请用一句话介绍你能帮助我做什么。')
// 当前测试状态的只读响应式引用，切换测试标签不会创建新轮次。
const result = computed(
  /** 读取测试模块的单轮状态，供面板响应式展示。 */ () => store.agentTestSingleTurn,
)
// 调用进行中时锁定输入和清空操作，并显示停止按钮。
const running = computed(
  /** 根据调用状态计算表单及操作按钮是否应锁定。 */ () => result.value.status === 'running',
)
// 传输层连接状态对应的中文展示文本。
const connectionLabels = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  disposed: '已释放',
}
// 测试轮次生命周期对应的中文展示文本。
const statusLabels = {
  idle: '待发送',
  running: '调用中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
}
// 服务端受理分类对应的中文文本，未知错误值仍保留原值展示。
const acceptanceLabels: Record<string, string> = {
  accepted: '已受理',
  not_accepted: '未受理',
  unknown: '未知',
}
/** 将输入交给测试模块流式发送，面板本身不创建连接或保存对话历史。 */
function submit() {
  void store.runAgentTestSingleTurn(prompt.value)
}
</script>

<style scoped>
.turn-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: var(--spacing-md);
  gap: var(--spacing-md);
}
.status-row,
.connection,
.actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.status-row {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.status-row > :last-child {
  margin-left: auto;
}
.connection.connected {
  color: var(--color-success);
}
.turn-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
.actions {
  justify-content: flex-end;
}
.muted {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-right: auto;
}
.turn-output {
  flex: 1;
  overflow: auto;
  min-height: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.user-message {
  color: var(--color-text-secondary);
  border-left: 2px solid var(--color-border-primary);
  padding-left: 10px;
}
.user-message,
.assistant-message {
  white-space: pre-wrap;
  line-height: 1.65;
}
.error {
  color: var(--color-error);
}
.metadata {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.metadata dt {
  color: var(--color-text-secondary);
}
.metadata dd {
  margin: 0;
}
details {
  margin-top: 12px;
}
summary {
  cursor: pointer;
  color: var(--color-text-secondary);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>
