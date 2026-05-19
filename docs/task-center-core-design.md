# TaskCenter 核心设计

## 目标

TaskCenter 的目标不是容纳所有异步任务细节，而是解决一个核心问题：

> 前端异步任务必须只有一个真相源，其他对象只是投影。

当前系统里 `mediaItem.mediaStatus`、`source.taskStatus`、`timelineItem.timelineStatus` 都能表达任务状态，且 Processor、MediaSync、Command 都会触发副作用。这会导致状态互相矛盾、恢复逻辑困难、时间轴更新难追踪。

TaskCenter 只负责三件事：

1. 管理任务生命周期。
2. 编排任务执行器。
3. 在状态变化时统一更新投影和持久化。

不把所有业务细节塞进 TaskCenter。远端 API、下载、解码、ASR 字幕生成等业务逻辑仍放在专门的执行器或 hook 中。

## 核心原则

### 1. Task 是唯一真相源

运行中任务的状态只以 `Task` 为准。

```ts
interface Task {
  id: string
  status: TaskStatus
  step?: string
  progress: number
  errorMessage?: string
  config: TaskConfig
}
```

`mediaItem.mediaStatus`、`timelineItem.timelineStatus`、UI 进度条都不是任务真相，只是从 `Task` 派生出来的投影。

### 2. 状态机只管生命周期

TaskCenter 只定义少量稳定状态：

```ts
type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
```

合法转换：

```txt
PENDING   -> RUNNING | FAILED | CANCELLED
RUNNING   -> COMPLETED | FAILED | CANCELLED
FAILED    -> PENDING | CANCELLED
CANCELLED -> PENDING
```

`acquiring`、`decoding`、`uploading`、`processing` 不进入状态机。它们只是 `step` 标签，由执行器上报，用于 UI 和旧状态投影。

```ts
function taskToMediaStatus(task: Task): MediaStatus {
  if (task.status === 'PENDING') return 'pending'
  if (task.status === 'RUNNING') {
    return task.step === 'decoding' ? 'decoding' : 'asyncprocessing'
  }
  if (task.status === 'COMPLETED') return 'ready'
  if (task.status === 'FAILED') return 'error'
  return 'cancelled'
}
```

### 3. Config 是恢复契约

`TaskConfig` 必须包含恢复任务所需的最小信息，不能依赖运行时对象。

```ts
type TaskConfig =
  | UserSelectedTaskConfig
  | AIGenerationTaskConfig
  | BizyAirTaskConfig
  | ASRTaskConfig

interface BaseTaskConfig {
  type: TaskType
}

interface MediaBoundTaskConfig extends BaseTaskConfig {
  mediaItemId: string
}

interface UserSelectedTaskConfig extends MediaBoundTaskConfig {
  type: 'user-selected'
  filePath: string
  fileName: string
}

interface AIGenerationTaskConfig extends MediaBoundTaskConfig {
  type: 'ai-generation'
  aiTaskId: string
  requestParams: MediaGenerationRequest
  taskStatus?: string
  resultData?: AIResultData
}
```

`BaseTaskConfig` 只放所有任务都成立的稳定字段。像 `mediaItemId` 这种“任务关联到某个媒体对象”的信息，应该下沉到专门的 config 分支里，而不是绑死在所有任务上。

不可变字段创建后不能被 executor 修改，例如 `type`、`mediaItemId`、远端任务 ID、请求参数、本地文件路径。

运行时字段可以更新，例如 `taskStatus`、`resultData`。这些字段用于更快恢复，但不能成为唯一恢复依据。

## 模块边界

最小模块如下：

```txt
core/taskcenter/
  TaskCenterModule.ts
  types.ts
  StateMachine.ts
  ExecutorRegistry.ts
  TaskPersistenceManager.ts
  hooks/
    projectionHooks.ts
    persistenceHooks.ts
    timelineHooks.ts
  executors/
    TaskExecutor.ts
    UserSelectedExecutor.ts
    AIGenerationExecutor.ts
    BizyAirExecutor.ts
    ASRExecutor.ts
```

先不要设计过大的 hook framework。核心只需要三类 hook：

1. `projection`：同步 `mediaItem` 和 `timelineItem`。
2. `persistence`：保存 task 文件、meta 文件、媒体文件。
3. `timeline`：把 ready 的 media materialize 到 timeline item。

通知、统计、复杂清理可以之后再加。

## 执行器边界

执行器只负责拿到产物。

```ts
interface TaskExecutor<TConfig extends TaskConfig> {
  type: TConfig['type']
  execute(ctx: ExecuteContext<TConfig>, config: TConfig): Promise<TaskResult>
  cancel?(taskId: string, config: TConfig): Promise<boolean>
}

interface ExecuteContext<TConfig extends TaskConfig> {
  taskId: string
  signal: AbortSignal
  setStep(step: string): void
  updateProgress(progress: number): void
  updateConfig(patch: RuntimeConfigPatch<TConfig>): void
}
```

执行器负责：

- 远端 API 通信。
- 轮询或 SSE。
- 文件下载或读取。
- 解码前必要准备。
- 上报进度和 step。

执行器不负责：

- 修改 `mediaItem.mediaStatus`。
- 修改 `timelineItem.timelineStatus`。
- 保存 meta。
- 发送通知。
- 创建或删除时间轴项。

## 持久化模型

采用两层持久化，但这里只描述当前最重要的 media-bound task。

```txt
project/
  media/
    {mediaId}
    {mediaId}.meta
  tasks/
    {taskId}.json
```

运行中任务：

- `tasks/{taskId}.json` 是真相。
- 对 media-bound task，`media/{mediaId}.meta` 只需要能指向 task，例如保存 `taskId`。

终态任务：

- 对 media-bound task，`media/{mediaId}.meta` 写入完整 `config` 和终态结果摘要。
- task 文件只有在终态 meta 成功写入后才能清理。

关键约束：

- `PENDING/RUNNING`：先写 task，再写 projection meta。
- `COMPLETED`：先保存媒体文件，再写 self-contained meta，再清理 task。
- `FAILED/CANCELLED`：写 self-contained meta，保留可重试的 `config`。
- 如果 task 文件和 meta 冲突，只要 task 文件存在，优先信任 task 文件。

不要把不可序列化对象放入 task 文件，例如 `File`、`AbortController`、bunny runtime 对象。

## 关键流程

### 提交任务

```txt
submitTask(config)
  -> 创建 Task(PENDING)
  -> 写 tasks/{taskId}.json
  -> 如有投影对象则写 projection meta
  -> media-bound task 投影 mediaStatus=pending
  -> 进入并发队列
```

`submitTask` 必须是异步接口，因为保存 task/meta 失败时任务不应被认为已提交。

```ts
async function submitTask(config: TaskConfig): Promise<string>
```

### 执行任务

```txt
PENDING -> RUNNING
  -> executor.execute()
    -> setStep()
    -> updateProgress()
    -> updateConfig()
  -> 成功：保存产物并转 COMPLETED
  -> 失败：转 FAILED
```

### 完成任务

```txt
executor 返回 TaskResult
  -> 保存媒体文件
  -> 更新 mediaItem runtime 投影
  -> 写 self-contained meta
  -> materialize 关联 timelineItem
  -> task 转 COMPLETED
  -> 清理 task 文件
```

注意：不要在 task 文件里只写 `COMPLETED` 却不保存可恢复结果。否则崩溃发生在 meta 写入前，重开后无法恢复。更安全的做法是把 `COMPLETED` 视为“产物和 meta 都已提交成功”的状态。

### 项目重开

```txt
加载 tasks/
加载 media/*.meta

如果 media meta 有 taskId：
  -> 找对应 task
  -> task 为 RUNNING 时回退为 PENDING
  -> 根据 task 投影 mediaItem 状态
  -> 重新入队执行

如果 media meta 有 config 且无 taskId：
  -> 按终态素材加载，不创建 task

如果 projection meta 找不到 task：
  -> 标记 mediaItem 为 error
```

执行器必须具备幂等恢复能力：

- 本地文件已存在则直接使用。
- 有远端任务 ID 则优先查询远端状态。
- 有 `resultData` 则优先从结果恢复。
- 只有远端任务不存在或已过期时才重新提交。

## Timeline 处理

不要让 Command 创建 `MediaSync` watcher。

抽出一个显式的 materializer：

```ts
async function materializeTimelineItemFromMedia(
  timelineItem: UnifiedTimelineItemData,
  mediaItem: UnifiedMediaItemData,
): Promise<void>
```

它负责：

- 用 media 的尺寸、duration、bunny runtime 更新 timelineItem。
- 调用 `setupTimelineItemBunny()`。
- 设置 `timelineStatus = 'ready'`。

TaskCenter 完成任务时调用它。

Command 添加已经 ready 的素材到时间轴时也调用它。

这样可以替代 `MediaSync` 的 watcher，同时不会丢失“ready 素材立即添加到时间轴”的场景。

## 最小迁移路径

### Phase 1：骨架，不破坏旧流程

- 新增 TaskCenter、TaskPersistence、ExecutorRegistry。
- 保持旧 Processor 和旧 meta schema 可用。
- 只做 shadow 观测或内部测试，不切主链路。

不要在 Phase 1 就拒绝旧 `source` meta，否则现有项目加载和现有 Processor 会同时被破坏。

### Phase 2：迁移 user-selected

这是最适合的垂直切片。

```txt
用户选择文件
  -> 先写入 media/{mediaId}
  -> 创建 UserSelectedTaskConfig(filePath, fileName)
  -> submitTask()
  -> executor 从磁盘读取文件
  -> 解码
  -> 保存 meta
  -> timeline ready
```

验证：

- 拖入图片、视频、音频。
- 项目重开。
- 失败重试。
- timeline 添加、撤销、重做。

### Phase 3：迁移远端任务

按风险从低到高迁移：

1. AI generation。
2. BizyAir。
3. ASR。

每迁移一种任务，都必须验证：

- 首次执行。
- 进度更新。
- 取消。
- 强制关闭后恢复。
- 失败后重试。
- 本地文件存在时不重复下载。
- 远端任务 ID 存在时不重复提交。

### Phase 4：删除旧系统

全部任务类型迁移后再删除：

- `BaseDataSourceProcessor`
- 各类旧 Processor
- `MediaStatusService`
- `MediaSync`
- `TimelineItemTransitioner`

## 非目标

第一版不解决这些问题：

- 完整旧项目迁移。
- 通知系统重构。
- 复杂 hook 插件化。
- 任务历史审计。
- 后台跨项目任务调度。
- 多窗口并发编辑冲突。

这些可以后续扩展，但不应该进入 TaskCenter 的核心设计。

## 结论

核心设计可以收敛为一句话：

> TaskCenter 管生命周期，Executor 拿产物，Hook 做投影和持久化。

只要这个边界稳定，系统就能从当前的 Processor + MediaSync 隐式耦合，逐步迁移到可恢复、可测试、可扩展的异步任务架构。
