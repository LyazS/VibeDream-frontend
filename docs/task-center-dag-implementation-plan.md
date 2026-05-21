# LightCut Resource-first 任务中心渐进式实施计划

## 实施原则

这次迁移不要一次性推翻现有 datasource。

现有 `UnifiedDataSourceData` 继续承担“资源来源描述”和“持久化业务 payload”的职责，例如用户选择文件、AI 生成参数、远程 task id、resultData。新增的 `JobRuntime` 先接管执行图、队列、去重、取消、重试和任务中心展示。

迁移顺序遵循：

```text
新增 Runtime -> 包装现有 Processor -> 替换媒体入口 -> 拆出 Resolver -> 迁移远程任务 -> 清理旧 Processor
```

每个阶段都应该保持编辑器可运行，旧 datasource processor 在未迁移完成前作为兼容层存在。

## 统一调试日志要求

任务中心迁移期间必须增加足够的调试打印，并使用统一前缀，方便直接复制控制台日志排查问题。

统一前缀：

```text
[DAG-JobRuntime]
[DAG-ResourceNode]
[DAG-ResourceResolver]
[DAG-DagScheduler]
[DAG-TaskCenter]
[DAG-MediaReady]
[DAG-RemoteTask]
[DAG-ASRSubtitles]
```

日志格式建议：

```text
[DAG-JobRuntime] ensure:start resourceId=media-ready:media_123 type=media-ready key=media_123 bindings=media-item:media_123
[DAG-ResourceNode] status resourceId=media-ready:media_123 queued -> running stage=decode progress=35
[DAG-ResourceResolver] deps resourceId=media-ready:media_123 deps=media-file-available:media_123,media-decoded:media_123
[DAG-DagScheduler] run resourceId=media-decoded:media_123 queue=local-heavy attempt=1
[DAG-TaskCenter] action cancel rootResourceId=media-ready:media_123
```

每条关键日志至少包含：

- `resourceId`
- `type`
- `key`
- `status` 或状态变化
- `stage`
- `progress`
- `attempt`
- `bindings`
- 错误时的 `error.message`、`error.code`、`retryable`

必须打印的生命周期点：

- `ensure:start`：业务方请求资源。
- `node:create`：创建新 `ResourceNode`。
- `node:dedupe`：命中已有节点。
- `deps:resolved`：resolver 返回依赖。
- `scheduler:queued`：进入调度队列。
- `scheduler:run`：开始执行 resolver。
- `node:progress`：进度或阶段变化。
- `node:succeeded`：节点成功。
- `node:failed`：节点失败。
- `node:cancelled`：节点取消。
- `retry:start`：重试开始。
- `restore:start`：恢复开始。

日志实现建议：

- 新增 `src/core/jobs/JobLogger.ts`，集中封装日志格式。
- 默认开发环境开启详细日志。
- 生产环境可以保留错误和关键状态日志，详细日志受开关控制。
- 避免在 resolver 中手写分散格式，统一走 `JobLogger.debug/info/warn/error`。

用户复制日志排查时，优先提供：

```text
[DAG-JobRuntime]
[DAG-ResourceNode]
[DAG-ResourceResolver]
[DAG-DagScheduler]
[DAG-TaskCenter]
```

这几个前缀的完整片段。

## 阶段 0：现状固化与边界确认

目标：先把当前行为固定下来，避免后续迁移时不知道是否回归。

状态：已完成现状基线文档，见 [task-center-dag-phase0-baseline.md](./task-center-dag-phase0-baseline.md)。

改动范围：

- 梳理现有入口：
  - `UnifiedMediaModule.startMediaProcessing`
  - `UnifiedMediaModule.cancelMediaProcessing`
  - `UnifiedMediaModule.waitForMediaItemReady`
  - `DataSourceRegistry`
  - 各类 `DataSourceProcessor`
- 补充最小测试或手工验收清单：
  - 用户导入图片、视频、音频。
  - 项目加载已有媒体。
  - AI 生成结果下载并解码。
  - BizyAir 已完成任务恢复。
  - ASR 生成字幕。
  - 处理中取消、失败展示、重试入口。

验收标准：

- 不引入 `JobRuntime` 前，当前媒体导入和远程任务路径行为有明确基线。
- 明确哪些 processor 方法会被 resolver 复用，哪些会被废弃。

回滚边界：

- 本阶段只读或补测试，不改运行路径。

## 阶段 1：新增 JobRuntime 骨架

目标：引入资源图运行时，但暂不接管真实业务入口。

状态：已完成 `src/core/jobs/` 骨架并从 `src/core/index.ts` 导出；当前不接入业务入口。

验证记录：

- `npm run type-check:no-generate` 通过。
- `npm run build-only` 通过。
- 使用 `/private/tmp/lightcut-job-runtime-smoke.mjs` 临时 smoke 脚本验证通过：
  - 假 resolver 可跑通 `ensure()`。
  - 相同 `resourceId` 并发 ensure 只执行一次。
  - 第二次 ensure 的 bindings 会追加到同一 `ResourceNode`。
  - `TaskViewAdapter` 可看到 `succeeded`、`progress=100`、stage/message/bindings。
  - 控制台日志包含 `[DAG-JobRuntime] ensure:start`、`[DAG-ResourceNode] node:create/node:dedupe/node:succeeded`、`[DAG-DagScheduler] scheduler:queued/scheduler:run`。

新增目录：

```text
src/core/jobs/
  JobRuntime.ts
  JobLogger.ts
  ResourceTypes.ts
  ResourceResolver.ts
  ResourceResolverRegistry.ts
  DagScheduler.ts
  TaskViewAdapter.ts
  index.ts
```

核心能力：

- `ResourceRequest`、`ResourceNode`、`ResourceStatus`、`ResourceBinding`、`ResourcePolicy` 类型。
- `ResourceResolver` 接口。
- `JobRuntime.ensure(request)`。
- 同 `resourceId = type:key` 去重。
- 追加 bindings。
- 基础状态流转：`queued -> running -> succeeded/failed/cancelled`。
- `cancel(resourceId)` 和 `retry(resourceId)` 的空实现或最小实现。
- `TaskViewAdapter` 将 `ResourceNode` 投影为任务中心数据。
- `JobLogger` 输出统一前缀和统一字段。

暂不做：

- 持久化恢复。
- 复杂 DAG 共享取消。
- 替换 datasource processor。
- 替换 UI 状态。

验收标准：

- 可以用假 resolver 跑通 `ensure()`。
- 相同 resource 被多次 ensure 只执行一次。
- TaskView 能看到节点状态和进度。
- 控制台能按 `[DAG-JobRuntime]`、`[DAG-ResourceNode]`、`[DAG-DagScheduler]` 过滤出完整生命周期日志。

回滚边界：

- 新代码未接入业务入口，关闭注册即可。

## 阶段 2：媒体 ready 兼容接入

目标：让 `MediaReady` 资源跑通，但内部先复用现有 processor。

状态：已完成 `MediaReadyResolver` 单节点兼容接入；`UnifiedMediaModule.startMediaProcessing`、`waitForMediaItemReady`、`cancelMediaProcessing` 已优先走 `media-ready:<mediaId>`，旧 datasource processor 路径保留为 fallback。

验证记录：

- `npm run type-check:no-generate` 通过。
- `npm run build-only` 通过，仍有既有 Vite chunk 循环提示 `vendor -> vue-vendor -> vendor`，构建成功。
- 使用 `/private/tmp/lightcut-media-ready-smoke-entry.mjs` 临时 smoke 脚本验证通过：
  - 假旧 processor 可被 `MediaReadyResolver` 包装并推进 `pending -> asyncprocessing -> decoding -> ready`。
  - 同一个 `media-ready:<mediaId>` 并发 ensure 两次只触发一次旧 `processor.addTask()`。
  - 第二次 ensure 的 `timeline-item` binding 会追加到同一 `ResourceNode`。
  - `TaskViewAdapter` 可看到 `succeeded`、`progress=100`、`stage=ready`、message/bindings。
  - 控制台日志包含 `[DAG-MediaReady] media-ready:legacy-processor:start`、`[DAG-ResourceNode] node:dedupe/node:succeeded`。

新增 resolver：

```text
resolvers/
  MediaReadyResolver.ts
```

第一版资源图可以先简化：

```text
MediaReady(mediaId)
```

`MediaReadyResolver.resolve()` 内部逻辑：

1. 从 `UnifiedMediaModule` 找到 `mediaItem`。
2. 如果 `mediaItem.mediaStatus === 'ready'`，直接返回。
3. 如果还未处理，调用现有 datasource processor 路径。
4. 等待 `mediaStatus` 进入 `ready/error/cancelled/missing`。
5. 通过 `ctx.update()` 同步进度和阶段。

接入方式：

- 保留 `startMediaProcessing(mediaItem)` 原函数名。
- 函数内部从 `processor.addTask(mediaItem)` 改为：

```ts
jobRuntime.ensureMediaReady(mediaItem.id, {
  bindings: [{ type: 'media-item', id: mediaItem.id }],
})
```

- `cancelMediaProcessing(mediaId)` 改为优先取消 `media-ready:${mediaId}`。
- `waitForMediaItemReady(mediaId)` 改为优先 await `ensureMediaReady(mediaId)`。

兼容策略：

- 如果 `JobRuntime` 未初始化或 resolver 未注册，回退旧 processor 路径。
- `DataSourceRuntimeState.progress/errorMessage` 暂时继续写，避免现有 UI 断掉。
- 旧 processor 的关键日志可以暂时保留，但新增日志必须带 `[DAG-MediaReady]` 或 `[DAG-ResourceResolver]` 前缀。

验收标准：

- 用户选择文件导入行为不变。
- 素材库进度和错误展示不变。
- 同一个媒体被多个时间轴 item 等待时，只产生一个 `media-ready` 节点。
- 任务中心能看到媒体 ready 任务。
- 复制 `media-ready:<mediaId>` 相关日志可以看出是否命中缓存、是否进入旧 processor、最终失败在哪个阶段。

回滚边界：

- 保留旧 processor 路径作为 fallback。

## 阶段 3：拆分媒体本地资源图

目标：把媒体 ready 从单节点拆成可复用 DAG。

状态：已完成 `user-selected` 本地媒体资源图拆分；`MediaReadyResolver` 对本地媒体改为依赖 `media-decoded`，`MediaDecodedResolver` 再依赖 `media-file-available`。AI/BizyAir/ASR 等非本地来源仍保留阶段 2 的旧 processor 兼容路径。

验证记录：

- `npm run type-check:no-generate` 通过。
- `npm run build-only` 通过，仍有既有 Vite chunk 循环提示 `vendor -> vue-vendor -> vendor`，构建成功。
- 使用 `/private/tmp/lightcut-media-dag-phase3-smoke-entry.mjs` 临时 smoke 脚本验证通过：
  - `media-ready:<mediaId>` 会创建并等待 `media-decoded:<mediaId>`。
  - `media-decoded:<mediaId>` 会创建并等待 `media-file-available:<mediaId>`。
  - `USER_CREATE` 文件准备会验证文件、设置 `mediaType`、清空 `selectedFile`、推进 `source.progress=100`。
  - 解码节点会写入 `runtime.bunny` 和 `duration`，最终由 `MediaReadyResolver` 转为 `ready`。
  - 同一媒体并发 ensure 两次仍只产生一组 DAG 节点，旧 processor `addTask()` 未被调用。
  - 节点 `deps/dependents` 关系正确，日志包含 `[DAG-ResourceResolver] deps:resolved`、`[DAG-MediaReady] media-file-available:user-create`、`media-decoded:succeeded`、`media-ready:local-dag:succeeded`。
- 使用 `/private/tmp/lightcut-media-dag-phase3-file-fail-entry.mjs` 临时 smoke 脚本验证通过：
  - 不支持的文件类型会让 `media-file-available:<mediaId>` 失败。
  - `media-decoded:<mediaId>` 和 `media-ready:<mediaId>` 会携带同一依赖失败原因失败。
  - `mediaItem.mediaStatus` 会同步为 `error`，`source.errorMessage` 保留文件准备失败原因。

新增 resolver：

```text
MediaFileAvailableResolver.ts
MediaDecodedResolver.ts
```

资源图：

```text
MediaReady(mediaId)
  -> MediaFileAvailable(mediaId)
  -> MediaDecoded(mediaId)
```

职责划分：

- `MediaFileAvailableResolver`
  - 用户创建：消费 `selectedFile`，验证文件，保存到项目目录。
  - 项目加载：从项目目录读取文件。
  - AI/BizyAir 已完成：从本地文件读取，或按 `resultData` 下载。
- `MediaDecodedResolver`
  - 调用 Bunny 解码。
  - 写入 `mediaItem.runtime.bunny`、`duration`、原始尺寸、缩略图等。
- `MediaReadyResolver`
  - 只聚合依赖结果和投影最终状态。

迁移重点：

- 从 `UserSelectedFileProcessor.processMediaItem()` 中抽取文件准备和解码逻辑。
- 避免 resolver 直接修改 timeline。
- `MediaModule` 通过 resource event 将 `media-ready` 状态映射回 `mediaItem.mediaStatus`。

验收标准：

- 用户导入和项目加载仍正常。
- 本地文件准备失败只让 `media-file-available` 失败。
- 解码失败只让 `media-decoded` 失败。
- `MediaReady` 能正确展示依赖失败原因。

回滚边界：

- 保留 `UserSelectedFileProcessor`，必要时 `MediaReadyResolver` 可切回旧整包处理逻辑。

## 阶段 4：TaskCenter UI 接入

目标：任务中心从 resource graph 投影，不再直接绑定 datasource processor。

状态：已完成最小 UI 接入。`TaskViewAdapter` 现在输出依赖、反向依赖、队列和 root 标记；`UnifiedMediaModule` / `unifiedStore` 暴露通用任务视图订阅、取消和重试接口；编辑器挂载 `TaskCenterPanel`，默认展示 root resource，展开后递归展示依赖子节点。

验证记录：

- `npm run type-check:no-generate` 通过。
- `npm run build-only` 通过，仍有既有 Vite chunk 循环提示 `vendor -> vue-vendor -> vendor`，构建成功。
- 使用本地 dev server `http://127.0.0.1:5173/` 页面验证通过：
  - 编辑器能挂载任务中心，不阻塞素材库、预览区、时间轴和 AI 面板。
  - 阶段 3 导入的 `31997559724-1-192.mp4` 显示为 `media-ready` root 任务。
  - 展开 root 后能看到 `media-decoded` 和 `media-file-available` 子节点。
  - “定位素材” 操作可通过 `media-item:<mediaId>` binding 调用素材库选择。

新增或调整：

- `TaskViewAdapter` 输出 `TaskView[]`。
- TaskCenter store 或 UI composable 订阅 `JobRuntime` 节点事件。
- UI 操作调用：
  - `jobRuntime.cancel(rootResourceId)`
  - `jobRuntime.retry(rootResourceId)`
  - reveal source 通过 `bindings` 定位 media/timeline/directory。

显示策略：

- 默认展示 root resource，例如 `media-ready`、`ai-generated-media`、`asr-subtitles`。
- 展开后展示子节点，例如上传、远程任务、下载、解码。
- 进度优先使用 root node progress；没有 root progress 时由子节点聚合。

验收标准：

- 任务中心能展示媒体导入任务。
- 取消和重试走 `JobRuntime`。
- datasource 原有进度 UI 仍可用。

回滚边界：

- TaskCenter UI 可以只读 graph，不影响媒体处理主路径。

## 阶段 5：迁移远程 AI / BizyAir 生成

目标：把远程生成从 datasource processor 队列迁入 DAG。

新增 resolver：

```text
UploadedResourceResolver.ts
RemoteTaskCompletedResolver.ts
AIGeneratedMediaResolver.ts
```

资源图：

```text
AIGeneratedMedia(input)
  -> UploadedResource(input files)
  -> RemoteTaskCompleted(provider, remoteTaskId)
  -> MediaFileAvailable(resultMediaId)
  -> MediaDecoded(resultMediaId)
  -> MediaReady(resultMediaId)
```

迁移方式：

- 第一轮不要合并 AI 和 BizyAir 的提交逻辑，只在 `RemoteTaskCompletedResolver` 内按 provider 分发。
- 复用现有：
  - `AIGenerationProcessor` 的进度流监听、结果下载逻辑。
  - `BizyAirProcessor` 的轮询、下载、API key 获取逻辑。
- AbortController 迁到 `ResourceNode` 运行时上下文，不持久化。
- 远程 task id、taskStatus、resultData 暂时继续写回 source，保证项目恢复兼容。

验收标准：

- AI 生成和 BizyAir 生成可在任务中心显示子步骤。
- 刷新或重新打开项目时，已完成结果仍能加载。
- 运行中远程任务可恢复轮询或标记失败，符合 policy。
- 取消不会误取消被其他 resource 共享的子节点。
- 远程任务日志必须能串起本地 `resourceId`、provider、remote task id、stream/poll 状态和下载结果。

回滚边界：

- 保留旧 `AIGenerationProcessor` / `BizyAirProcessor` 入口，按 feature flag 切换。

## 阶段 6：迁移 ASR 字幕

目标：把 ASR 从“伪媒体 item 处理”迁到资源结果驱动。

新增 resolver：

```text
ASRSubtitlesResolver.ts
ExportedAudioResolver.ts
```

第一版资源图：

```text
ASRSubtitles(clipId)
  -> ExportedAudio(clipId)
  -> UploadedResource(audio)
  -> RemoteTaskCompleted(volcengine_asr, taskId)
```

第一版可以把字幕创建保留在 `ASRSubtitlesResolver.resolve()` 内：

- 删除占位符。
- 创建 text timeline items。
- 保存 ASR resultData。

后续再拆：

```text
SubtitlesCreated(result)
```

迁移重点：

- `ASRSourceData.sourceTimelineItemId` 和 `placeholderTimelineItemId` 继续作为兼容字段。
- 新请求优先用 `bindings` 表达 timeline 关联。
- 远程识别进度归 `remote-task-completed` 节点。

验收标准：

- ASR 成功后字幕创建行为不变。
- 失败时占位符和错误状态可定位。
- 取消时能终止远程监听并清理占位符状态。

回滚边界：

- 保留旧 `ASRProcessor` 到 ASR resolver 稳定后再删除入口。

## 阶段 7：迁移编辑器长任务

目标：把导出、视觉摘要、效果模板等长任务统一纳入 resource graph。

新增 resolver：

```text
ExportedProjectResolver.ts
EffectTemplateReadyResolver.ts
VisualSummaryResolver.ts
SceneBoundariesResolver.ts
```

导出资源图：

```text
ExportedProject(projectId)
  -> MediaReady(mediaId A)
  -> MediaReady(mediaId B)
  -> EffectTemplateReady(templateId)
  -> EncodeProject(projectId)
```

视觉摘要资源图：

```text
VisualSummary(mediaId)
  -> MediaReady(mediaId)
  -> ExportedPreview(mediaId)
  -> UploadedResource(preview)
  -> RemoteTaskCompleted(visual-summary, taskId)
```

验收标准：

- 导出前不再散落等待多个媒体状态，而是统一声明依赖。
- 长任务都能在任务中心取消、重试、定位来源。
- 后台任务和用户触发任务在 UI 上可区分。

回滚边界：

- 单个长任务独立迁移，不要求一起完成。

## 阶段 8：持久化与恢复

目标：把 resource graph 变成可恢复的执行真相。

持久化内容：

- resource type/key/input/status。
- bindings。
- provider 和 remote task id。
- result metadata。
- error 信息。
- policy。

不持久化：

- AbortController。
- File、Blob。
- Bunny runtime object。
- API key。

恢复规则：

- `resume`：重新连接进度流或重新轮询远程任务。
- `recompute`：从依赖重新计算。
- `mark-failed`：无法安全恢复的运行中任务标记失败。
- `ignore`：临时任务丢弃。

验收标准：

- 项目重新打开后，已完成 resource 不重复执行。
- 可恢复的远程任务能继续轮询。
- 不可恢复的本地任务不会卡在 running。

回滚边界：

- 持久化可以独立 feature flag 控制；关闭后退回内存 graph。

## 阶段 9：清理旧 datasource processor 职责

目标：移除双执行系统，datasource 回归纯数据描述。

清理内容：

- `DataSourceProcessor` 的队列职责。
- `DataSourceRegistry` 的 processor 注册职责。
- `DataSourceRuntimeState.progress/errorMessage` 的主状态职责。
- processor 内部分散的 cancel/retry/并发控制。

保留内容：

- `UnifiedDataSourceData` 联合类型。
- source factory 和 persisted data extractor。
- 远程任务 payload 字段，除非已有新的 resource 持久化迁移方案。

最终状态：

```text
datasource = 资源来源和业务参数
ResourceNode = 执行状态、进度、错误、依赖、恢复
Resolver = 资源如何就绪
JobRuntime = 调度、去重、取消、重试、恢复
TaskCenter = UI 投影
```

验收标准：

- 新建任务不再依赖 `DataSourceProcessor.addTask()`。
- 任务中心展示只来自 `JobRuntime`。
- datasource 不再是执行状态的唯一来源。

## 建议拆分顺序

优先级最高：

1. 阶段 1：Runtime 骨架。
2. 阶段 2：MediaReady 兼容接入。
3. 阶段 4：TaskCenter UI 只读接入。

第二批：

4. 阶段 3：媒体本地资源图拆分。
5. 阶段 5：AI / BizyAir 远程生成。

第三批：

6. 阶段 6：ASR。
7. 阶段 7：导出、视觉摘要、效果模板。

最后：

8. 阶段 8：持久化恢复。
9. 阶段 9：清理旧 processor。

## 每个 PR 的建议规模

每个 PR 只做一种性质的改动：

- 类型和 Runtime 骨架。
- 一个 resolver。
- 一个业务入口切换。
- 一个 UI 投影。
- 一个旧 processor 迁移。
- 一组测试和验收补齐。

避免在同一个 PR 里同时做 Runtime、UI、远程任务和持久化。

## 关键风险

- 双状态源风险：`ResourceNode.status` 和 `mediaItem.mediaStatus` 可能不一致。解决方式是明确 `ResourceNode` 是执行真相，`mediaStatus` 是投影。
- 双进度风险：`node.progress` 和 `source.progress` 同时存在。迁移期由 resource event 同步，迁移完成后 UI 改读 TaskView。
- 取消语义风险：共享子节点不能被父任务误取消。第一版可以只取消 root 和非共享子节点。
- 持久化风险：不要持久化 File、Blob、AbortController、Bunny 对象。
- ASR 副作用风险：ASR 会创建/删除 timeline item，必须放在 root resolver 成功阶段，不能由 runtime 通用层处理。

## 第一阶段落地清单

第一批代码可以只包含：

- `src/core/jobs/ResourceTypes.ts`
- `src/core/jobs/ResourceResolver.ts`
- `src/core/jobs/ResourceResolverRegistry.ts`
- `src/core/jobs/JobLogger.ts`
- `src/core/jobs/JobRuntime.ts`
- `src/core/jobs/TaskViewAdapter.ts`
- 一个 fake resolver 单测或最小验证。
- 在 `unifiedStore` 中初始化 runtime，但不替换业务入口。

完成后再进入 `MediaReadyResolver` 接入。
