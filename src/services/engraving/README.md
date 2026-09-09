# 客户定制黑白 Logo

独立路由：`?tool=custom-monochrome-logo`。没有后端服务或示例体验入口。

## 迁移边界

- `prompts.mjs`、`quality-review.mjs`、`auto-tune.mjs` 保留客户定制黑白 Logo 源项目的提示词、审核结构、阈值和决策规则；通过 `.d.mts` 提供类型化调用边界。
- `processing.mjs` 保留源算法的灰度、边界连通清理、Alpha 权重、三尺度纹理、暗部亮纹、黑场曲线、反相与蛇形 Floyd–Steinberg 顺序和公式。
- `image.ts` / `worker.ts` / `workerClient.ts` 替换 Node/Sharp：浏览器转正和解码、Canvas 高质量重采样、可分离 Gaussian（大半径采用三次盒式近似）、PNG pHYs DPI 元数据。输出黑底和擦除区通过最近邻主体遮罩再次锁定。
- 每次预览有独立 Worker 和 AbortController；350ms 防抖，旧 Worker 终止且旧结果不写回。导出重新计算完整尺寸，不使用预览放大。
- `api.ts` 使用现有 OpenAI/GPT 密钥以及独立兼容地址。`images/edits` 只按顺序发送原照和风格参考；`responses` 审核发送原照、同一风格参考和渲染结果。连接测试仅 GET `/models`。
- 不自动重复网络、权限、额度或审核失败请求。停止不丢弃正在返回的付费结果，而是在保存后阻止后续步骤。生成请求与审核请求进入全局控制台，只有实际生图响应增加模型张数。
- `storage.ts` 在版本化 localStorage 中只存允许的非密钥设置，在独立 IndexedDB 中存最新任务（Blob、参数、蒙版、评分）。刷新恢复运行态为中断，不自动重发。

## 静态资源与兼容性

仅 `public/engraving-references/*-reference.jpg` 三张风格参考迁入。隐藏展示不意味着私密：这些资源会随 GitHub Pages 公开分发。

兼容服务必须支持 multipart 图片编辑、Base64 PNG 输出、Responses 结构化视觉审核，以及浏览器跨域访问（CORS 和 Authorization）。HTTP 仅允许 localhost；其他地址必须 HTTPS。不依赖原项目的本机 HTTP 代理。

需要支持 OffscreenCanvas、createImageBitmap、Web Worker、IndexedDB 的现代 Chromium 浏览器；不支持的环境显示错误，不静默输出错误图片。

## 验证

`engraving.test.ts`：黑底、透明边缘、擦除、暗发、反相、点阵值域、尺寸、DPI、设置、恢复与自动状态机。

`api.test.ts`：原提示词、输入顺序、模型参数、连接测试与不自动重试。

`sharpBaseline.test.ts`：`fixtures/sharp-dark-hair.json` 是用源项目 Sharp 处理合成测试像素得到的离线基线，不含客户照片；断言黑底完全相同，允许模糊实现的微小差异。

`CustomMonochromeLogoComposer.test.tsx`：入口、必填上传、默认参数、无示例入口、独立设置。

人工/浏览器 QA 应区分模拟请求和真实服务；模拟通过不代表特定兼容服务的模型权限、CORS 或成品雕刻质量已验证。
