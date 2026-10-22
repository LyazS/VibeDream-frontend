# LightCut 主编辑器

![alt text](docs/image.png)
基于 Vue 3 与 TypeScript 的浏览器视频编辑器，支持本地文件、远程素材、时间轴编辑、
Agent 对话和统一 AI 任务。账户、持久化任务与模型调用由 `cloudflare-backend/` 提供。

## 本地完整联调

先启动 `cloudflare-backend` 的 `npm run dev:local`，再在本目录执行 `npm run dev:local`，
编辑器入口为 `http://localhost:5173`。开发环境连接本地 API，模型资源来自共享 R2，
转场资源来自独立的 local R2。资源初始化和 Secret 配置见[本地完整联调](../docs/cloudflare-development-workflow.md#日常开发local)。

## 浏览器工作空间（OPFS）

使用浏览器私有存储管理工程，可跳过电脑工作目录选择和授权：

```bash
VITE_FILE_SYSTEM_ADAPTER=opfs VITE_OPFS_WORKSPACE_ID=automation npm run dev:local
```

公共 `.env` 显式配置 `VITE_FILE_SYSTEM_ADAPTER=file-system-access`。适配器配置必填，选择 OPFS 时还必须指定 `VITE_OPFS_WORKSPACE_ID`；缺失或无效会直接报错。配置在启动时固定；同一浏览器上下文、地址和工作空间 ID 下刷新会保留工程，清除站点数据会删除浏览器内的工程。Agent 能力和登录仍按现有配置控制。

文件系统验证在本目录执行：

```bash
npm run test:filesystem
npx playwright install chromium
npm run test:filesystem:browser
```

已安装 Google Chrome 时，可使用 `PLAYWRIGHT_CHANNEL=chrome npm run test:filesystem:browser`，无需下载测试浏览器。浏览器测试会启动独立的 Vite 服务（端口 5183），使用隔离上下文和仓库内小型视频素材，验证导入解码、刷新恢复、Agent 附件文件、IndexedDB 隔离与访问失败重试；不调用真实模型。

实现见 [OPFSAdapter](src/core/filesystem/adapters/OPFSAdapter.ts)，单元与浏览器回归分别在
[filesystem-opfs.test.ts](test/filesystem-opfs.test.ts) 和 [opfs.spec.ts](test/browser/opfs.spec.ts)。

## 技术栈

- Vue 3、TypeScript、Pinia、Vue Router
- Vite、ESLint、Prettier、Vitest、Playwright
- MediaBunny、WebGL2、ONNX Runtime Web
- Cloudflare Workers、D1、R2、Vectorize、Durable Objects、Workflows

## 项目结构

```text
LightCut-frontend/
  src/
    components/       Vue 组件、编辑面板与调试面板
    core/
      agent/          Agent 运行时、工具与本地会话
      ai-tasks/       统一 AI 任务前端客户端与类型
      filesystem/     File System Access 与 OPFS 适配器
      effect-template/ 转场与滤镜目录
      utils/          时间轴、媒体与音乐分析工具
    config/           API 能力与运行时配置
    locales/          中英文文案
  test/               Vitest 与 Playwright 测试
```

Agent 前后端契约以 `src/core/agent/` 与 `cloudflare-backend/src/modules/agent/` 的当前实现和
测试为准，不从已废弃的 Python 后端恢复接口。

## 安装与运行

使用 Node.js 22.12+，在本目录安装依赖并启动编辑器：

```bash
npm ci
npm run dev:local
```

编辑器入口为 `http://localhost:5173`。完整联调、Secret、R2 / Vectorize 初始化和转场发布见
[Cloudflare 三种模式使用指南](../docs/cloudflare-development-workflow.md)。

### 构建与检查

```bash
npm run build
npm run lint
```

`npm run build` 同时执行类型检查和生产构建。`npm run lint` 会直接应用可自动修复的规则。

### Cloudflare Pages、R2 与账户 API

前端构建只包含 Vue 应用代码，不会下载或复制 ONNX 模型和 Wasm。模型资源需要单独准备、校验并发布到 R2：

```bash
npm run assets:prepare
npm run assets:verify
CLOUDFLARE_R2_BUCKET=lightcut-frontend-assets \
CLOUDFLARE_R2_PUBLIC_URL=https://<r2-managed-host>.r2.dev \
npm run assets:publish
npm run build
```

`assets:prepare` 会生成不可变的 `models/<model>/<sha256>/`、`wasm/<kind>/<sha256>/` 和 `manifests/models/latest.json` 路径。发布前请将 [cloudflare/r2-cors.example.json](cloudflare/r2-cors.example.json) 中的 Pages 地址替换为实际域名，并在 R2 配置只读跨域访问。

Pages Production 环境变量：

```text
VITE_API_BASE_URL=
VITE_API_CAPABILITIES=auth,account,admin
VITE_ASSET_BASE_URL=https://<cloudflare-managed-r2-host>.r2.dev
VITE_ENABLE_ORT_CDN_FALLBACK=false
```

生产入口为 `https://lightcut-editor.pages.dev`，预览入口为
`https://preview.lightcut-editor.pages.dev`。Pages 通过 `wrangler.toml` 中的 `API`
Service Binding 将同源 `/api/*` 分别转发到 Production 或 Preview Worker。

开发与 Preview 的能力列表由 `VITE_API_CAPABILITIES` 控制；Production 当前只开放
`auth,account,admin`。前端会在请求发出前拒绝未开放能力，避免调用退役接口。

## 测试

按改动范围执行对应测试：

```bash
npm run test:auth
npm run test:agent-socket
npm run test:task-progress
npm run test:transitions
npm run test:type-safety
npm run test:filesystem
```

## 开发指南

### 代码规范

- 使用TypeScript进行类型定义
- 遵循Vue 3组合式API最佳实践
- 使用 Prettier：`semi: false`、`singleQuote: true`、`printWidth: 100`
- Vue 组件使用 PascalCase，普通函数与工具使用 camelCase
- 格式化只覆盖本次修改的文件，避免全目录无关改动

## 贡献指南

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

## 联系方式

项目名称：LightCut
项目类型：AI视频编辑器
技术栈：Vue 3 + TypeScript + Cloudflare Workers

## 致谢

感谢所有为这个项目做出贡献的开发者。
