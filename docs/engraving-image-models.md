# 图片模型选择

黑白 Logo 的图片模型支持列表选择和直接输入完整模型 ID，保留每个任务的已保存设置。原默认值 gpt-image-2 不变。

新增 gpt-image-2.5-sunburst 与 gpt-image-2.5-flare。两者沿用 images/edits、多图参考、透明 PNG 和现有尺寸选择，支持 low、medium、high、xhigh、max、auto。不发送旧模型专用的 input_fidelity。

切回已知旧模型时，xhigh/max 调整为 high；请求层也在调用前阻止已知不兼容的质量组合。自定义模型名称原样传递（去掉首尾空格），是否支持编辑和质量参数由服务商决定。不会自动切换模型或失败重试。

核对日期：2026-09-14。
- https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
- https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
- https://developers.openai.com/api/docs/guides/image-generation

验证使用模拟请求，不触发付费生成。
