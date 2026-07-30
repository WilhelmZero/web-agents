# Scene Studio 阶段性交付说明

更新日期：2026-07-30

## 1. 项目概况

Scene Studio 是一个 Vite + React + TypeScript 单页应用，界面基于 Ant Design 与 Ant Design X。应用不保存上传素材和生成结果到远程数据库；API Key、模型设置和用户预设保存在当前浏览器 `localStorage`。Gemini 请求支持浏览器直连或经自建 Cloudflare Worker 转发。

当前已完成五项创作能力：

1. **场景图生成**：多张产品白底图与多条提示词支持全量组合或一一对应，包含批量粘贴、节日预设、提示词优化、并发生成、分组预览和 ZIP 下载。
2. **Logo 合成**：场景图与 Logo 按顺序配对，支持拖拽定位、缩放、旋转、定位参考图反相、框选/涂抹局部重绘、多结果生成和分组下载。
3. **局部重绘**：对单张图片框选或涂抹，只允许模型修改标记区域，支持提示词优化、结果预览和下载。
4. **详情长图生成**：分析产品白底图和自然语言商品信息，规划 1–10 张具有统一视觉叙事的详情图，支持完整提示词与上图文案双向编辑、单张/并发生成、ZIP 下载和纵向长图合成。
5. **连接与部署**：页面内切换 Gemini 直连或 Cloudflare 代理；包含受限 Worker 示例和 GitHub Pages 自动部署工作流。

## 2. 技术结构

- **前端**：React 19、TypeScript、Vite。
- **UI**：Ant Design 6、Ant Design X 2。
- **AI 接口**：Gemini `generateContent` REST API，图片以内联 Base64 提交。
- **图片处理**：浏览器 Canvas 生成定位参考图、语义遮罩和详情长图。
- **下载**：Blob 单文件下载；JSZip 生成分组或批量 ZIP。
- **状态**：页面会话内使用 React 状态；配置和提示词预设使用 `localStorage`。
- **代理**：Cloudflare Worker 仅允许 `/v1beta/models/{model}:generateContent`，带来源白名单、CORS 和请求体限制。
- **部署**：GitHub Actions 执行测试、类型检查、Vite 构建并发布 Pages。

## 3. 已解决的主要问题

### 3.1 浏览器端 API Key 与代理

**问题**：纯前端无法真正隐藏 Key，直接请求也可能受到网络环境影响。

**方案**：

- Key 只保存于用户浏览器，不进入源代码。
- 页面支持直连/代理切换及代理地址修改。
- Worker 不记录 Key，只把请求头转发给 Gemini。
- Worker 限制目标域名和 API 路径，避免成为任意开放代理。

**仍需注意**：CORS 不是身份认证。公开 Worker 应额外配置 Cloudflare WAF、Access 或速率限制。

### 3.2 Gemini 503 高负载

**问题**：图片模型会返回 `503 UNAVAILABLE`，尤其在并发或高峰期。

**方案**：

- 对 408、429、500、502、503、504 最多自动重试 3 次。
- 使用指数退避与随机抖动。
- 停止任务时同步中止请求和重试等待。
- 重试耗尽后保留可操作错误，允许单项手动重试。

### 3.3 Logo 精确定位

**问题**：生成模型没有传统图片编辑 API 的结构化坐标或 Mask 参数，纯文字位置不稳定；黑色 Logo 在深色场景参考图中不明显。

**方案**：

- Canvas 生成第三张定位参考图，提交原场景、原 Logo 和参考图。
- 支持相对坐标、大小、旋转和仅供参考图使用的颜色反相。
- 反相时明确要求最终颜色仍以原 Logo 为准。
- 局部重绘使用红色半透明语义遮罩，并要求选区外内容保持不变。

**限制**：定位和遮罩属于强视觉引导，不保证像素级准确。

### 3.4 页面切换导致状态丢失

**问题**：功能切换曾卸载组件，导致 Logo 图片、提示词和结果被清空。

**方案**：

- 所有创作页面常驻挂载，只切换显示状态。
- 上传图、提示词、任务和结果在当前浏览器会话中持续保留。
- 页面存在未保存内容时注册 `beforeunload` 提醒。

### 3.5 详情图缺少连续性与结果重复

**问题**：独立生成的详情图容易风格割裂，结果卡曾同时显示大图和 FileCard 缩略图。

**方案**：

- 商品分析先输出统一艺术指导，再写入每一页提示词。
- 统一色板、背景、光线、字体、留白、产品比例和上下衔接元素。
- 结果卡只展示一张可放大图片。
- 浏览器按顺序把成功结果合成为单张纵向 PNG，支持预览和下载。

### 3.6 Blob URL 与本地数据

**问题**：上传预览和生成结果使用 Blob URL，替换或清空时可能占用内存。

**方案**：在替换图片、替换结果、清空任务和组件清理阶段释放对应 URL。上传素材和结果不写入 `localStorage`，刷新页面后不会恢复。

## 4. 当前验证状态

- `npm run typecheck`：前端与 Worker 类型检查。
- `npm test`：当前 24 项测试通过，覆盖组合任务、模型配置、提示词切割、Logo 配对、代理地址、错误重试和详情文案同步等。
- `npm run build`：生产构建通过。
- 已知构建提示：主 JavaScript 包超过 500KB，当前不影响运行，后续可按创作工具进行动态导入拆包。

## 5. 安全与发布检查

- `.env`、`.env.*`、`worker/.dev.vars*`、`.wrangler/`、`node_modules/`、`dist/` 和 TypeScript 缓存已忽略。
- `.env.example` 只包含代理地址示例，不包含真实凭据。
- 仓库提交前应再次搜索 `AIza`、Cloudflare Token、私钥头和其他凭据格式。
- GitHub Pages 构建不注入本地 `.env.local`，线上默认直连模式；用户可在页面中自行设置代理地址。
- 不要把真实 Key 写入 GitHub Actions Variables、普通 Wrangler `vars` 或源代码；如未来由 Worker 持有服务端 Key，应使用 Cloudflare Secret。

## 6. 下一阶段建议

1. 为各创作工具做路由级动态导入，降低首屏包体。
2. 增加 IndexedDB 可选会话草稿，解决刷新后素材丢失，同时提供明确的清除入口。
3. 为详情长图加入页面拖拽排序、统一文案样式模板和单页重新分析。
4. 为 Canvas 遮罩加入撤销/重做、橡皮擦和遮罩缩略图。
5. 为 Cloudflare Worker 增加正式身份验证、按用户限流和用量统计。
6. 增加 Playwright 端到端测试和真实 Key 的最小冒烟测试；测试凭据只能来自受保护 Secret。
7. 根据 Gemini 模型与价格更新周期维护模型能力和费用目录。

## 7. 开发与发布命令

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

推送到 `main` 后，`.github/workflows/deploy-pages.yml` 会执行测试、类型检查，并以 `/web-agents/` 为 Vite 基础路径发布 GitHub Pages。

Cloudflare Worker 单独部署：

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
```
