# 任务中心 DAG 核心设计精简版

## 一句话设计

任务中心不以“提交任务”为核心，而以“资源就绪”为核心。

业务模块只声明自己需要某个资源 ready：

```ts
await jobRuntime.ensure(MediaReady(mediaId))
await jobRuntime.ensure(AIGeneratedMedia(input))
await jobRuntime.ensure(ASRSubtitles(clipId))
```

系统内部用 DAG 解析依赖、去重、调度、恢复和展示。

```text
ResourceRequest -> Resolver -> Resource DAG -> Scheduler -> TaskCenter View
```

## 核心分工

```text
业务模块：
  声明资源需求，并把资源结果同步回自己的业务状态。

JobRuntime：
  维护资源图、去重、依赖边、状态机、调度、取消、重试、恢复和事件分发。

ResourceResolver：
  定义某类资源如何判断已满足、依赖哪些资源、如何真正执行。

DAG Scheduler：
  按依赖关系和队列策略运行可执行节点。

TaskCenter：
  只是 Job Graph 的 UI 投影，负责展示、取消、重试、历史。
```

## 核心对象

### ResourceRequest

`ResourceRequest` 描述“我要什么资源”，不是“我要跑什么任务”。

```ts
interface ResourceRequest<TInput = unknown> {
  type: ResourceType
  key: string
  input: TInput
  policy?: ResourcePolicy
}
```

### ResourceKey

`type + key` 是资源身份，也是去重和恢复的核心。

```ts
const resourceId = `${request.type}:${request.key}`
```

示例：

```text
media-ready:media_123
uploaded-resource:sha256_abcd
remote-task-completed:bizyair:request_123
asr-subtitles:clip_123
```

### ResourceNode

`ResourceNode` 是运行态节点，保存本次执行需要的信息：

```ts
interface ResourceNode<TInput = unknown, TResult = unknown> {
  id: string
  type: ResourceType
  key: string
  input: TInput
  status: ResourceStatus
  deps: string[]
  dependents: string[]
  result?: TResult
  error?: { message: string; code?: string; retryable?: boolean }
  progress?: number
  stage?: string
  message?: string
  policy: ResourcePolicy
}
```

DAG 不是长期资源数据库。长期事实应写回业务域对象、项目数据或缓存，例如 `mediaItem.localPath`、`mediaItem.duration`、`thumbnail`、`project metadata`。

### ResourcePolicy

`policy` 只描述运行策略，不参与资源身份和去重。

```ts
interface ResourcePolicy {
  priority?: number
  queue?: 'remote' | 'local-heavy' | 'export' | 'background'
  persist?: boolean
  restore?: 'resume' | 'recompute' | 'mark-failed' | 'ignore'
  maxRetries?: number
}
```

## Resolver 设计

Resolver 是资源类型的执行适配器。

```ts
interface ResourceResolver<TInput = unknown, TResult = unknown> {
  type: ResourceType
  getKey(input: TInput): string
  isSatisfied?(ctx: ResolveCheckContext<TInput>): Promise<TResult | null>
  getDependencies?(ctx: ResolveContext<TInput>): Promise<ResourceRequest[]>
  resolve(ctx: ResolveContext<TInput>): Promise<TResult>
  cancel?(ctx: ResolveContext<TInput>): Promise<void>
  restore?(node: ResourceNode<TInput, TResult>): Promise<'resume' | 'recompute' | 'fail' | 'ignore'>
}
```

Resolver 负责：

- 判断资源是否已经 ready，避免重复执行。
- 声明依赖资源。
- 在依赖完成后执行实际工作。
- 回传进度、阶段和领域事件。
- 处理资源类型自己的取消、恢复和重试逻辑。

Resolver 不负责：

- 全局调度。
- 跨资源去重。
- TaskCenter UI 组织。
- 保存长期业务事实。

## ensure 执行流程

```text
business module
  -> jobRuntime.ensure(request)
  -> Runtime 计算 resourceId = type + key
  -> 查找或创建 ResourceNode
  -> Resolver.isSatisfied()
  -> Resolver.getDependencies()
  -> Runtime 递归 ensure 依赖并连接 DAG 边
  -> Scheduler 等依赖成功后调度当前节点
  -> Resolver.resolve()
  -> Runtime 更新状态、唤醒等待者、发布事件、返回 result
```

`isSatisfied()` 让已经 ready 的资源直接返回结果。  
`getDependencies()` 让 Runtime 尽早构建完整 DAG。  
`resolve()` 只做当前资源真正的执行工作。

## 典型资源图

### 媒体 ready

```text
MediaReady(mediaId)
  -> MediaFileAvailable(mediaId)
  -> MediaDecoded(mediaId)
```

`MediaReady` 是业务入口，内部下载、解码、缩略图、波形等细节由 resolver 管理。

### AI 生成媒体

```text
AIGeneratedMedia(input)
  -> UploadedResource(input files)
  -> RemoteTaskCompleted(provider, remoteTaskId)
  -> MediaReady(resultMediaId)
```

### ASR 字幕

```text
ASRSubtitles(clipId)
  -> ExportedAudio(clipId)
  -> UploadedResource(audio)
  -> RemoteTaskCompleted(asrProvider, taskId)
  -> SubtitlesCreated(result)
```

### 导出项目

```text
ExportedProject(projectId)
  -> MediaReady(mediaId A)
  -> MediaReady(mediaId B)
  -> EffectTemplateReady(templateId)
  -> EncodeProject(projectId)
```

## 调度规则

- 所有依赖成功后，节点才可运行。
- 任一依赖失败，下游节点进入 blocked 或 failed。
- 相同 `resourceId` 只保留一个节点，请求方共享结果。
- 新请求可以提高已有节点优先级，但不应降低优先级。
- 取消父节点时，只取消它独占的子节点；共享子节点不能被误取消。
- 重试节点时，可以只重试失败节点，也可以连同下游重算。

队列建议：

```text
remote       AI、ASR、视觉摘要、远程轮询
local-heavy  媒体解码、智能分镜
export       项目导出
background   模板下载、后台摘要
```

## 生命周期原则

DAG 是运行态结构。一次 `ensure(root)` 可以视为一次 root 路径执行。

路径结束后，Runtime 可以释放不再被引用的节点：

```ts
function canRelease(node: ResourceNode) {
  return isTerminal(node.status)
    && node.externalRefCount === 0
    && node.waiterCount === 0
    && node.dependents.length === 0
}
```

共享依赖只在所有依赖者都释放后才能释放。

## TaskCenter 定位

TaskCenter 不是执行真相，只是 Resource DAG 的展示视图。

```ts
interface TaskView {
  id: string
  title: string
  status: ResourceStatus
  progress?: number
  message?: string
  rootResourceId: string
  childResourceIds: string[]
  actions: {
    canCancel: boolean
    canRetry: boolean
    canRevealSource: boolean
  }
}
```

UI 操作仍回到 Runtime：

```ts
jobRuntime.cancel(rootResourceId)
jobRuntime.retry(rootResourceId)
```

## 业务状态同步

Runtime 不直接修改 timeline、media item 或 project。

业务模块负责把资源状态映射回自己的状态：

```ts
timelineModule.markClipLoading(clipId)

try {
  await jobRuntime.ensureMediaReady(mediaId)
  timelineModule.markClipReady(clipId)
} catch (error) {
  timelineModule.markClipError(clipId, error)
}
```

Runtime 只发布资源事件：

```ts
resource:created
resource:updated
resource:succeeded
resource:failed
resource:cancelled
```

## 持久化与恢复

持久化 ResourceNode 的可恢复信息，而不是运行时对象。

可持久化：

- resource type / key / input / status。
- remote task id / provider。
- result metadata。
- error 信息。

不可持久化：

- AbortController。
- File / Blob。
- Bunny runtime object。
- API Key。

恢复策略由 `policy.restore` 和 resolver 共同决定：

```text
resume       继续轮询或重新连接远程任务
recompute    从依赖图重新计算
mark-failed  无法安全恢复，标记失败等待用户重试
ignore       临时资源不恢复
```

## 扩展边界

MVP 不需要让 Runtime 保存资源和业务对象的映射。

如果后续 TaskCenter 需要定位来源、按业务对象过滤任务，或重启后恢复 UI 映射，可以新增 `bindings`：

```ts
type ResourceBinding =
  | { type: 'media-item'; id: string }
  | { type: 'timeline-item'; id: string }
  | { type: 'directory'; id: string }
  | { type: 'effect-template'; id: string }
  | { type: 'project'; id: string }
```

`bindings` 只表达业务关联，不参与资源去重、依赖解析和调度。

## 最小落地顺序

1. 建 `JobRuntime`、`ResourceNode`、`ResourceResolver`、`DagScheduler`。
2. 建 `TaskViewAdapter`，把 ResourceNode 投影成任务列表。
3. 先接入媒体 ready：`MediaReady`、`MediaFileAvailable`、`MediaDecoded`。
4. 再接入远程生成、ASR、导出、效果模板等长任务。

## 最终形态

业务只声明资源需求：

```ts
await jobRuntime.ensureMediaReady(mediaId)
await jobRuntime.ensureAIGeneratedMedia(input)
await jobRuntime.ensureASRSubtitles(clipId)
```

JobRuntime 负责依赖图、调度、去重和恢复。  
TaskCenter 负责把这张图展示给用户，并提供取消、重试等操作。
