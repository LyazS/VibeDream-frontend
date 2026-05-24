# Task Center DAG 下一步实施路线

## 文档目的

这份文档只回答两件事：

- DAG 目前在代码里已经做到什么程度。
- 接下来应该按什么顺序继续做。

它不是概念设计稿，也不是时间轴迁移复盘。默认读者已经接受 Resource-first DAG 方向，现在只需要一份面向实施的路线图。

代码核对时间：2026-05-23。

## 当前基线

目前已经落地的部分：

- `JobRuntime`、`DagScheduler`、resolver registry、`TaskViewAdapter` 已存在。
- `media-file-available`、`media-decoded`、`media-source-processed`、`media-ready` 已存在。
- `timeline-item-ready` 已存在。
- `unifiedStore` 已暴露：
  - `ensureMediaReady(mediaId)`
  - `ensureTimelineItemReady(timelineItemId)`
- 时间轴 clip ready 主链路已经迁到 DAG：
  - 添加 clip
  - 删除 clip 后 undo
  - 删除轨道后 undo
  - 项目恢复
- `loading` clip 的大部分编辑入口已经被拦住，避免在未 ready 时继续编辑。
- `MediaSync`、`rebuildForCmd()`、`updateMediaData()` 兼容层已经移除。

当前这套实现可以被视为：

- **本地媒体 ready DAG MVP 已完成**
- **时间轴 clip ready DAG MVP 已完成**
- **远程任务 DAG、可恢复 DAG、完整 TaskCenter 仍未完成**

## 当前边界

现阶段 DAG 真正覆盖的范围只有两类资源：

1. 本地媒体资源就绪
2. 时间轴 clip 从 `loading` 推进到 `ready`

还没有正式接入 DAG 的能力：

- ASR
- AI 生成媒体
- 视觉摘要
- 效果模板
- 场景检测
- 导出
- 应用重启后的任务恢复
- 任务来源绑定和 UI 过滤

因此现在的 DAG 更像：

- 一个已经可用的本地资源调度内核
- 还不是全产品级的统一任务系统

## 剩余工作总览

后续工作建议分成五个阶段：

1. 远程资源 DAG 化
2. 持久化与恢复
3. TaskCenter 完整化
4. 旧 Processor / 旧队列职责迁移
5. 收尾与验收

推荐顺序不要反过来。原因很简单：

- 没有远程资源接入，TaskCenter 只是展示本地 ready 过程，业务价值有限。
- 没有持久化恢复，远程任务 DAG 只能活在当前会话里，不够可靠。
- 没有来源绑定，TaskCenter 难以真正服务业务界面。

## Phase 1：远程资源 DAG 化

### 目标

把设计里已经定义但尚未落地的资源类型逐步接上：

- `uploaded-resource`
- `remote-task-completed`
- `asr-task-submitted`
- `ai-generated-media`
- `asr-subtitles`
- `visual-summary`
- `effect-template-ready`
- `scene-boundaries`
- `exported-project`

### 建议顺序

先做下面两条，其它能力都可以复用它们：

1. `remote-task-completed`
2. `uploaded-resource`

然后再接业务聚合资源：

1. `ai-generated-media`
2. `asr-subtitles`
3. `effect-template-ready`
4. `visual-summary`
5. `scene-boundaries`
6. `exported-project`

### 原因

`remote-task-completed` 是所有远程链路的公共基础。`uploaded-resource` 主要服务可复用上传产物的链路，例如 `ai-generated-media`。像 `asr-subtitles` 这类一次性消费任务，更适合把导出、上传、提交合并到专用的提交节点里；否则会把恢复边界拆得过细。

### Phase 1.1：`uploaded-resource`

资源语义：

- 输入：本地文件、blob、media item 或稳定内容指纹
- 输出：远程可复用的上传结果

要求：

- key 必须稳定，优先使用内容哈希或可复用的上传身份
- 多个业务同时上传同一资源时要去重
- 取消必须中断上传
- 后续需要支持持久化恢复

### Phase 1.2：`remote-task-completed`

资源语义：

- 输入：远程 provider、taskId、查询参数
- 输出：远程任务完成后的标准化结果

要求：

- 抽象统一的 polling / stream 监听接口
- resolver 内要处理：
  - pending
  - processing
  - succeeded
  - failed
  - cancelled
- `cancel()` 需要能向后端发取消请求
- 后续 `restore()` 需要支持断线重连或重新轮询

### Phase 1.3：`asr-subtitles`

这是最适合下一步落地的聚合资源。

建议语义：

```text
ASRSubtitles(requestId)
  -> ASRTaskSubmitted(requestId)
  -> RemoteTaskCompleted(asrProvider, taskId)
  -> Materialize subtitles to timeline
```

其中 `ASRTaskSubmitted` 第一版就应该独立成资源；它不是单纯的“后端 submit API 调用”，而是这次一次性字幕任务真正的前置阶段：

- 导出 clip 对应音频
- 上传音频
- 提交 ASR 任务
- 持久化 `taskId`

`Materialize subtitles to timeline` 第一版不一定要独立成资源，建议先放进 `ASRSubtitles.resolve()` 内部完成：

- 基于远端结果生成字幕 timeline items
- 删除占位符 clip

这条链路的持久化上下文建议挂在 **placeholder timeline item 自身**，而不是单独创建 ASR `mediaItem` 或项目级 ASR 结果资产。因为：

- source clip 只负责发起和提供提交阶段输入
- 提交完成后，真正代表“时间轴上有一个正在跑的字幕任务”的对象是 placeholder
- 最终结果只体现在时间轴字幕 items 上，不需要保留 ASR 结果资产
- 恢复时真正需要的只是“当前是否还有一个活动中的 ASR placeholder”

建议 placeholder 上只保留一个通用的活动任务槽位，例如：

```ts
placeholder.task = {
  kind: 'asr-subtitles'
  requestId: string
  remoteTaskId?: string
  status: 'pending' | 'processing'
  sourceTimelineItemId: string
}
```

其中：

- `kind` 用来区分不同类型的占位任务，避免后续继续堆 `asr`、`sceneDetection` 之类的专属槽位
- `requestId` 是这次 ASR 请求的本地身份
- `remoteTaskId` 是远端任务身份，也是恢复时是否跳过提交阶段的唯一依据
- `sourceTimelineItemId` 用来保留来源关联，并在启动前检查同一 source item 是否已有活动任务

source item 不需要再挂运行态，只需要在发起阶段参与创建 placeholder，并在 placeholder 上留下 `sourceTimelineItemId` 作为 provenance 即可。

实现约束建议明确为：

- 一个 source timeline item 同一时刻只允许一个活动中的 ASR 任务
  这个约束通过检查是否已存在引用该 sourceTimelineItemId 的活动 placeholder 来保证
- 用户如果重试，不复用旧任务上下文，而是重新生成新的 `requestId`，从提交阶段重新开始
- `placeholder.task` 只在 `pending` / `processing` 阶段存在
- 一旦进入任意终态（`completed` / `failed` / `cancelled`），统一删除 placeholder

这个设计和 `ai-generated-media` 有一个关键差异：

- `ai-generated-media` 需要保留生成结果资产，因此上传结果值得抽成独立资源复用
- `asr-subtitles` 是一次性消费，最终只保留时间轴字幕 clip，不保留 ASR 结果资产

因此 `asr-subtitles` 的恢复边界应该定义为：

- 没有 `remoteTaskId`：重新执行 `ASRTaskSubmitted`
- 已有 `remoteTaskId`：跳过导出、上传、提交，直接进入 `RemoteTaskCompleted`
- 已进入任意终态：不恢复旧任务；如果用户想继续，只能重新发起新的 ASR 请求

迁移目标：

- 让现有 [ASRProcessor.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/asr/ASRProcessor.ts) 逐步退出主执行链路
- 保留必要的 provider 适配逻辑，但不再负责全局任务编排

### Phase 1.4：`ai-generated-media`

建议语义：

```text
AIGeneratedMedia(requestKey)
  -> UploadedResource(...)
  -> RemoteTaskCompleted(provider, taskId)
  -> MediaReady(generatedMediaId)
```

迁移目标：

- 替代现有 AI processor / start processing 入口
- 避免素材库、目录、面板各自维护一套重试逻辑

代码里已经有明确待迁移入口：

- [LibraryMediaGrid.vue](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/components/panels/LibraryMediaGrid.vue:1708)

## Phase 2：持久化与恢复

### 目标

让 DAG 从“会话内运行态”升级成“可恢复运行态”。

当前状态：

- `ResourcePolicy.persist` 字段已存在
- `ResourcePolicy.restore` 字段已存在
- 真正的落盘和恢复流程尚未实现

### 需要实现的能力

1. 运行态节点序列化

需要明确哪些字段可落盘：

- `id`
- `type`
- `key`
- `input`
- `status`
- `deps`
- `dependents`
- `policy`
- `retryCount`
- `error`
- `progress`
- `stage`
- `message`
- `createdAt`
- `updatedAt`

不要落盘：

- `AbortController`
- Promise
- 业务运行时对象引用

2. Runtime 启动恢复入口

建议增加类似 API：

```ts
jobRuntime.restore(serializedNodes)
```

3. resolver 级恢复语义

需要真正执行 `restore()`：

- `resume`
- `recompute`
- `mark-failed`
- `ignore`

4. 远程任务恢复

这是最重要的实际场景：

- ASR 进行中
- AI 生成进行中
- 用户刷新或重启应用
- TaskCenter 恢复节点
- Runtime 重新绑定轮询 / stream

### 实施建议

不要一开始就做“完整 DAG 快照系统”。先做：

1. 只持久化 `persist: true` 的 root 节点
2. 恢复时由 root 节点重新构建依赖
3. 本地临时依赖节点继续走 `recompute`

这样复杂度更可控。

## Phase 3：TaskCenter 完整化

### 当前状态

已有基础投影和操作入口：

- `getTaskViews()`
- `useJobTaskCenter()`
- `cancelTask()`
- `retryTask()`

但这还只是 MVP。

### 需要补齐的能力

1. root / child 任务组织

TaskCenter 要能清楚区分：

- 聚合资源
- 子依赖资源

例如：

```text
asr-subtitles:req_123
  ├─ asr-task-submitted:req_123
  └─ remote-task-completed:provider_task_yyy
```

2. 来源定位

设计里提过 `bindings`，这一步需要正式加上。

建议结构：

```ts
bindings?: {
  kind: 'timeline-item' | 'media-item' | 'project' | 'directory'
  id: string
}
```

用于：

- TaskCenter 按业务对象过滤
- 从任务跳回 clip / media / project
- 项目恢复后重建 UI 映射

3. 历史与已完成任务保留窗口

现在节点成功后会尽量释放。TaskCenter 如果需要“刚完成任务还能看到”，要引入轻量历史层，而不是阻止 Runtime 释放节点。

建议：

- Runtime 继续释放非共享节点
- TaskCenter 单独保存最近 N 条终态任务摘要

4. 更完整的用户操作

- retry root task
- cancel root task
- 查看依赖链
- 展开错误详情
- 过滤运行中 / 失败 / 已完成

## Phase 4：旧 Processor / 队列职责迁移

### 目标

把“任务编排”从现有各类 Processor 中移到 DAG。

要迁走的职责：

- 队列并发控制
- 共享去重
- 远程轮询
- cancel / retry 协调
- 任务状态展示映射

保留在 provider / service 层的职责：

- 调后端 API
- 上传文件
- 解析返回值
- 执行局部业务落地

### 建议做法

旧 Processor 不要一次性物理删除，先降级为 provider adapter：

- ASRProcessor -> ASR provider adapter
- AI processor -> AI provider adapter
- template processor -> template provider adapter

判断标准：

- 不再自行维护全局任务队列
- 不再自行维护跨任务 retry / cancel
- 不再承担 TaskCenter 状态源

## Phase 5：收尾与验收

### 验收标准

达到以下条件，才算 DAG 真正从 MVP 进入主系统：

1. 本地资源 ready 链路稳定

- `media-ready`
- `timeline-item-ready`

2. 至少一条远程链路稳定

建议优先要求：

- `asr-subtitles`

3. 至少一条 AI 生成链路稳定

- `ai-generated-media`

4. 应用重启后可恢复进行中的远程任务

5. TaskCenter 能清楚展示 root task 和子依赖

6. 旧 Processor 不再是任务真相来源

### 收尾清单

- 删除旧任务入口的兼容注释
- 删除旧 processor 中不再使用的调度逻辑
- 删除旧重试入口
- 统一业务模块只通过 `jobRuntime.ensure(...)` 触发资源
- 统一 cancel / retry 都通过 `JobRuntime`

## 推荐实施顺序

建议按下面顺序推进，不建议跳步：

1. `remote-task-completed`
2. `uploaded-resource`
3. `asr-task-submitted`
4. `asr-subtitles`
5. 持久化 root 节点
6. 远程任务恢复
7. TaskCenter `bindings`
8. `ai-generated-media`
9. `effect-template-ready`
10. `visual-summary`
11. `scene-boundaries`
12. `exported-project`
13. 清理旧 Processor 编排职责

## 下一步建议

如果只选一个下一阶段目标，建议直接做：

**`asr-subtitles` DAG 化。**

原因：

- 它天然需要 loading clip / 后台补全，和当前时间轴 ready 设计最一致。
- 它能逼出 `remote-task-completed`、恢复、TaskCenter 展示这几层真正的问题。
- 它比导出链路更容易分阶段落地。

如果只选一个基础能力先做，建议做：

**`remote-task-completed`。**

原因：

- 这是所有远程资源 DAG 的公共底座。
- 先做它，后面的 ASR、AI、视觉摘要都能复用。
