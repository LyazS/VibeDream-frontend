# ASRSubtitles DAG 实施方案

## 文档目的

这份文档说明如何把时间轴字幕识别接入 Resource-first DAG。

这里的目标不是把旧 `ASRProcessor` 原样搬进 resolver，而是把 ASR 重构成一条**一次性消费**的时间轴任务链路：

- 任务从 source timeline item 发起
- 运行中的任务状态挂在 placeholder timeline item 自身
- 远程任务完成后直接生成字幕 timeline items
- 不创建 ASR `mediaItem`
- 不保留 ASR 结果资产
- 任意终态后清理运行上下文，用户重试时从头重新发起

代码基线核对时间：2026-05-24。

## 当前代码事实

当前 ASR 入口仍在时间轴右键菜单：

- [useTimelineContextMenu.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/composables/useTimelineContextMenu.ts:710)

当前流程是：

```text
导出音频
-> 上传到 BizyAir
-> 提交 ASR 任务
-> 创建 placeholder timeline item
-> 创建 ASR text mediaItem
-> 交给旧 Processor
```

但代码已经明确禁止继续走旧主链：

- [useTimelineContextMenu.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/composables/useTimelineContextMenu.ts:825)

旧实现里，ASR 任务事实挂在 `ASRSourceData` / media meta 上：

```ts
interface BaseASRSourceData {
  type: 'asr'
  asrTaskId: string
  requestConfig: ASRRequestConfig
  resultData?: ASRTaskResultData
  taskStatus: ASRTaskStatus
  sourceTimelineItemId?: string
  placeholderTimelineItemId?: string
}
```

对应代码：

- [ASRSource.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/asr/ASRSource.ts:54)
- [metaTypes.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/project/metaTypes.ts:129)

旧 `ASRProcessor` 还承担了两类本不该耦合在一起的职责：

1. 远程任务监听与取消
2. 时间轴副作用落地

尤其是 [ASRProcessor.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/asr/ASRProcessor.ts:323) 里的 `processASRResult()`，同时做了：

- 删除 placeholder
- 生成字幕 items
- 删除临时 ASR media item

这正是 DAG 化时要拆开的边界。

## 设计结论

ASR 和 `ai-generated-media` 不一样。

`ai-generated-media` 的最终结果是一个可长期存在、可复用的素材资产。  
`asr-subtitles` 的最终结果只是时间轴上的一组字幕 items。

因此第一版 ASR DAG 应遵守这几个原则：

- 不保留 ASR 结果资产
- 不保留 ASR `mediaItem`
- 不单独保留上传结果
- 上传属于“提交任务”的一部分
- 运行中状态只挂在 placeholder timeline item 上
- 任务结束后清理运行状态

## 推荐资源图

推荐资源图如下：

```text
ASRSubtitles(requestId)
  -> ASRTaskSubmitted(requestId)
  -> RemoteTaskCompleted(asrProvider, taskId)
  -> Materialize subtitles to timeline
```

三段职责分别是：

### `asr-task-submitted`

职责：

- 导出 source clip 对应音频
- 上传音频
- 提交 ASR 任务
- 把 `taskId` 写回 placeholder timeline item 的通用 `task` 字段

这一步是恢复边界。

只要 `taskId` 已经存在，就认为“提交成功已经发生”，恢复时直接跳过导出、上传、提交。

### `remote-task-completed`

职责：

- 基于现有 `taskId` 监听或轮询远程任务
- 处理 `pending / processing / succeeded / failed / cancelled`
- 远端取消时向后端发取消请求

这一步不关心时间轴副作用，只负责把远端任务推进到终态。

### `asr-subtitles`

职责：

- 组织依赖
- 读取远端成功结果
- 生成字幕 timeline items
- 删除 placeholder

`ASRSubtitles` 的成功语义不是“拿到 ASR JSON”，而是：

```text
字幕 items 已经成功落到时间轴
并且 placeholder 已清理
```

## 持久化模型

## 唯一事实源

第一版不做 DAG snapshot 持久化。

长期事实只保存在项目已有业务对象里：

- placeholder timeline item
- 最终生成出的字幕 timeline items

不保存：

- `ResourceNode` 快照
- `deps` / `dependents`
- Scheduler 队列
- Promise / AbortController
- 旧 ASR `mediaItem`

## placeholder 上的活动态

不要为 ASR 单独加一个 `asr` 槽位。更合适的做法是给 placeholder 增加一个通用活动任务槽位，例如 `task`：

```ts
interface PlaceholderTaskState {
  kind: 'asr-subtitles'
  requestId: string
  remoteTaskId?: string
  status: 'pending' | 'processing'
  sourceTimelineItemId: string
}
```

字段含义：

- `kind`：声明这是哪一类占位任务，后续可扩展到别的 placeholder 型任务
- `requestId`：本地这次任务请求的稳定身份
- `remoteTaskId`：远端任务身份，也是恢复是否跳过 submitted 的唯一依据
- `status`：只表达活动中的任务阶段
- `sourceTimelineItemId`：记录这次任务最初从哪个 source item 发起

这里故意不保留 `failed / cancelled / completed`。

因为这条链路的设计结论是：

- 终态不保留历史任务记录
- 用户重试时从头来过

## placeholder 的角色

placeholder 不只是临时 UI 锚点，也是这条运行中任务的持久化宿主。

建议至少保存：

```ts
{
  isPlaceholder: true
  task: {
    kind: 'asr-subtitles'
    requestId: string
    remoteTaskId?: string
    status: 'pending' | 'processing'
    sourceTimelineItemId: string
  }
}
```

它承担五个职责：

- 给用户展示“这段区域正在生成字幕”
- 作为恢复时扫描到的活动任务事实源
- 作为最终字幕落位的时间/轨道锚点
- 保留与 source item 的来源关联
- 终态清理时精准删除

原因是提交完成之后，远程 ASR 任务已经不再依赖 source item 持续存在；真正代表“时间轴上有一个正在跑的字幕任务”的对象，其实就是 placeholder。现有实现里，最终字幕落位也已经是以 placeholder 的时间和轨道为准，而不是回到 source item 上取位置：

- [ASRProcessor.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/asr/ASRProcessor.ts:345)

source timeline item 在这条链路里更适合扮演：

- 提交阶段的输入来源
- 创建 placeholder 时的初始定位依据
- 可选的业务 provenance

## 最终字幕 items

第一版不要求在每个字幕 item 上保留 ASR request 元数据。

原因是这条链路已经明确：

- 完成后删除 placeholder
- 不打算保留历史 ASR 任务记录

因此最终字幕 items 只需要作为普通文本 timeline items 存在即可。

如果后续产品要支持“按一次 ASR 批量回滚整组字幕”，再额外给字幕 items 加 `asrRequestId` 即可。第一版先不做。

## 状态机

placeholder 上的 `task` 只在活动期间存在。

状态机建议如下：

```text
start
  -> create requestId
  -> create placeholder
  -> placeholder.task = { kind: asr-subtitles, requestId, status: pending, sourceTimelineItemId }
  -> ASRTaskSubmitted

submitted
  -> placeholder.task.remoteTaskId = xxx
  -> placeholder.task.status = processing
  -> RemoteTaskCompleted

completed
  -> materialize subtitles
  -> remove placeholder

failed
  -> remove placeholder

cancelled
  -> remove placeholder
```

约束：

- 同一个 source timeline item 同一时刻只允许一个活动中的 ASR 任务
  这个约束通过“启动前检查是否已存在引用该 sourceTimelineItemId 的活动 placeholder”来保证
- 任意终态后都不保留运行态
- 用户重试总是重新生成新的 `requestId`

## 恢复策略

恢复不是恢复旧 DAG，而是从 placeholder 的业务事实重建 DAG。

项目加载后扫描 timeline items：

```text
for each placeholder timeline item:
  if placeholder.task 不存在:
    skip
  if placeholder.task.kind !== asr-subtitles:
    skip
  if placeholder.task.remoteTaskId 不存在:
    ensure ASRSubtitles(requestId) from submitted phase
  if placeholder.task.remoteTaskId 存在:
    ensure ASRSubtitles(requestId) from completed phase
```

更准确地说：

- `placeholder.task` 不存在：说明它不是活动任务，不恢复
- `placeholder.task.kind !== 'asr-subtitles'`：说明它属于别的占位型任务，不走 ASR 恢复
- `placeholder.task.remoteTaskId` 不存在：说明提交阶段还没成功，重新走 `ASRTaskSubmitted`
- `placeholder.task.remoteTaskId` 存在：跳过提交，直接进入 `RemoteTaskCompleted`

由于终态会统一删除 placeholder，所以：

- 不需要恢复已完成任务
- 不需要恢复已失败任务
- 不需要恢复已取消任务

## 取消与重试

## cancel

取消入口统一走 `JobRuntime.cancel(resourceId)`。

ASR 链路需要做到：

- 如果已有 `taskId`，先请求后端取消远程任务
- 然后删除 placeholder

取消后不保留任何可恢复状态。

## retry

第一版不做“在原任务上 retry”。

用户点击重试时，语义应等价于再次发起一条新的 ASR 请求：

- 重新创建新的 `requestId`
- 重新创建 placeholder
- 重新执行导出、上传、提交

也就是说，retry 实际上是“重新开始”，不是“恢复旧任务”。

## 与现有代码的迁移对应

建议把旧 ASR 代码拆成三部分复用：

### 保留的 provider 能力

从 [ASRProcessor.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/asr/ASRProcessor.ts) 中保留：

- `submitASRTask()`
- 监听/轮询远程任务的逻辑
- 取消远程任务的逻辑

这些能力应该下沉为 provider adapter，而不是继续承担主编排职责。

### 抽出的本地 materializer

把当前 `processASRResult()` 里的时间轴副作用抽成一个独立本地函数：

- 输入：source timeline item、placeholder、ASR 结果
- 输出：字幕 items 已写入时间轴

它不应该再依赖 `ASRSourceData` 或 `mediaItem`。

### 删除的旧过渡层

删除这部分旧设计：

- 创建 ASR text `mediaItem`
- 把 ASR 挂进媒体库
- 通过 `startMediaProcessing` 或旧 Processor 队列推进

## 实施步骤

建议按下面顺序落地：

1. 为 placeholder 增加 `asr` 活动态结构，至少包含 `requestId`、`taskId?`、`status`、`sourceTimelineItemId`。
2. 约定启动前用 `sourceTimelineItemId` 去检查是否已有活动 placeholder，维持“一段 source clip 同时只跑一个 ASR”。
3. 抽出 ASR provider adapter：submit / poll / cancel。
4. 实现 `ASRTaskSubmittedResolver`。
5. 复用通用 `RemoteTaskCompletedResolver`，或补足其 provider 适配。
6. 实现 `ASRSubtitlesResolver`，内部完成字幕 materialize 和终态删除 placeholder。
7. 改 [useTimelineContextMenu.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/composables/useTimelineContextMenu.ts:710)，不再创建 ASR `mediaItem`，而是直接触发 `jobRuntime.ensure(createASRSubtitlesRequest(...))`。
8. 删除旧 ASR Processor 主链入口。

## 验收标准

满足下面这些条件，第一版可以认为完成：

1. 用户在时间轴 clip 上发起 ASR 时，不再创建 ASR `mediaItem`。
2. 任务运行中，placeholder 上存在 `asr` 活动态，且 placeholder 正常显示。
3. 应用重启后，如果 placeholder 上 `taskId` 已存在，能够直接恢复到远程监听阶段。
4. 任务成功后，字幕 items 落到时间轴，placeholder 被删除。
5. 任务失败或取消后，placeholder 被删除。
6. 用户重试时会重新创建新请求，并从导出/上传/提交开始。
7. 旧 `ASRProcessor` 不再是主编排入口。
