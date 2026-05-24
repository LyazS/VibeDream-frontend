# AIGeneratedMedia DAG 实施方案

## 文档目的

这份文档说明如何把 AI 生成媒体接入 Resource-first DAG。

重点不是重新设计一套任务持久化系统，而是基于当前代码已经存在的事实模型，把 AI 生成从旧 Processor 主链迁到 DAG：

- 远程提交、远程完成、本地媒体 ready 进入统一资源图
- 持久化仍以 `mediaItem.source` / media meta 为唯一事实源
- 应用重启后根据已保存的素材事实重建 DAG，而不是恢复旧 DAG 快照

代码基线核对时间：2026-05-24。

## 当前代码事实

现有 AI 生成链路已经把关键进度保存进 media meta。

`AIGenerationSourceData` 的持久化字段是：

```ts
interface BaseAIGenerationSourceData {
  type: 'ai-generation'
  aiTaskId: string
  requestParams: MediaGenerationRequest
  resultData?: TaskResultData
  taskStatus: TaskStatus
}
```

对应代码：

- [AIGenerationSource.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/ai-generation/AIGenerationSource.ts:20)
- [extractAIGenerationSourceData()](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/ai-generation/AIGenerationSource.ts:107)
- [metaTypes.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/project/metaTypes.ts:114)

这几个字段已经表达了 AI 生成任务的长期事实：

- `aiTaskId` 存在：远程任务已经提交过
- `taskStatus`：远程任务状态
- `resultData` 存在：远程结果已经返回给前端
- `mediaStatus === 'ready'` 且本地文件存在：本地媒体已经真正交付

因此，第一版 `AIGeneratedMedia` 不需要额外引入 DAG task snapshot。

## 不做 DAG Snapshot 持久化

第一版明确不做：

- 不保存整张 DAG
- 不保存 `ResourceNode` 快照文件
- 不保存 `deps` / `dependents`
- 不保存运行中 `progress` / `stage` / `message`
- 不恢复旧的 Promise / AbortController / Scheduler 队列

这些都是运行态，不是业务事实。

长期事实只保存在 media meta 中。项目加载后，由 media meta 重建 `mediaItem`，再由 `mediaItem.source` 反推出应该继续哪条 DAG。

这样可以避免双写：

- media meta 一份事实
- DAG 一份运行态

## 推荐资源图

运行时资源图仍然建议拆成四段：

```text
AIGeneratedMedia(mediaId)
  -> UploadedResource(...)
  -> RemoteTaskSubmitted(mediaId)
  -> RemoteTaskCompleted(provider, taskId)
  -> MediaReady(mediaId)
```

注意这里的关键变化：

- `RemoteTaskSubmitted` 是运行时节点，不要求单独持久化
- `RemoteTaskSubmitted` 成功后的持久化结果是写回 `mediaItem.source.aiTaskId`
- `RemoteTaskCompleted` 成功后的持久化结果是写回 `mediaItem.source.resultData` 和 `taskStatus`
- `AIGeneratedMedia` 的恢复入口来自 `mediaItem.source`，不是来自 DAG snapshot

## 为什么仍然保留 `remote-task-submitted`

虽然不单独持久化这个节点，但它在运行时仍然有价值。

### 1. 分清提交和完成

远程提交和远程完成是两个阶段：

- `remote-task-submitted`：提交请求，拿到 `taskId`
- `remote-task-completed`：根据 `taskId` 继续监听或轮询

拆开后，cancel 和 retry 的执行语义更清楚。

### 2. `taskId` 是 submitted 的业务结果

不需要把 `remote-task-submitted` 节点落盘。

只要它成功后把 `taskId` 写回 `mediaItem.source`，这个阶段的长期事实就已经保存了。

### 3. 重启后可以跳过 submitted

恢复时：

- 如果 `source.aiTaskId` 存在，说明提交已发生，直接重建 `remote-task-completed`
- 如果 `source.aiTaskId` 不存在，才需要走 `remote-task-submitted`

这正好复用了现有代码里的事实判断。

## 持久化模型

## 唯一事实源

第一版唯一事实源是 media meta。

也就是：

```text
media/{mediaId}.meta
  -> source.aiTaskId
  -> source.requestParams
  -> source.taskStatus
  -> source.resultData
  -> mediaStatus
```

DAG 节点只负责运行时编排。

## 状态含义

### 未提交

```text
source.aiTaskId 不存在
```

含义：

- 远程任务尚未提交
- 需要从 `remote-task-submitted` 开始

当前 `BaseAIGenerationSourceData.aiTaskId` 是必填字段。DAG 化后建议允许它为空，或者为待提交状态引入单独 source 形态。

### 已提交

```text
source.aiTaskId 存在
source.resultData 不存在
source.taskStatus 不是 COMPLETED / FAILED / CANCELLED
```

含义：

- 远程任务已经提交
- 本地没有拿到最终结果
- 恢复时应直接进入 `remote-task-completed`

### 远程已完成

```text
source.resultData 存在
source.taskStatus === COMPLETED
```

含义：

- 远程结果已经交付给前端
- 如果本地文件不存在，可以直接通过 `resultData` 重新下载结果
- 不需要重新提交，也不需要重新轮询

### 本地已完成

```text
mediaItem.mediaStatus === 'ready'
本地 media 文件存在
```

含义：

- 整个 AI 生成媒体已经交付
- `AIGeneratedMediaResolver.isSatisfied()` 应直接返回成功

### 失败或取消

```text
source.taskStatus === FAILED
source.taskStatus === CANCELLED
mediaItem.mediaStatus === 'error' | 'cancelled'
```

含义：

- 不应自动恢复为 running
- 需要用户显式 retry

## 恢复策略

恢复不是恢复旧 DAG，而是从 media facts 重建 DAG。

项目加载后扫描 `mediaItems`：

```text
for each mediaItem:
  if mediaItem.source.type is ai-generation or bizyair:
    if mediaItem.mediaStatus is ready and local file exists:
      skip
    if source has recoverable task facts:
      ensureAIGeneratedMedia(mediaId)
```

`AIGeneratedMediaResolver` 内部再根据 source 状态决定下一步。

## 恢复决策表

```text
media ready + local file exists
  -> AIGeneratedMedia succeeded

local file missing + resultData exists
  -> skip submitted/completed
  -> download result
  -> MediaReady(mediaId)

aiTaskId exists + resultData missing + taskStatus is running-like
  -> skip submitted
  -> RemoteTaskCompleted(provider, taskId)
  -> MediaReady(mediaId)

aiTaskId missing + requestParams exists
  -> RemoteTaskSubmitted(mediaId)
  -> RemoteTaskCompleted(provider, taskId)
  -> MediaReady(mediaId)

taskStatus failed/cancelled
  -> do not auto resume
  -> wait for explicit retry
```

## 与现有 Processor 行为的对应关系

当前 `AIGenerationProcessor.prepareFileForMediaItem()` 已经有类似恢复分支：

- 本地文件存在：从本地恢复
- `source.resultData` 存在：从远程结果重新取文件
- `source.aiTaskId` 存在：继续监听进行中的任务

对应代码：

- [AIGenerationProcessor.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/datasource/providers/ai-generation/AIGenerationProcessor.ts:455)

DAG 化时不需要推翻这个模型。需要做的是把这些分支从旧 Processor 主执行链迁到 resolver：

- 本地文件存在：`AIGeneratedMediaResolver.isSatisfied()`
- `resultData` 存在：`AIGeneratedMediaResolver.resolve()` 走结果下载和 `media-ready`
- `aiTaskId` 存在：动态 ensure `remote-task-completed`
- 没有 `aiTaskId`：动态 ensure `remote-task-submitted`

## 节点职责

## `ai-generated-media`

业务 root 节点。

输入建议：

```ts
interface AIGeneratedMediaInput {
  mediaId: string
}
```

第一版不建议把完整请求体复制进 DAG input，因为 `mediaItem.source` 已经是事实源。

resolver 通过 `mediaId` 读取：

- `mediaItem`
- `mediaItem.source`
- `requestParams`
- `aiTaskId`
- `taskStatus`
- `resultData`

职责：

- 判断 AI 生成媒体是否已经 ready
- 根据 `source` 事实选择从哪个阶段继续
- 动态 ensure `remote-task-submitted`
- 动态 ensure `remote-task-completed`
- 动态 ensure `media-ready`
- 把远程阶段结果写回 `mediaItem.source`

request 工厂：

```ts
function createAIGeneratedMediaRequest(mediaId: string): ResourceRequest<AIGeneratedMediaInput> {
  return {
    type: 'ai-generated-media',
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'remote',
      maxRetries: 3,
    },
  }
}
```

`policy.persist` 第一版可以不启用，因为恢复来自 media meta。

## `uploaded-resource`

负责把 AI 请求中的本地输入转换为远程 URL。

第一版可以收敛范围：

- 支持无上传输入
- 支持当前 AI 面板已支持的单文件上传
- 复用现有 uploader 能力

输出不需要单独持久化为 DAG snapshot。

如果上传结果已经写进 `source.requestParams` 或可由 `requestParams` 表达，项目恢复时可直接复用。

## `remote-task-submitted`

负责提交远程任务。

输入建议：

```ts
interface RemoteTaskSubmittedInput {
  mediaId: string
  provider: 'backend' | 'bizyair'
}
```

resolver 通过 `mediaId` 读取 `mediaItem.source.requestParams`。

成功后必须写回：

```ts
source.aiTaskId = submitted.taskId
source.taskStatus = PENDING or provider equivalent
saveMetaFile(mediaItem)
```

这是 submitted 阶段的持久化点。

## `remote-task-completed`

负责等待远程任务完成。

输入建议：

```ts
interface RemoteTaskCompletedInput {
  mediaId: string
  provider: 'backend' | 'bizyair'
  taskId: string
}
```

key：

```text
provider + taskId
```

成功后必须写回：

```ts
source.resultData = result
source.taskStatus = COMPLETED or provider equivalent
saveMetaFile(mediaItem)
```

这是 completed 阶段的持久化点。

失败或取消也必须写回 meta。

## `media-ready`

继续复用现有节点。

AI 生成结果完成后，最终仍然应该通过：

```ts
ensureMediaReady(mediaId)
```

让本地文件保存、解码、状态转换进入已有媒体 ready 链路。

## Store 接入

当前 `unifiedStore` 已暴露：

- `ensureMediaReady(mediaId)`
- `ensureTimelineItemReady(timelineItemId)`

需要新增：

```ts
function ensureAIGeneratedMedia(mediaId: string) {
  return jobRuntime.ensure(createAIGeneratedMediaRequest(mediaId))
}
```

并注册 resolver：

- `createUploadedResourceResolver(...)`
- `createRemoteTaskSubmittedResolver(...)`
- `createRemoteTaskCompletedResolver(...)`
- `createAIGeneratedMediaResolver(...)`

## UI 入口迁移

## AI 生成主入口

文件：

- [useAIGeneration.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/aipanel/aigenerate/composables/useAIGeneration.ts:402)

迁移后流程：

1. 构造 `requestParams`
2. 创建占位 `mediaItem`
3. 把 `requestParams` 写进 `mediaItem.source`
4. 保存 meta
5. 调 `unifiedStore.ensureAIGeneratedMedia(mediaItem.id)`

UI 不再直接负责完整远程提交和完成监听。

## 素材库重试

文件：

- [LibraryMediaGrid.vue](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/components/panels/LibraryMediaGrid.vue:1681)

迁移后：

- 如果是失败的 AI 生成媒体，重置必要 source 字段
- 调 `ensureAIGeneratedMedia(mediaId)` 重新推进
- 不再手写远程提交和旧 Processor 入口

重试语义建议：

- 保留 `requestParams`
- 清空 `aiTaskId`
- 清空 `resultData`
- 设置 `taskStatus = PENDING`
- 设置 `mediaStatus = 'pending'`
- 保存 meta
- 重新 ensure root

## 项目加载恢复

项目加载时已经会从 meta 文件恢复 media items：

- [MediaItemLoader.ts](/Users/airzostorm/Documents/aivideoeditor/LightCut-frontend/src/core/managers/media/MediaItemLoader.ts:1)

需要补一个恢复入口：

```ts
function restoreAIGeneratedMediaJobs() {
  for (const mediaItem of getAllMediaItems()) {
    if (!isRecoverableAIGeneratedMedia(mediaItem)) continue
    void ensureAIGeneratedMedia(mediaItem.id)
  }
}
```

`isRecoverableAIGeneratedMedia()` 建议：

```text
source.type is ai-generation or bizyair
mediaStatus is not ready/error/cancelled
source.taskStatus is not FAILED/CANCELLED
source has aiTaskId or requestParams
```

如果 `mediaStatus === 'ready'` 但本地文件缺失，现有 loader 会标记为 `missing`。这种情况也可以进入 `ensureAIGeneratedMedia()`，由 resolver 使用 `resultData` 重新取回文件。

## Provider 适配

resolver 不应该直接写死具体 provider API。建议抽出 adapter：

```ts
interface AIGeneratedMediaProviderAdapter {
  provider: 'backend' | 'bizyair'
  submit(mediaItem: UnifiedMediaItemData, signal: AbortSignal): Promise<{ taskId: string }>
  waitForCompletion(
    mediaItem: UnifiedMediaItemData,
    taskId: string,
    signal: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<unknown>
  cancel(taskId: string): Promise<void>
}
```

第一版可以先迁后端代理链路，再迁 BizyAir 直接调用。

## 第一版不做 TaskCenter 展示

`AIGeneratedMedia` 第一版目标是打通执行链路，不要求完善 TaskCenter UI 展示。

resolver 可以保留最小的 `progress` 更新，供调试和后续 UI 使用，但验收不依赖任务中心是否能展示完整阶段。

后续如果要接 TaskCenter，再补：

- root / child 任务组织
- 任务来源绑定
- 展开子步骤
- cancel / retry 操作映射

## 第一版实施顺序

1. 新增 `remote-task-submitted` resource type
2. 新增 `createAIGeneratedMediaRequest(mediaId)`
3. 新增 provider adapter 基础接口
4. 实现 `RemoteTaskSubmittedResolver`
5. 实现 `RemoteTaskCompletedResolver`
6. 实现 `AIGeneratedMediaResolver`
7. 在 `unifiedStore` 暴露 `ensureAIGeneratedMedia(mediaId)`
8. 迁移 `useAIGeneration` 主入口
9. 迁移 `LibraryMediaGrid` retry
10. 增加项目加载后的 AI 生成任务恢复入口

## 验收标准

完成后应满足：

- AI 生成主入口不再调用旧 `startMediaProcessing`
- `aiTaskId` 写入 meta 后，重启不会重复提交
- `resultData + COMPLETED` 写入 meta 后，重启可重新拉取本地文件
- `mediaStatus=ready` 且本地文件存在时，不会重新跑远程任务
- 失败 / 取消状态不会自动恢复运行
- retry 可以重新提交新任务

## 结论

`AIGeneratedMedia` 的 DAG 化不需要先做 DAG snapshot 持久化。

当前代码已经具备更简单的事实模型：

- `aiTaskId` 表示提交已发生
- `taskStatus + resultData` 表示远程结果交付状态
- `mediaStatus + 本地文件` 表示本地媒体交付状态

第一版应沿用这个模型：

- media meta 是唯一持久化事实源
- DAG 只负责运行时编排
- 恢复时从 `mediaItem.source` 重建资源图

这样可以把 AI 生成接入 DAG，同时避免 media meta 和 DAG snapshot 两套状态互相打架。
