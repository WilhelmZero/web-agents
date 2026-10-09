# Studio AI 中转接口（供其他项目服务端接入）

基地址：`https://studio.lifelightenup.com`。本接口仅供**其他项目的服务端**调用；不要把项目令牌放进浏览器、移动客户端或公开仓库。Studio 保管上游 OpenAI/Gemini 密钥，调用方只持有独立项目令牌。OpenAI 也要求其上游密钥保留在服务端，不能暴露在客户端：[官方 API 安全说明](https://developers.openai.com/api/reference/overview)。

> 部署注意：只有在 Hostinger 环境变量配置 `STUDIO_INTEGRATIONS_JSON` 后，跨项目接口才会启用；未配置时返回 HTTP 503。Studio 自身的登录会话接口 `/api/ai/*` 不对其他项目开放。

## 管理员配置

1. 在项目仓库的受信任终端执行 `node scripts/create-integration-key.mjs my-project`。命令输出 `token` 和 `sha256`。令牌只交给该项目的服务端，**不要提交到 Git**。
2. 在 Hostinger 的 Node.js 应用环境变量中填写：

   ```text
   STUDIO_INTEGRATIONS_JSON={"my-project":"<sha256>"}
   ```

   多个项目使用一个 JSON 对象，每个项目一个不同令牌和摘要。`my-project` 仅允许小写英文字母、数字、连字符，长度 2–40。
3. 确保相应的 `OPENAI_API_KEY` 和／或 `GEMINI_API_KEY` 已在同一应用的服务端环境变量配置；集成请求不接受调用方提供上游密钥。保存环境变量后按 Hostinger 的流程重新部署或重启应用。
4. 令牌泄露时，生成新令牌、替换该项目的 SHA-256 摘要并重启应用；旧令牌立即失效。项目令牌只在创建时显示，Studio 不提供找回明文功能。

## 认证与限制

每次请求携带：

```http
Authorization: Bearer <该项目的 token>
X-Studio-Project: my-project
X-Tool: my-feature
```

`X-Tool` 是调用方定义的稳定功能 ID，仅允许小写字母、数字和连字符，最长 64 字符；用于用量统计。真正的计费来源由服务端根据令牌固定为 `integration:my-project`，不能通过请求头伪造。

- 仅支持 HTTPS 服务端到服务端调用；未开放跨域浏览器 CORS。不要在前端代码中存放项目令牌。
- 每个项目限 30 次请求／分钟，包括提交、查询和取消；超限返回 429。单次请求正文上限 80 MiB。
- 可访问的 AI 路径采用白名单，不能把本站用作任意 URL 代理。
- 返回上游原始 JSON／错误正文。中转只负责认证、排队、转发和统计，不保证模型输出一定是最终产品图；调用方自行进行必要的后处理。

## 提交 AI 请求

| 提供方 | 方法与路径 | 请求正文 |
| --- | --- | --- |
| OpenAI Responses | `POST /api/integrations/ai/openai/v1/responses` | 与上游 Responses API 相同的 JSON |
| OpenAI 生图 | `POST /api/integrations/ai/openai/v1/images/generations` | 与上游 Images API 相同的 JSON |
| OpenAI 图片编辑 | `POST /api/integrations/ai/openai/v1/images/edits` | 与上游 Images API 相同的 multipart/form-data |
| Gemini | `POST /api/integrations/ai/gemini/v1beta/models/{model}:generateContent` | 与上游 `generateContent` 相同的 JSON |
| Gemini 流式路径 | `POST /api/integrations/ai/gemini/v1beta/models/{model}:streamGenerateContent?alt=sse` | 与上游相同；当前网关会先完整收集上游响应，再返回，并非实时流式推送 |

支持的 OpenAI 图片生成、编辑方式见[官方图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)。模型、字段及其限制以各上游文档和账号权限为准；中转不替换或“修复”上游参数。

OpenAI 生图示例（在**其他项目的服务器**运行）：

```js
const gateway = 'https://studio.lifelightenup.com';
const headers = {
  Authorization: `Bearer ${process.env.STUDIO_PROJECT_TOKEN}`,
  'X-Studio-Project': 'my-project',
  'X-Tool': 'poster-generator',
  'Content-Type': 'application/json',
};
const response = await fetch(`${gateway}/api/integrations/ai/openai/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ model: 'gpt-image-2', prompt: 'A blue glass cup on a white background' }),
});
const jobId = response.headers.get('x-studio-job-id');
if (response.status === 202) {
  // 保存 jobId，稍后查询；见下一节。
  console.log('Queued job:', jobId);
} else if (!response.ok) {
  throw new Error(`Gateway HTTP ${response.status}: ${await response.text()}`);
} else {
  const data = await response.json(); // 上游响应，例如 data[0].b64_json
  console.log(jobId, data.data?.length);
}
```

编辑图片时直接提交 `FormData`，保留 `image`、`mask`、`model`、`prompt` 等上游字段，不要手动设置 multipart 的 `Content-Type` 边界。Gemini 路径同理保留上游请求结构。

## 排队、查询与取消

网关最多等待约 20 秒；若上游尚未完成，提交接口返回 `202`：

```json
{ "jobId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "status": "running" }
```

即使同步返回 200，响应头 `X-Studio-Job-Id` 也包含任务 ID。之后使用同一项目令牌：

- `GET /api/integrations/jobs/{jobId}`：查询状态、模型、生成图片数和错误原因。
- `GET /api/integrations/jobs/{jobId}/response`：进行中为 `202`，完成后返回上游原始响应；失败时可能返回上游错误状态，或网关 `502`。
- `POST /api/integrations/jobs/{jobId}/cancel`：仅排队中可取消；已开始则为 `409`。

建议从 3 秒轮询间隔开始并采用退避，避免触发每项目 30 次／分钟限制。任务是服务器队列，调用方断开连接后仍会执行；服务重启期间正在调用上游的任务会标为 `interrupted`，**不会自动重发以避免重复计费**，调用方可自行决定是否创建新任务。

项目只能查询或取消自己提交的任务；跨项目访问返回 404。模型响应与生成图片由 Studio 私有保存约 30 天，之后可能返回 502／过期错误；请在自己的服务端及时保存需要长期保留的成品。任务文字记录及用量统计继续保留。

## 常见状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求或轮询完成；正文为上游响应 |
| `202` | 任务排队／运行中，使用任务 ID 轮询 |
| `400` | 无效请求，例如缺少 `X-Tool` |
| `401` | 项目 ID／令牌不匹配或缺失 |
| `404` | 不在白名单内的路径，或不属于该项目的任务 |
| `409` | 任务已开始，无法取消 |
| `413` | 请求超过 80 MiB |
| `429` | 项目调用限速 |
| `502` | 上游调用失败且没有可返回的上游正文 |
| `503` | 集成接口或对应上游服务端密钥未配置 |

上游本身返回的错误状态（例如参数错误、额度不足）会原样透传，不要只按 HTTP 502 判断失败。平台管理员可在 Studio 用量页按 `source = integration:my-project`、工具 ID、模型、状态及图片数核对用量。
