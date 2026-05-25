# LightCut Resource-first 任务中心核心设计

## 当前实现快照

代码核对时间：2026-05-25。

这份文档仍然描述长期设计方向，但和早期版本相比，下面这些部分已经在代码里落地，不再只是规划：

- `JobRuntime`、`DagScheduler`、resolver registry、`TaskViewAdapter`、`useJobTaskCenter()`
- 本地媒体 ready DAG
- 时间轴 `timeline-item-ready` DAG
- AI 生成媒体 DAG
- ASR 字幕 DAG 第一版

当前实际已注册资源类型：

- `media-file-available`
- `media-source-processed`
- `media-decoded`
- `media-ready`
- `remote-task-submitted`
- `remote-task-completed`
- `ai-generated-media`
- `asr-remote-task-completed`
- `asr-subtitles`
- `timeline-item-ready`

当前仍未落地的部分：

- TaskCenter `bindings` / `canRevealSource`
- 视觉摘要、效果模板、场景检测、导出等更多资源接入

阅读这份文档时需要注意两点：

- 文中涉及 `ASRTaskSubmitted`、持久化恢复的章节，更多是在描述下一阶段的目标结构。
- 当前代码的真实实施边界，请以 `task-center-dag-roadmap.md`、`task-center-dag-ai-generated-media-implementation.md`、`task-center-dag-asr-implementation.md` 为准。

同时要明确区分两层恢复：

- 业务对象级持久化恢复：当前已经存在，例如 meta 文件重建 media item、项目加载后自动恢复 AI 媒体和 timeline placeholder。
- DAG 重建语义：当前主要依赖“业务对象恢复后重新走 ensure 链路”，而不是 Runtime 内置恢复策略。

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

### 业务入口节点

业务创建的是大路径里的业务入口节点，而不是把整条内部执行路径手动创建好。

例如时间轴创建 clip 时，业务只需要声明 clip 或 media item 需要达到 ready：

```ts
await jobRuntime.ensure(MediaItemReady(mediaItemId))
```

`MediaItemReady` 是一个聚合资源节点。它内部由 resolver 负责创建和等待子图：

```text
MediaItemReady(mediaItemId)
  -> MediaFileAvailable(mediaItemId)
  -> MediaDecoded(mediaItemId)
  -> ThumbnailReady(mediaItemId)
  -> WaveformReady(mediaItemId)
```

业务模块不需要知道下载、解码、缩略图、波形等内部步骤。`MediaItemReadyResolver` 负责汇总子图结果，并把稳定结果同步回 media item、cache 或项目数据。

长期资源事实不依赖 DAG 保存。`MediaItemReady` 可以根据 media item 当前状态动态构建；如果资源已经 ready，resolver 的 `isSatisfied()` 可以直接返回成功结果。

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
  policy?: ResourcePolicy
}
```

```ts
export type ResourceType =
  | 'media-ready'
  | 'media-file-available'
  | 'media-decoded'
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
  /** 资源节点唯一 ID，通常为 `${type}:${key}` */
  id: string
  /** 资源类型，决定由哪个 ResourceResolver 处理 */
  type: ResourceType
  /** 同类型资源内的稳定去重键 */
  key: string
  /** 创建资源请求时传入的参数，供 resolver 执行和恢复使用 */
  input: TInput
  /** 当前资源状态 */
  status: ResourceStatus

  /** 当前节点依赖的上游资源节点 ID 列表 */
  deps: string[]
  /** 依赖当前节点的下游资源节点 ID 列表 */
  dependents: string[]

  /** 资源成功就绪后的结果 */
  result?: TResult
  /** 资源失败时的错误信息 */
  error?: { message: string; code?: string; retryable?: boolean }
  /** 资源执行进度，范围建议为 0 到 1 */
  progress?: number
  /** 当前执行阶段，例如 uploading、polling、decoding */
  stage?: string
  /** 面向任务中心展示的简短状态文案 */
  message?: string

  /** 调度、持久化、恢复和重试策略 */
  policy: ResourcePolicy

  /** 节点创建时间，使用 ISO 字符串 */
  createdAt: string
  /** 节点最近更新时间，使用 ISO 字符串 */
  updatedAt: string
}
```

### Policy

```ts
export interface ResourcePolicy {
  priority?: number
  queue?: 'remote' | 'local-heavy' | 'export' | 'background'
  maxRetries?: number
}
```

Policy 描述资源节点的运行策略。它不决定资源是什么，也不参与资源去重；资源身份仍然只由 `type + key` 决定。Policy 只告诉 Runtime 和 Scheduler：这个节点应该以什么优先级进入哪个队列，以及失败后最多允许重试多少次。

字段含义：

- `priority`: 调度优先级。相同资源被多处请求时，后来的请求可以提高已有节点的优先级，但不应该降低已有优先级。
- `queue`: 节点使用的并发队列。远程请求、重型本地计算、导出、后台任务应进入不同队列，避免互相阻塞。
- `maxRetries`: 最大重试次数，用于限制自动重试或用户重复重试带来的资源消耗。

Policy 不应该保存业务对象关系，例如 clip、media item、project 的来源信息。这类关系如果后续 TaskCenter 需要定位来源，应放在 `bindings` 之类的业务绑定元数据里。

示例：

```ts
const request: ResourceRequest = {
  type: 'remote-task-completed',
  key: 'bizyair:request_123',
  input: { provider: 'bizyair', taskId: 'request_123' },
  policy: {
    queue: 'remote',
    priority: 80,
    maxRetries: 3,
  },
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
}
```

Resolver 是某一类资源的执行适配器。Runtime 只负责维护资源图、去重、依赖边、状态机、调度和事件；具体“这个资源怎样才算 ready”由对应的 Resolver 决定。

Resolver 的职责：

- 判断资源是否已经满足，避免重复执行。
- 声明当前资源依赖哪些上游资源。
- 在依赖完成后执行实际工作。
- 把执行进度、阶段、领域事件回传给 Runtime。
- 在取消、重试时提供资源类型相关的处理逻辑。

Resolver 不应该负责全局调度、跨资源去重、TaskCenter UI 组织，也不应该直接保存长期业务事实。长期事实应写回业务域对象、缓存或项目数据；DAG 只保存本次执行需要的运行态。

方法含义：

- `type`: Resolver 支持的资源类型。Runtime 根据 `request.type` 找到对应 Resolver。
- `getKey(input)`: 根据输入生成稳定 key。`type + key` 决定资源去重和恢复身份，所以 key 必须稳定、可复现，不能包含随机数、临时对象引用或会话态信息。
- `isSatisfied(ctx)`: 可选的快速检查。资源已经 ready 时直接返回结果，Runtime 可以跳过依赖构建和执行。例如媒体文件已经存在、缩略图已经在缓存里。
- `getDependencies(ctx)`: 可选的依赖声明。返回当前资源运行前必须先满足的资源请求。Runtime 会把这些请求加入 DAG，并在依赖全部成功后再调度当前节点。
- `resolve(ctx)`: 当前资源真正的执行逻辑。它只应该假设依赖已经完成，然后把当前资源推进到 ready，并返回结果。
- `cancel(ctx)`: 可选的取消逻辑。用于中断上传、导出、远程轮询、本地计算等资源类型相关工作。

Resolver 的典型调用顺序：

```text
ensure(request)
  -> resolver.getKey(input)
  -> Runtime 用 type + key 查找或创建 ResourceNode
  -> resolver.isSatisfied(ctx)
  -> resolver.getDependencies(ctx)
  -> Runtime ensure(dependency requests)
  -> Scheduler 等依赖成功
  -> resolver.resolve(ctx)
  -> Runtime 标记 succeeded / failed / cancelled
```

`resolve()` 内也可以调用 `ctx.ensure(...)` 动态创建更细的子资源，但优先使用 `getDependencies()` 声明静态依赖。这样 Runtime 更容易提前构建 DAG，TaskCenter 也能更早展示完整子步骤。

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

`ResolveContext` 是 Runtime 暴露给 Resolver 的执行上下文：

- `node`: 当前资源节点，可读取 id、状态、policy、已有错误等运行态。
- `input`: 创建资源请求时的输入参数。
- `signal`: 取消信号。Resolver 内部的异步工作应监听它，避免取消后继续写状态。
- `ensure(request)`: 请求另一个资源 ready。适合动态依赖或 `resolve()` 内部需要复用其他资源结果的场景。
- `update(patch)`: 更新当前节点进度、阶段和展示文案。
- `emit(event)`: 发布领域事件，让 MediaModule、TimelineModule 等业务模块同步自己的状态。

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
  -> RemoteTaskSubmitted(input)
  -> RemoteTaskCompleted(provider, remoteTaskId)
  -> MediaReady(resultMediaId)
```

解释：

- 输入准备、导出和上传属于各自业务链路内部步骤，不单独抽成共享资源节点。
- 后端 AI、BizyAir 直连都可以抽象成 `RemoteTaskCompleted`。
- 生成结果最终落到媒体库，并通过 `MediaReady` 解码。

### ASR 字幕

```text
ASRSubtitles(clipId)
  -> ASRTaskSubmitted(clipId)
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

JobRuntime 是业务模块访问 DAG 系统的唯一入口。业务模块不直接调用 Resolver，也不直接操作 Scheduler；它只向 JobRuntime 声明“我需要某个资源 ready”，再等待结果、取消、重试或查询状态。

JobRuntime 和 Resolver 的分工：

```text
JobRuntime 负责“编排”：
  接收资源请求、生成 resourceId、去重、创建节点、连接依赖边、维护状态机、调度、取消传播、重试、基于业务事实重建、事件分发。

Resolver 负责“实现”：
  判断某类资源是否已满足、声明依赖、执行具体工作、处理该资源类型自己的取消和恢复逻辑。
```

换句话说，JobRuntime 不知道媒体怎么解码、远程任务怎么轮询、字幕怎么生成；Resolver 也不应该知道全局 DAG 里还有多少等待者、哪些节点共享、父子取消怎么传播。两者通过 `ResourceRequest`、`ResourceNode` 和 `ResolveContext` 协作。

```ts
class JobRuntime {
  ensure<T>(request: ResourceRequest): Promise<T>
  cancel(resourceId: string): Promise<boolean>
  retry(resourceId: string): Promise<boolean>
  getNode(resourceId: string): ResourceNode | undefined
}
```

方法含义：

- `ensure(request)`: 业务方声明需要某个资源 ready。Runtime 会根据 `type + key` 去重，必要时创建节点，调用 Resolver 检查和声明依赖，把节点交给 Scheduler 执行，并在资源成功时返回结果。
- `cancel(resourceId)`: 取消某个资源路径。Runtime 负责判断哪些子节点只被当前路径独占，只有独占子节点才会继续向下取消；共享子节点不能被误取消。
- `retry(resourceId)`: 重试失败或取消的资源。Runtime 负责重置节点状态、检查重试次数、决定是否需要重算下游节点，并重新进入调度。
- `getNode(resourceId)`: 查询当前运行态节点，供 TaskCenter 或调试面板展示状态、进度、错误和依赖关系。

`ensure()` 的内部流程：

```text
business module
  -> jobRuntime.ensure(request)
  -> Runtime 计算 resourceId = type + key
  -> Runtime 查找或创建 ResourceNode
  -> Runtime 调用 Resolver.isSatisfied()
  -> Runtime 调用 Resolver.getDependencies()
  -> Runtime 递归 ensure 依赖节点并连接 DAG 边
  -> Scheduler 在依赖成功后调度当前节点
  -> Runtime 调用 Resolver.resolve()
  -> Runtime 更新状态、唤醒等待者、发布事件、返回 result
```

JobRuntime 的 API 应保持资源语义，不暴露具体实现步骤。便捷方法可以存在，但它们只是构造标准 `ResourceRequest` 后调用 `ensure()`：

便捷 API：

```ts
await jobRuntime.ensureMediaReady(mediaId)
await jobRuntime.ensureAIGeneratedMedia(input)
```

等价于：

```ts
await jobRuntime.ensure(MediaReady(mediaId))
await jobRuntime.ensure(AIGeneratedMedia(input))
```

因此，业务入口应该依赖 JobRuntime；资源类型的具体实现应该放在 Resolver；队列并发和节点状态推进应该放在 Scheduler / Runtime 内部。

## 调度规则

DAG Scheduler 的规则：

- 节点所有依赖成功后才可运行。
- 任一依赖失败，当前节点进入 `blocked` 或 `failed`。
- 相同 `resourceId` 只保留一个节点，请求方共享结果。
- 后来的请求可以提高 priority。
- 取消父节点时，取消只由它独占的子节点；共享子节点不能被误取消。
- 重试节点时，可选择只重试失败节点，或连同下游节点一起重算。

并发队列：

```text
remote       AI、ASR、视觉摘要、远程轮询
local-heavy  媒体解码、智能分镜
export       项目导出
background   模板下载、后台摘要
```

## 运行态 DAG 生命周期

DAG 是运行态调度结构，不是长期资源数据库。

长期资源状态应由业务域对象或缓存保存，例如：

```text
mediaItem.mediaStatus
mediaItem.localPath
mediaItem.duration
mediaItem.thumbnail
mediaItem.waveform
project metadata
cache manifest
```

ResourceNode 只保存本次执行所需的运行态信息：

```text
当前状态
依赖边
等待者
取消控制器
进度
错误
短期 result
```

每次业务调用 `ensure(root)` 可以视为一次 root 路径执行。root 跑完后，Runtime 递归检查这条路径上的节点是否可以释放：

```text
release(root)
  -> root external reference - 1
  -> 如果 root 已结束且没有引用，则释放 root
  -> 断开 root 到 deps 的边
  -> 递归检查 deps 是否也可以释放
```

节点释放条件：

```ts
function canRelease(node: ResourceNode) {
  return isTerminal(node.status)
    && node.externalRefCount === 0
    && node.waiterCount === 0
    && node.dependents.length === 0
}
```

共享依赖不能被单条路径误释放：

```text
TimelineClipReady(clipA) -> MediaItemReady(media_1)
TimelineClipReady(clipB) -> MediaItemReady(media_1)
```

当 `clipA` 的路径完成时，只能断开 `clipA -> MediaItemReady(media_1)` 这条边。只有没有其他 dependents、没有外部等待者，并且节点已进入终态时，`MediaItemReady(media_1)` 才能被释放。

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

MVP 阶段 `canRevealSource` 可以先固定为 `false`，等引入业务绑定后再支持定位来源。

## 媒体和 Timeline 状态同步

Runtime 不直接修改 timeline clip。

MVP 阶段，Runtime 不记录资源和业务对象的映射关系。业务模块在调用 `ensure(...)` 时自己保留上下文，通过 `await` 结果或订阅特定 `resourceId` 的事件同步 UI。

它发布资源事件：

```ts
export type ResourceEvent =
  | { type: 'resource:created'; node: ResourceNode }
  | { type: 'resource:updated'; node: ResourceNode }
  | { type: 'resource:succeeded'; node: ResourceNode }
  | { type: 'resource:failed'; node: ResourceNode }
  | { type: 'resource:cancelled'; node: ResourceNode }
```

TimelineModule 示例：

```ts
timelineModule.markClipLoading(clipId)

try {
  await jobRuntime.ensureMediaReady(mediaId)
  timelineModule.markClipReady(clipId)
} catch (error) {
  timelineModule.markClipError(clipId, error)
}
```

也可以由业务模块自行维护映射：

```ts
const request = MediaReady(mediaId)
const resourceId = `${request.type}:${request.key}`

timelineResourceMap.set(clipId, resourceId)
```

然后按 `resourceId` 订阅状态：

```text
media-ready queued/running -> timelineItem.timelineStatus = loading
media-ready succeeded      -> timelineItem.timelineStatus = ready
media-ready failed         -> timelineItem.timelineStatus = error
media-ready cancelled      -> timelineItem.timelineStatus = cancelled
```

MediaModule 同理按自己维护的 `mediaId -> resourceId` 映射同步状态：

```text
media-ready queued/running -> mediaItem.mediaStatus = pending/asyncprocessing/decoding
media-ready succeeded      -> mediaItem.mediaStatus = ready
media-ready failed         -> mediaItem.mediaStatus = error
media-ready cancelled      -> mediaItem.mediaStatus = cancelled
```

## 持久化与恢复

不持久化 `ResourceNode`。持久化的是业务事实，恢复时再重建 DAG。

可持久化：

- media meta 中的 task id / result data / status
- timeline placeholder 上的活动任务事实
- timeline / project snapshot
- 其他业务对象自己的长期状态

不可持久化：

- `ResourceNode`
- `deps` / `dependents`
- AbortController
- Promise / scheduler queue
- File、Blob、Bunny runtime object
- API Key

## 后续扩展：业务绑定

如果后续 TaskCenter 需要“定位来源”、按 clip / project / directory 过滤任务，或应用重启后恢复资源和业务对象的 UI 映射，可以再引入可选的 `bindings` 元数据。

`bindings` 不参与资源去重、依赖解析和调度，只表达资源和业务对象的关联。

```ts
export type ResourceBinding =
  | { type: 'media-item'; id: string }
  | { type: 'timeline-item'; id: string }
  | { type: 'directory'; id: string }
  | { type: 'effect-template'; id: string }
  | { type: 'project'; id: string }
```

扩展后的接口可以是：

```ts
export interface ResourceRequest<TInput = unknown> {
  type: ResourceType
  key: string
  input: TInput
  policy?: ResourcePolicy
  bindings?: ResourceBinding[]
}

class JobRuntime {
  getNodesByBinding(binding: ResourceBinding): ResourceNode[]
}
```

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

TaskCenter 负责把这张图展示给用户，并提供取消、重试等操作；定位来源可以在后续引入业务绑定后扩展。
