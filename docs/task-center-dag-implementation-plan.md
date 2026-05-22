# Task Center DAG MVP Implementation Plan

## MVP 已落地范围

本阶段只建立 Resource-first 任务中心的可运行内核，不迁移现有媒体、AI、ASR 业务逻辑。

已新增目录：

```text
src/core/jobs/
  DagScheduler.ts
  JobRuntime.ts
  ResourceResolver.ts
  ResourceTypes.ts
  TaskViewAdapter.ts
  index.ts
  useJobTaskCenter.ts
  resolvers/
    FunctionResourceResolver.ts
    MediaFileAvailableResolver.ts
    MediaDecodedResolver.ts
    MediaReadyResolver.ts
    MediaSourceProcessedResolver.ts
```

已支持能力：

- `JobRuntime.ensure(request)`：按 `type + key` 去重并等待资源 ready。
- `ResourceResolverRegistry`：注册不同资源类型的 resolver。
- DAG 依赖：resolver 可通过 `getDependencies()` 或 `ctx.ensure()` 声明依赖。
- `DagScheduler`：按 queue 和 priority 调度，默认队列为 `remote`、`local-heavy`、`export`、`background`。
- Resource 事件：`created`、`updated`、`succeeded`、`failed`、`blocked`、`cancelled`。
- TaskCenter 只读投影：`getTaskViews()` / `createTaskViews()`。
- 基础取消：取消 queued / running 节点并触发 resolver 的 `cancel()`。
- 基础重试：失败、阻塞、取消节点可重新执行。
- `FunctionResourceResolver`：用于开发期快速包一段异步函数验证 DAG。
- `useJobTaskCenter`：订阅 ResourceEvent 并暴露响应式 TaskView 的 MVP 数据流。
- `MediaReadyResolver`：媒体 ready 的业务入口资源。
- `MediaSourceProcessedResolver`：媒体数据源处理子资源，由 DagScheduler 调度并直接执行现有 processor。
- `MediaFileAvailableResolver`：准备媒体文件，File 只在媒体模块内部短期缓存。
- `MediaDecodedResolver`：消费已准备文件并完成 Bunny 解码、缩略图、duration 和 ready 状态。

## 非 MVP 范围

以下能力暂不实现，避免过早扩大迁移面：

- 持久化和应用重启恢复。
- 业务 bindings 和来源定位。
- 复杂共享依赖取消传播。
- 运行态节点自动释放。
- 现有 `DataSourceProcessor` 队列迁移。
- AI / ASR / BizyAir resolver 拆分。

## 下一步接入顺序

1. 在业务模块中用 `jobRuntime.ensure(createMediaReadyRequest(mediaId))` 替代局部手写等待。
2. 逐步废弃旧入口 `startMediaProcessing()`，让业务只通过 Resource DAG 声明资源需求。
3. 继续拆远程生成、ASR、导出等资源图。

## 验证清单

- 同一个 `type + key` 同时 ensure 多次，只执行一次 resolver。
- 父资源依赖子资源时，子资源成功后父资源才进入 queued / running。
- 子资源失败时，父资源进入 blocked。
- resolver 调用 `ctx.update()` 后能通过 resource event 和 TaskView 看到进度变化。
- queued / running 节点可 cancel。
- failed / blocked / cancelled 节点可 retry。

## 当前验证结果

已运行：

```text
npm run type-check:no-generate
```

结果：通过。

## 时间轴交互添加 Ready 门禁与 MediaSync 退场计划

### 结论

交互添加素材到时间轴不接 `ensureMediaReady`，而是强制素材必须 `ready` 才能添加。

`MediaSync` 不再作为通用 `watch(mediaItem.mediaStatus)` 桥。后续用 DAG 的 `timeline-item-ready` 资源替代项目恢复里的 loading clip 转 ready 逻辑。

### 交互添加素材

- 在 `createTimelineItemFromMediaItem()` 增加 `mediaStatus === 'ready'` 校验。
- 非 ready 媒体直接提示并返回，不创建 clip，不写历史命令。
- 新建 clip 仍保留 `runtime.isInitialized = false`，由命令执行阶段从 ready media 同步尺寸、时长、bunny。
- `AddTimelineItemCommand` 不再创建 `MediaSync`。
- 当 `rebuildForCmd()` 得到 loading item 且 media 已 ready 时，直接调用 `TimelineItemTransitioner.transitionToReady()` 完成同步和初始化。

### 项目恢复

- 新增 `timeline-item-ready:{timelineItemId}` DAG 资源。
- `timeline-item-ready` 依赖 `media-ready:{mediaId}`。
- resolver 找到 timeline item 和 media item 后，调用现有 `TimelineItemTransitioner.transitionToReady()`。
- `UnifiedProjectModule.restoreTimelineItems()` 对恢复出来的 loading clip 调 `ensureTimelineItemReady(timelineItem.id)`，替代 `projectLoadMediaSyncs`。

### 命令系统

- `RemoveTimelineItemCommand`、`RemoveTrackCommand` 不再创建 `MediaSync`。
- 如果删除 / 撤销操作恢复出 loading clip，只负责把 clip 放回 timeline。
- loading clip 后续通过 `ensureTimelineItemReady` 驱动转 ready。
- 删除 loading clip 后，即使 DAG 后台完成，也必须因为 timeline item 不存在而安全跳过，不复活 clip。

### API / Types

新增 jobs API：

```ts
createTimelineItemReadyRequest(timelineItemId: string)
createTimelineItemReadyResolver({
  getTimelineItem,
  getMediaItem,
  ensureMediaReady,
})
```

`unifiedStore` 新增暴露：

```ts
ensureTimelineItemReady(timelineItemId: string)
```

`ResourceTypes` 新增资源类型：

```ts
'timeline-item-ready'
```

### 清理 MediaSync

当以下位置都不再引用 `MediaSync` 后，删除 `MediaSync` 类和 `MediaSyncOptions` 导出：

- `AddTimelineItemCommand`
- `RemoveTimelineItemCommand`
- `RemoveTrackCommand`
- `UnifiedProjectModule`

保留 `TimelineItemTransitioner`，它成为 DAG resolver 和命令直接初始化的共用执行器。

### 验证清单

- `npm run type-check:no-generate` 通过。
- ready 素材拖到时间轴：成功添加，clip 直接变 ready，undo / redo 正常。
- pending / decoding / error 素材拖到时间轴：不添加 clip，不产生历史命令，提示明确错误。
- 项目里有 loading clip：打开项目不跳首页，后台出现 `media-ready` 和 `timeline-item-ready` DAG 日志，最终 clip 转 ready。
- 项目恢复后在 clip ready 前删除该 clip：DAG 完成后不复活已删除 clip，不报错。
- 删除轨道包含 loading clip 后 undo：clip 恢复为 loading，并继续通过 DAG 转 ready。
- `rg "MediaSync"` 只应剩余被删除文件或无结果。
- 交互添加链路不出现 `ensureMediaReady`，项目恢复链路出现 `ensureTimelineItemReady`。

### 默认假设

- 本阶段只处理交互添加和项目恢复，不处理 Agent 添加。
- 用户主动添加到时间轴必须基于 ready 素材。
- `TimelineItemTransitioner` 继续保留，用来承接“media ready 后初始化 timeline item”的实际执行逻辑。
