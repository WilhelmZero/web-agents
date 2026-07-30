# Scene Studio

纯浏览器运行的 AI 商业图片生成工具，包含：

- 场景图生成：上传多张产品白底图，通过多条提示词批量生成商业场景图。
- Logo 合成：按顺序配对场景图和 Logo，支持可视化定位、批量生成及分组下载。
- 局部重绘：框选或涂抹单张图片的指定区域，只修改选区内容。
- 详情长图生成：分析一张产品白底图和自然语言商品信息，规划可编辑的详情图提示词并按并发数批量生成。

两个功能均调用 Gemini Nano Banana 图片模型，结果在浏览器会话中按输入图片分组。

## 本地运行

```bash
npm install
npm run dev
```

打开终端显示的本地地址，在右上角配置 Gemini API Key。Key 仅保存在当前浏览器的 `localStorage`，不会写入代码。未配置代理时，浏览器会直接请求 Google Gemini API。

## Cloudflare Worker 代理

项目内置了一个严格限制请求路径的 Worker，源码位于 `worker/`。它只代理 Gemini `generateContent`，不是任意 URL 代理。

1. 修改 `worker/wrangler.jsonc` 中的 `ALLOWED_ORIGINS`。多个来源用英文逗号分隔；本地 `localhost` 与 `127.0.0.1` 会自动允许。
2. 登录并部署 Worker：

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
```

3. 在页面右上角打开“配置 Gemini API”，选择“Cloudflare 代理”并填写部署后的 Worker 地址。地址可填写 Worker 根地址，也可填写以 `/v1beta` 结尾的地址，设置会保存在当前浏览器。

`.env.local` 不再是必需配置。可选的 `VITE_GEMINI_PROXY_URL` 只用于给首次打开页面提供默认代理地址；用户之后可在页面中切换直连或修改代理地址。

请求链路为“浏览器 → 你的 Cloudflare Worker → Gemini”。API Key 仍由浏览器发送，但 Worker 不保存、不打印 Key，只将其放入发往 Google 的 `x-goog-api-key` 请求头。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

## 安全说明

代理模式不会自动隐藏浏览器中的 API Key，也不能仅靠 CORS 防止代理被恶意调用。请仅在可信设备使用；若把前端或 Worker 公开部署，应再使用 Cloudflare Access、WAF 或其他身份认证与限流策略保护 Worker。

生成接口与模型能力以 [Gemini 图片生成文档](https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn) 为准，价格以 [Gemini API 官方定价](https://ai.google.dev/gemini-api/docs/pricing) 为准。
