# LightCut Resource-first 任务中心核心设计

## 核心思路

任务中心不直接以“任务提交”为核心，而是以“资源就绪”为核心。

业务方不关心某个流程内部要跑几个步骤，只声明自己需要什么资源：

```ts
await jobRuntime.ensure(MediaReady(mediaId))
await jobRuntime.ensure(AIGeneratedMedia(input))
await jobRuntime.ensure(ASRSubtitles(clipId))
```

系统内部根据资源依赖图执行：

```text
Resource Request -> Resolver -> Dependencies -> Jobs -> TaskCenter View
```

任务中心仍然存在，但它更像执行图的 UI 投影：

```text
JobRuntime 负责依赖图、去重、调度、恢复。
Resolver 负责某类资源如何就绪。
TaskCenter 负责展示、取消、重试、历史。
业务模块负责把资源结果映射回自身状态。
```

## 为什么用 DAG

LightCut 的很多异步工作本质不是“跑任务”，而是“让资源达到可用状态”：

- 时间轴预览需要媒体 ready。
- 导出需要所有引用媒体 ready。
- 视觉摘要需要媒体 ready、导出小尺寸素材、上传、请求摘要。
- ASR 需要导出音频、上传音频、远程识别、创建字幕。
- AI 生成需要上传输入、提交远程任务、等待完成、下载结果、解码媒体。

DAG 方式天然解决：

- 同一资源多处请求时自动去重。
- 复杂流程可以拆成可复用依赖。
- 失败、重试、恢复可以按节点处理。
- UI 可以显示整体任务，也可以展开显示子步骤。

## 总体架构

```mermaid
flowchart TD
  UI["UI / Feature Module"] --> Ensure["jobRuntime.ensure(resource)"]
  Ensure --> Runtime["JobRuntime"]
  Runtime --> Registry["Resolver Registry"]
  Runtime --> Graph["Job Graph"]
  Runtime --> Scheduler["DAG Scheduler"]

  Registry --> Resolver["ResourceResolver"]
  Resolver --> Deps["dependencies"]
  Resolver --> Work["resolve work"]

  Scheduler --> Work
  Work --> Runtime
  Runtime --> TaskView["TaskCenter View"]
  Runtime --> Events["Resource / Job Events"]

  Events --> Media["MediaModule"]
  Events --> Timeline["TimelineModule"]
  Events --> Template["EffectTemplateModule"]
```

## 核心概念

### ResourceRequest

资源请求描述“我要什么”，而不是“我要跑哪个任务”。

```ts
export interface ResourceRequest<TInput = unknown> {
  type: ResourceType
  key: string
  input: TInput
  bindings?: ResourceBinding[]
  policy?: ResourcePolicy
}
```

```ts
export type ResourceType =
  | 'media-ready'
  | 'media-file-available'
  | 'media-decoded'
  | 'uploaded-resource'
  | 'remote-task-completed'
  | 'ai-generated-media'
  | 'asr-subtitles'
  | 'visual-summary'
  | 'effect-template-ready'
  | 'scene-boundaries'
  | 'exported-project'
```

### ResourceKey

`type + key` 是去重和恢复的核心。

```ts
const resourceId = `${request.type}:${request.key}`
```

示例：

```text
media-ready:media_123
media-decoded:media_123
uploaded-resource:sha256_abcd
remote-task-completed:bizyair:request_123
asr-subtitles:clip_123
```

### ResourceState

```ts
export type ResourceStatus =
  | 'idle'
  | 'blocked'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
```

```ts
export interface ResourceNode<TInput = unknown, TResult = unknown> {
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

  bindings: ResourceBinding[]
  policy: ResourcePolicy

  createdAt: string
  updatedAt: string
}
```

### Binding

Binding 只表达资源和业务对象的关联，不让 Runtime 直接操作业务对象。

```ts
export type ResourceBinding =
  | { type: 'media-item'; id: string }
  | { type: 'timeline-item'; id: string }
  | { type: 'directory'; id: string }
  | { type: 'effect-template'; id: string }
  | { type: 'project'; id: string }
```

### Policy

```ts
export interface ResourcePolicy {
  priority?: number
  queue?: 'remote' | 'local-heavy' | 'export' | 'background'
  persist?: boolean
  restore?: 'resume' | 'recompute' | 'mark-failed' | 'ignore'
  maxRetries?: number
}
```

## Resolver

Resolver 定义某类资源如何变成 ready。

```ts
export interface ResourceResolver<TInput = unknown, TResult = unknown> {
  type: ResourceType

  getKey(input: TInput): string

  isSatisfied?(ctx: ResolveCheckContext<TInput>): Promise<TResult | null>

  getDependencies?(ctx: ResolveContext<TInput>): Promise<ResourceRequest[]>

  resolve(ctx: ResolveContext<TInput>): Promise<TResult>

  cancel?(ctx: ResolveContext<TInput>): Promise<void>

  restore?(node: ResourceNode<TInput, TResult>): Promise<'resume' | 'recompute' | 'fail' | 'ignore'>
}
```

```ts
export interface ResolveContext<TInput = unknown> {
  node: ResourceNode<TInput>
  input: TInput
  signal: AbortSignal

  ensure<T>(request: ResourceRequest): Promise<T>

  update(patch: {
    progress?: number
    stage?: string
    message?: string
  }): void

  emit(event: ResourceDomainEvent): void
}
```

## 示例资源图

### 媒体 ready

```text
MediaReady(mediaId)
  -> MediaFileAvailable(mediaId)
  -> MediaDecoded(mediaId)
```

解释：

- `MediaFileAvailable` 负责本地文件存在，或从远程结果下载。
- `MediaDecoded` 负责 Bunny 解码、duration、缩略图等运行时对象。
- `MediaReady` 是给业务使用的稳定入口。

### AI 生成媒体

```text
AIGeneratedMedia(input)
  -> UploadedResource(input files)
  -> RemoteTaskCompleted(provider, remoteTaskId)
  -> MediaReady(resultMediaId)
```

解释：

- 输入上传可以复用 `UploadedResource`。
- 后端 AI、BizyAir 直连都可以抽象成 `RemoteTaskCompleted`。
- 生成结果最终落到媒体库，并通过 `MediaReady` 解码。

### ASR 字幕

```text
ASRSubtitles(clipId)
  -> ExportedAudio(clipId)
  -> UploadedResource(audio)
  -> RemoteTaskCompleted(volcengine_asr, taskId)
  -> SubtitlesCreated(result)
```

第一版可以把 `SubtitlesCreated` 放在 `ASRSubtitles.resolve()` 内部，后续再拆成独立资源。

### 导出项目

```text
ExportedProject(projectId)
  -> MediaReady(mediaId A)
  -> MediaReady(mediaId B)
  -> EffectTemplateReady(templateId)
  -> EncodeProject(projectId)
```

导出不再自己等待一堆媒体状态，而是声明依赖所有 `MediaReady`。

## JobRuntime API

```ts
class JobRuntime {
  ensure<T>(request: ResourceRequest): Promise<T>
  cancel(resourceId: string): Promise<boolean>
  retry(resourceId: string): Promise<boolean>
  getNode(resourceId: string): ResourceNode | undefined
  getNodesByBinding(binding: ResourceBinding): ResourceNode[]
}
```

便捷 API：

```ts
jobRuntime.ensureMediaReady(mediaId, {
  bindings: [{ type: 'timeline-item', id: clipId }],
})

jobRuntime.ensureAIGeneratedMedia(input, {
  bindings: [{ type: 'directory', id: currentDirId }],
})
```

## 调度规则

DAG Scheduler 的规则：

- 节点所有依赖成功后才可运行。
- 任一依赖失败，当前节点进入 `blocked` 或 `failed`。
- 相同 `resourceId` 只保留一个节点，请求方共享结果。
- 后来的请求可以追加 bindings 和提高 priority。
- 取消父节点时，取消只由它独占的子节点；共享子节点不能被误取消。
- 重试节点时，可选择只重试失败节点，或连同下游节点一起重算。

并发队列：

```text
remote       AI、ASR、视觉摘要、远程轮询
local-heavy  媒体解码、智能分镜
export       项目导出
background   模板下载、后台摘要
```

## TaskCenter View

TaskCenter 是 Job Graph 的 UI 投影，而不是执行真相本身。

一个 UI 任务可以对应：

- 单个 ResourceNode。
- 一个父节点和它的依赖子图。
- 一组同类后台节点。

```ts
export interface TaskView {
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

UI 展示任务，底层仍通过 `JobRuntime.cancel(rootResourceId)` 和 `JobRuntime.retry(rootResourceId)` 操作资源图。

## 媒体和 Timeline 状态同步

Runtime 不直接修改 timeline clip。

它只发布资源事件：

```ts
export type ResourceEvent =
  | { type: 'resource:created'; node: ResourceNode }
  | { type: 'resource:updated'; node: ResourceNode }
  | { type: 'resource:succeeded'; node: ResourceNode }
  | { type: 'resource:failed'; node: ResourceNode }
  | { type: 'resource:cancelled'; node: ResourceNode }
```

TimelineModule 按 binding 映射：

```text
media-ready queued/running -> timelineItem.timelineStatus = loading
media-ready succeeded      -> timelineItem.timelineStatus = ready
media-ready failed         -> timelineItem.timelineStatus = error
media-ready cancelled      -> timelineItem.timelineStatus = cancelled
```

MediaModule 按 binding 映射：

```text
media-ready queued/running -> mediaItem.mediaStatus = pending/asyncprocessing/decoding
media-ready succeeded      -> mediaItem.mediaStatus = ready
media-ready failed         -> mediaItem.mediaStatus = error
media-ready cancelled      -> mediaItem.mediaStatus = cancelled
```

## 持久化与恢复

持久化 ResourceNode，而不是持久化运行时对象。

可持久化：

- resource type/key/input/status。
- bindings。
- remote task id 和 provider。
- result metadata。
- error 信息。

不可持久化：

- AbortController。
- File、Blob、Bunny runtime object。
- API Key。

恢复策略：

- `resume`: 重新连接进度流或重新轮询远程任务。
- `recompute`: 从资源依赖重新计算。
- `mark-failed`: 本地导出、智能分镜等无法恢复的运行中节点标记失败。
- `ignore`: 临时资源不恢复。

## 迁移路径

### 阶段一：Runtime 骨架

- 新增 `JobRuntime`、`ResourceNode`、`ResourceResolver`、DAG Scheduler。
- 新增 TaskCenter View，将 ResourceNode 投影成任务列表。

### 阶段二：媒体 ready

- 实现 `MediaReadyResolver`、`MediaFileAvailableResolver`、`MediaDecodedResolver`。
- 引入 `ensureMediaReady(mediaId)`。
- Timeline clip 状态从 watch 迁移到资源事件。

### 阶段三：远程生成

- 实现 AI / BizyAir / ASR 相关 resolver。
- 复用现有上传、提交、流监听、轮询、下载逻辑。
- 将现有 Processor 的队列职责迁移到 JobRuntime。

### 阶段四：编辑器长任务

- 接入导出、智能分镜、视觉摘要、效果模板下载。
- 导出依赖显式声明为一组 `MediaReady` 和 `EffectTemplateReady`。

## 推荐目录

```text
src/core/jobs/
  JobRuntime.ts
  ResourceTypes.ts
  ResourceResolver.ts
  DagScheduler.ts
  TaskViewAdapter.ts
  resolvers/
    MediaReadyResolver.ts
    MediaFileAvailableResolver.ts
    MediaDecodedResolver.ts
    UploadedResourceResolver.ts
    RemoteTaskCompletedResolver.ts
    AIGeneratedMediaResolver.ts
    ASRSubtitlesResolver.ts
    ExportedProjectResolver.ts
    EffectTemplateReadyResolver.ts
```

## 最终形态

业务代码声明资源需求：

```ts
await jobRuntime.ensureMediaReady(mediaId)
await jobRuntime.ensureAIGeneratedMedia(input)
await jobRuntime.ensureASRSubtitles(clipId)
```

JobRuntime 负责依赖图、调度、去重、恢复。

TaskCenter 负责把这张图展示给用户，并提供取消、重试、定位来源等操作。
