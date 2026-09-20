# Cloudflare Pages 部署

Pages 项目名为 `lightcut-editor`，构建输出目录为 `dist`。生产入口为
`https://lightcut-editor.pages.dev`，`preview` 分支入口为
`https://preview.lightcut-editor.pages.dev`。

`wrangler.toml` 已声明 `API` Service Binding：Preview 指向 `lightcut-api-preview`，
Production 指向 `lightcut-api-production`。`functions/api/[[path]].js` 将同源
`/api/*` 转发到该 binding，浏览器不直接请求 `workers.dev`。

```bash
npm run deploy:preview
npm run deploy:production
```

`.env.preview` 与 `.env.production` 保持 `VITE_API_BASE_URL=`，并启用
`VITE_API_CAPABILITIES=auth,account,admin`。`VITE_ASSET_BASE_URL` 使用已发布的 R2
managed public URL；购买域名后再改为自定义资源域名。
4. 准备并校验资源，然后上传到 R2：

   ```bash
   npm run assets:prepare
   npm run assets:verify
   CLOUDFLARE_R2_BUCKET=lightcut-frontend-assets \
   CLOUDFLARE_R2_PUBLIC_URL=https://<r2-managed-host>.r2.dev \
   npm run assets:publish
   ```

5. 将 `cloudflare/r2-cors.example.json` 中的 Pages 地址替换为实际的 `pages.dev` 域名，然后应用 CORS：

   ```bash
   npx wrangler r2 bucket cors set lightcut-frontend-assets \
     --file cloudflare/r2-cors.example.json --force
   ```

   只允许正式 Pages 域名、明确列出的预览域名和本地开发地址。`CLOUDFLARE_R2_PUBLIC_URL` 让发布脚本通过 `HEAD` 跳过已上传对象，并对失败上传自动重试。

6. 本地构建验证通过后部署 Pages：

   ```bash
   npx wrangler pages deploy dist --project-name <pages-project>
   ```

本地编辑器开发使用 `.env.development` 的 `http://localhost:8787`，先启动
`cloudflare-backend/` 的 Worker；预览和生产构建保持空的 `VITE_API_BASE_URL`，通过 Pages
Service Binding 访问同源 API。

模型、DSP Wasm 和 ONNX Runtime Wasm 不属于 Pages 部署产物；它们必须先发布到 R2。不可变资源使用 SHA-256 路径，只有 `manifests/models/latest.json` 使用短缓存。
