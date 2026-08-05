import { XProvider } from '@ant-design/x';
import enUSX from '@ant-design/x/locale/en_US';
import zhCNX from '@ant-design/x/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type AppLanguage = 'zh-CN' | 'en-US';

const LANGUAGE_KEY = 'scene-studio-language';

const translations: Record<string, string> = {
  'AI 商业场景图工作台': 'AI Commercial Visual Studio',
  '创作工具': 'Creation tools',
  '场景图生成': 'Scene generator',
  'Logo 合成': 'Logo composite',
  '局部重绘': 'Inpainting',
  '详情长图生成': 'Product detail page',
  '视频生成': 'Video generator',
  '管理': 'Management',
  '历史记录': 'History',
  '生成设置': 'Generation settings',
  '设置': 'Settings',
  'Key 已配置': 'Key configured',
  '配置 API Key': 'Configure API Key',
  '配置 Gemini API': 'Configure Gemini API',
  '保存到本地': 'Save locally',
  '连接方式': 'Connection mode',
  'Gemini 直连': 'Gemini direct',
  'Cloudflare 代理': 'Cloudflare proxy',
  '代理地址': 'Proxy URL',
  '测试连通性': 'Test connection',
  '测试中': 'Testing',
  'Gemini API Key': 'Gemini API Key',
  'Key 会保存在当前浏览器': 'The key is stored in this browser',
  'Key 保存在当前浏览器，并由浏览器直接请求 Gemini。请勿在不受信任的设备上配置。': 'The key is stored in this browser and sent directly to Gemini by your browser. Do not configure it on an untrusted device.',
  'Key 与代理地址保存在当前浏览器，请求将通过你配置的代理转发到 Gemini。': 'The key and proxy URL are stored in this browser. Requests are forwarded to Gemini through your configured proxy.',
  '把白底产品图放进真实世界': 'Place clean product shots into the real world',
  '上传产品、组合提示词，批量生成风格一致的商业场景图。': 'Upload products, combine prompts, and create consistent commercial scenes in batches.',
  '让品牌标识自然融入每个场景': 'Blend your brand naturally into every scene',
  '按顺序配对场景与 Logo，可视化定位后批量生成专业合成图。': 'Pair scenes and logos in order, position them visually, and create professional composites in batches.',
  '只重绘你指定的区域': 'Edit only the area you select',
  '框选或涂抹局部区域，严格保持图片其他内容与构图不变。': 'Select or brush a local area while preserving everything else and the original composition.',
  '从白底图规划完整商品详情页': 'Plan a complete product detail page from a clean product shot',
  '先理解商品，再从不同角度生成可编辑的详情图方案。': 'Understand the product first, then create editable detail visuals from different angles.',
  '上传产品白底图': 'Upload product images',
  '上传场景图': 'Upload scene images',
  '上传 Logo 图': 'Upload logo images',
  'Logo 图': 'Logo image',
  '上传Logo 图': 'Upload logo image',
  '上传一张产品白底图': 'Upload one clean product image',
  '上传单张原图': 'Upload one source image',
  '点击或拖拽上传图片': 'Click or drag to upload an image',
  '商品图片与信息': 'Product image and information',
  '上传图片': 'Upload image',
  '选择图片': 'Select images',
  '替换图片': 'Replace image',
  '清空全部': 'Clear all',
  '清空': 'Clear',
  '删除': 'Delete',
  '替换': 'Replace',
  '下载': 'Download',
  '下载全部': 'Download all',
  '下载单张': 'Download image',
  '下载本组': 'Download group',
  '清空生成结果': 'Clear results',
  '生成结果': 'Generated results',
  '重绘结果': 'Inpainting result',
  '合成结果': 'Composite results',
  '详情图结果': 'Detail image results',
  '合成结果会显示在这里': 'Composite results will appear here.',
  '结果按场景图和 Logo 配对组展示': 'Results are grouped by scene and logo pairs.',
  '详情图结果会显示在这里': 'Detail image results will appear here.',
  '生成结果会显示在这里': 'The generated result will appear here.',
  '预览长图': 'Preview long image',
  '下载长图': 'Download long image',
  '一键生成': 'Generate all',
  '开始生成': 'Start generation',
  '停止生成': 'Stop generation',
  '重新生成': 'Regenerate',
  '重试': 'Retry',
  '生图': 'Generate',
  '分析并生成提示词': 'Analyze and create prompts',
  '重新分析': 'Analyze again',
  '提示词优化': 'Prompt optimization',
  '优化提示词': 'Optimize prompt',
  '优化全部': 'Optimize all',
  '优化': 'Optimize',
  '提示词': 'Prompt',
  '合成提示词': 'Composite prompt',
  'Logo 合成提示词': 'Logo composite prompt',
  'Logo 替换': 'Logo replacement',
  '物体批量替换': 'Batch object replacement',
  '物体替换设置': 'Object replacement settings',
  '批量替换场景中的同类物体': 'Batch replace matching objects in scenes',
  '自动识别并替换所有目标物体，严格保持场景构图和其他内容不变。': 'Detect and replace every target object while preserving the composition and all other content.',
  '定义原物体与新物体': 'Define source and replacement objects',
  '名称或参考图至少填写一项': 'Provide a name or reference image',
  '参考图可增强识别和外观保持；所有场景统一使用这一组替换条件。': 'Reference images improve recognition and appearance preservation. The same replacement applies to every scene.',
  '原物体': 'Source object',
  '新物体': 'Replacement object',
  '原物体名称': 'Source object name',
  '新物体名称': 'Replacement object name',
  '上传参考图（选填）': 'Upload reference image (optional)',
  '严格保留新物体元素': 'Strictly preserve replacement details',
  '印花': 'Print',
  '雕刻': 'Engraving',
  '酒液': 'Liquid',
  '泡沫': 'Foam',
  '输入自定义元素': 'Enter a custom detail',
  '未上传新物体参考图时，请在新物体名称中明确描述开启元素的外观。': 'Without a replacement reference image, describe the enabled details clearly in the replacement object name.',
  '实际替换提示词': 'Actual replacement prompt',
  '这是实际发送给模型的完整文本，强约束不可编辑。': 'This is the complete text sent to the model. The strict constraints are read-only.',
  '物体替换结果': 'Object replacement results',
  '结果按原始场景图分组': 'Results are grouped by source scene',
  '清空所有场景图？': 'Clear all scene images?',
  '参考图越清晰，识别和外观保持通常越准确。': 'Clearer reference images usually improve recognition and appearance preservation.',
  '模型会尽量严格保持非目标区域，但生成式图片接口不能保证像素级完全一致。参考图越清晰，识别和外观保持通常越准确。': 'The model will preserve non-target regions as strictly as possible, but generative image APIs cannot guarantee pixel-identical output. Clearer references usually improve recognition and appearance preservation.',
  '替换设置': 'Replacement settings',
  '批量替换场景中的品牌 Logo': 'Batch replace brand logos in scenes',
  '识别场景中的旧 Logo 并替换为新 Logo，其他内容严格保持不变。': 'Detect old logos in scenes and replace them with a new logo while keeping everything else unchanged.',
  '上传已贴 Logo 的场景图': 'Upload scenes containing the old logo',
  '拖拽、点击或粘贴场景图': 'Drag, click, or paste scene images',
  '支持多张 PNG / JPEG / WebP，单张不超过 20MB': 'Multiple PNG / JPEG / WebP images, max 20 MB each',
  '设置旧 Logo 与新 Logo': 'Set old and new logos',
  '旧 Logo 可不上传': 'The old logo is optional',
  '上传旧 Logo 能帮助 AI 更准确识别需要替换的标识；新 Logo 必须上传。': 'Uploading the old logo helps AI identify what to replace; the new logo is required.',
  '旧 Logo（选填）': 'Old logo (optional)',
  '新 Logo（必填）': 'New logo (required)',
  '新 Logo（可多选）': 'New logos (multiple allowed)',
  '上传一个或多个新 Logo': 'Upload one or more new logos',
  '添加 Logo': 'Add logo',
  'Logo 分配方式': 'Logo assignment',
  '替换提示词': 'Replacement prompt',
  '自定义编辑': 'Custom editing',
  '这里显示的完整提示词就是实际发送给模型的文本。': 'The complete prompt shown here is the exact text sent to the model.',
  '上方为自定义内容，工艺、颜色和小字保护规则会作为强制后缀追加。': 'The text above is your custom content. Process, color, and micro-text protection rules are appended as a mandatory suffix.',
  '清空自定义': 'Clear custom prompt',
  '最终实际发送提示词': 'Final prompt actually sent',
  '恢复默认': 'Restore default',
  '图片按“场景图、可选旧 Logo、新 Logo”的顺序作为独立图片内容提交。': 'Images are submitted separately in this order: scene, optional old logo, then new logo.',
  '跟随自动分配': 'Follow automatic assignment',
  '存在未匹配场景': 'Unmatched scenes remain',
  '请为未匹配的场景手动指定一个新 Logo，或开启随机分配。': 'Manually assign a new logo to each unmatched scene, or enable random assignment.',
  '随机分配新 Logo': 'Randomly assign new logos',
  '关闭时场景图与新 Logo 必须数量一致并按顺序配对；开启后允许数量不同。': 'When disabled, scene images and new logos must have equal counts and are paired by order. When enabled, their counts may differ.',
  '场景与新 Logo 配对预览': 'Scene and new-logo pairing preview',
  '重新随机': 'Randomize again',
  '数量不一致': 'Count mismatch',
  '关闭随机分配时，场景图与新 Logo 数量必须相同。': 'When random assignment is disabled, scene images and new logos must have equal counts.',
  '未匹配': 'Unmatched',
  '原图对比': 'Compare original',
  '查看生成图': 'View generated image',
  '原始场景图': 'Original scene image',
  '请至少上传一个新 Logo': 'Upload at least one new logo',
  '未开启随机分配时，场景图与新 Logo 数量必须一致': 'Scene images and new logos must have equal counts when random assignment is disabled',
  '存在尚未匹配新 Logo 的场景图': 'Some scene images do not have a matching new logo',
  '上传旧 Logo（选填）': 'Upload old logo (optional)',
  '上传新 Logo': 'Upload new logo',
  '新 Logo 颜色': 'New logo color',
  'Logo 呈现工艺': 'Logo production effect',
  '玻璃激光磨砂雕刻（默认）': 'Glass laser-frost engraving (default)',
  '玻璃 Logo 工艺': 'Glass logo process',
  '雕刻工艺': 'Engraving process',
  '自动识别图片工艺': 'Auto-detect image process',
  '自定义雕刻工艺': 'Custom engraving process',
  '逐个 Logo 自动识别并沿用原工艺': 'Detect and preserve each logo’s original process',
  'AI 会分别识别每个 Logo 所在载体和原有雕刻方式：木盒沿用木盒原工艺，玻璃沿用玻璃原工艺；同一张图中的多种不同工艺会逐个匹配，不会统一套用。': 'AI detects each logo surface and original process separately: wooden boxes keep their wood process and glass keeps its glass process. Multiple processes in one image are matched individually.',
  '玻璃激光磨砂雕刻': 'Glass laser-frost engraving',
  '默认开启。仅在 Logo 位于玻璃载体时生效，呈半透明乳白或雾化蚀刻质感，并保留透光、折射和曲面效果。': 'Enabled by default and applied only when the logo is on glass, producing a translucent frosted etch while preserving transmission, refraction, and curvature.',
  '木盒 Logo 工艺': 'Wooden-box logo process',
  '启用木盒独立雕刻': 'Enable independent wooden-box engraving',
  '图案呈深棕至黑色，边缘清晰，同时保留木纹和自然焦痕。': 'Creates deep-brown to black artwork with crisp edges while preserving grain and natural scorch marks.',
  '不做黑色填充，通过浅凹槽、切削纹理和自然阴影显示 Logo。': 'Uses shallow grooves, cut texture, and natural shadows without black fill.',
  '自定义物体 Logo 工艺': 'Custom-object logo process',
  '启用自定义载体雕刻': 'Enable custom-surface engraving',
  '木盒雕刻': 'Wooden-box engraving',
  '自定义物体雕刻': 'Custom-object engraving',
  '玻璃默认使用激光磨砂雕刻': 'Glass uses laser-frost engraving by default',
  '呈半透明乳白或雾化蚀刻质感，并保留玻璃的透光、折射和曲面效果。': 'Creates a translucent milky-white or frosted etched finish while preserving glass transmission, refraction, and curvature.',
  '深色激光烧蚀（深黑高对比）': 'Dark laser burn (high contrast)',
  '自动识别木盒颜色（推荐）': 'Auto-detect wooden-box color (recommended)',
  '逐个识别木盒底色：深色木盒使用深色激光烧蚀，浅色木盒使用原木浅雕 / 凹刻。': 'Detect each box color: use dark laser burn for dark boxes and natural shallow carving for light boxes.',
  '颜色接近原木，不做黑色填充，通过极浅凹槽、切削纹理和自然阴影显示 Logo。': 'Keeps the color close to the natural wood without black fill, using very shallow grooves, cut texture, and natural shadows.',
  '原木浅雕深浅': 'Natural carving depth',
  '原木浅雕颜色深浅': 'Natural carving color darkness',
  '接近原木色': 'Near natural wood',
  '仅凹槽 / 不改色': 'Groove only / no recoloring',
  '最深色': 'Darkest',
  '控制台': 'Console',
  '全选成功项': 'Select all successful',
  '下载选中': 'Download selected',
  '请求控制台': 'Request console',
  '清空日志': 'Clear logs',
  '请求中': 'Requesting',
  '等待重试': 'Waiting to retry',
  '已中止': 'Aborted',
  '请求': 'Request',
  '尝试次数': 'Attempts',
  '耗时': 'Duration',
  '结果': 'Result',
  '信息': 'Message',
  '代理': 'Proxy',
  '直连': 'Direct',
  '发起 Gemini 请求后，状态和结果会显示在这里': 'Request status and results will appear here after a Gemini request starts.',
  '控制台不会记录 API Key、Base64 图片数据或完整请求正文，日志仅保留在当前页面会话。': 'The console does not record API keys, Base64 image data, or complete request bodies. Logs remain only for this page session.',
  '极浅': 'Very light',
  '中等': 'Medium',
  '较深': 'Deeper',
  '原木浅雕 / 凹刻（同色低对比）': 'Natural shallow carving (low contrast)',
  '自定义木盒雕刻方式': 'Custom wooden-box engraving',
  '类似深色烧蚀填充效果：图案呈深棕至黑色，边缘清晰，同时保留木纹和自然焦痕。': 'A dark burned-fill effect with deep-brown to black artwork, crisp edges, visible grain, and natural scorch marks.',
  '类似原木同色浅雕效果：不做黑色填充，通过浅凹槽、切削纹理和自然阴影显示 Logo。': 'A natural low-contrast carving without black fill, using shallow grooves, cut texture, and natural shadows.',
  '输入木盒雕刻方式、深浅、颜色和表面效果': 'Describe the wooden-box engraving depth, color, and surface finish',
  '输入具体雕刻方式、颜色、深浅和材质效果': 'Describe the engraving method, color, depth, and material finish',
  '保持原工艺': 'Keep existing effect',
  '激光雕刻': 'Laser engraving',
  '凹刻 / 压凹': 'Engraved / debossed',
  '浮雕': 'Embossed',
  '表面印刷': 'Surface printing',
  '自动识别原 Logo 载体': 'Detect the original logo surface',
  '木盒': 'Wooden box',
  '自定义物体': 'Custom object',
  '输入雕刻载体，例如：深蓝色皮革盒': 'Enter the engraving surface, e.g. dark-blue leather box',
  '输入木盒雕刻方式，例如：自然激光烧蚀、深凹雕刻': 'Describe the wooden-box engraving, e.g. natural laser burn or deep engraving',
  '输入具体雕刻或制作方式（选填）': 'Describe the engraving or production method (optional)',
  '雕刻模式会根据木盒或自定义载体的颜色、纹理和材质自然调整深浅，不强制使用固定黑白色。': 'Engraving adapts naturally to the surface color, grain, and material instead of forcing fixed black or white.',
  '保持原色': 'Keep original colors',
  '自定义颜色': 'Custom color',
  '每张场景生成张数': 'Results per scene',
  '开始替换': 'Start replacement',
  '正在替换': 'Replacing',
  '替换结果': 'Replacement results',
  '每个结果仅改变 Logo': 'Only the logo is changed in each result',
  '清空全部替换结果？': 'Clear all replacement results?',
  '替换成功': 'Replacement succeeded',
  '替换失败': 'Replacement failed',
  '生成式替换提示': 'Generative replacement notice',
  '模型会尽量保持其他区域不变，但生成式图片接口不能保证像素级完全一致；旧 Logo 参考图有助于提高识别准确率。': 'The model will preserve other regions as closely as possible, but generative image APIs cannot guarantee pixel-identical output. An old-logo reference improves detection accuracy.',
  '完成上传并开始替换后，结果会显示在这里': 'Results will appear here after uploading and starting replacement',
  '编写场景提示词': 'Write scene prompts',
  '详情图提示词': 'Detail image prompts',
  '局部重绘提示词': 'Inpainting prompt',
  '商品信息': 'Product information',
  '上图文案': 'Image copy',
  '新增文案': 'Add copy',
  '新增一行': 'Add row',
  '新增': 'Add',
  '批量粘贴': 'Bulk paste',
  '批量粘贴提示词': 'Bulk paste prompts',
  '分割方式': 'Split mode',
  '自定义符号': 'Custom delimiter',
  '按回车分割': 'Split by line break',
  '分隔符': 'Delimiter',
  '粘贴内容': 'Paste content',
  '没有切割出有效提示词': 'No valid prompts were found after splitting.',
  '预览：将新增': 'Preview: add',
  '条，空白段会被忽略。': 'prompts; blank sections will be ignored.',
  '第一条提示词\n第二条提示词\n第三条提示词': 'First prompt\nSecond prompt\nThird prompt',
  '第一条提示词': 'First prompt',
  '第二条提示词': 'Second prompt',
  '第三条提示词': 'Third prompt',
  '模型': 'Model',
  '图片模型': 'Image model',
  '分析模型': 'Analysis model',
  '优化模型': 'Optimization model',
  '模型版本': 'Model version',
  '质量、速度与成本平衡，推荐用于大多数场景。': 'A balanced choice for quality, speed, and cost; recommended for most scenarios.',
  '复杂创意和品牌一致性表现最佳。': 'Best for complex creative work and brand consistency.',
  '速度最快、成本最低，仅支持 1K。': 'Fastest and lowest-cost option; supports 1K only.',
  '旧版快速模型，固定 1K 输出。': 'Legacy fast model with fixed 1K output.',
  '输出分辨率': 'Output resolution',
  '任务组合': 'Task combinations',
  '并发任务数': 'Concurrent tasks',
  '提示词工具': 'Prompt tools',
  '一键优化全部提示词': 'Optimize all prompts',
  '本地配置': 'Local settings',
  '合成设置': 'Composite settings',
  '玻璃杯 Logo 雕刻技能': 'Glass logo etching skill',
  'Skill 自动定位': 'Automatic skill placement',
  '技能模式会自动检测杯体并计算 Logo 位置': 'Skill mode automatically detects glasses and calculates logo placement',
  '使用 glass-logo-etch': 'Use glass-logo-etch',
  '技能模式已启用': 'Skill mode enabled',
  '自动识别玻璃杯并按杯体曲率合成；手动定位与局部重绘参考在此模式下不会提交。用户提示词可以留空。': 'Automatically detects glasses and follows their curvature. Manual placement and inpainting guides are not submitted in this mode. The user prompt may be left blank.',
  'Logo 尺寸比例': 'Logo size ratio',
  '杯口下边距比例': 'Margin below rim',
  'Logo 颜色': 'Logo color',
  '白色': 'White',
  '黑色': 'Black',
  '材质模式': 'Texture mode',
  '激光磨砂蚀刻': 'Laser frosted etching',
  '实色印刷': 'Solid-color print',
  '应用范围': 'Apply scope',
  '应用到所有有效杯子': 'Apply to all valid glasses',
  '坐标计算模式': 'Coordinate mode',
  '相对比例 [0,1]': 'Relative ratio [0,1]',
  '原图像素': 'Source image pixels',
  '可选': 'Optional',
  '当前使用玻璃杯 Logo 雕刻技能': 'Glass logo etching skill is active',
  '无需填写提示词；如填写，将作为技能指令之外的补充要求。': 'No prompt is required. Any text entered will be treated as additional instructions.',
  '可选：补充特殊要求；留空将完全按照 glass-logo-etch 技能参数生成': 'Optional: add special requirements, or leave blank to use only the glass-logo-etch parameters',
  '重绘设置': 'Inpainting settings',
  '详情页设置': 'Detail page settings',
  '单图': 'Single image',
  '单商品': 'Single product',
  '跟随场景原图': 'Follow scene image',
  '每组生成张数': 'Images per group',
  '提示词优化模型': 'Prompt optimization model',
  '商品分析语言模型': 'Product analysis language model',
  '画面比例': 'Aspect ratio',
  '跟随原图': 'Follow source image',
  '指定比例': 'Fixed ratio',
  '分辨率': 'Resolution',
  '并发数': 'Concurrency',
  '生成张数': 'Images per group',
  '目标张数': 'Target image count',
  '组合方式': 'Combination mode',
  '全量组合': 'All combinations',
  '一一对应': 'Pair by order',
  '预计费用': 'Estimated cost',
  '预计价格': 'Estimated price',
  '预计图片费用': 'Estimated image cost',
  '按一次请求和两张输入参考图估算。': 'Estimated for one request with two reference images.',
  '按标准层输出与单张输入图估算，不含无法预知的文本、思考及提示词优化 token。': 'Estimated using standard-tier output and one input image; unpredictable text, thinking, and prompt-optimization tokens are excluded.',
  '预计任务': 'Estimated tasks',
  '任务进度': 'Task progress',
  '任务数': 'Tasks',
  '成功': 'Succeeded',
  '失败': 'Failed',
  '排队中': 'Queued',
  '生成中': 'Generating',
  '生成成功': 'Generated successfully',
  '生成失败': 'Generation failed',
  '等待可用并发任务': 'Waiting for an available concurrent slot',
  '任务已停止': 'Task stopped',
  '尚未生成图片': 'No image generated',
  '文件与任务': 'Files and tasks',
  '个任务失败': 'tasks failed',
  'Cloudflare 代理等待 Gemini 响应超时（HTTP 524），请重试、降低分辨率，或临时切换为 Gemini 直连': 'The Cloudflare proxy timed out while waiting for Gemini (HTTP 524). Retry, lower the resolution, or temporarily switch to Gemini direct.',
  '已停止': 'Stopped',
  '未生成': 'Not generated',
  '准备生成': 'Ready to generate',
  '暂无数据': 'No data',
  '暂无生成结果': 'No generated results',
  '内置预设': 'Built-in presets',
  '快捷提示词': 'Prompt presets',
  '欧美圣诞节': 'Western Christmas',
  '欧美感恩节': 'Western Thanksgiving',
  '欧美万圣节': 'Western Halloween',
  '欧美情人节': "Western Valentine's Day",
  '玻璃杯 Logo 雕刻': 'Engraved logo on a glass',
  '白色 Logo 激光雕刻玻璃杯': 'White logo laser-engraved on a glass',
  '木盒 Logo 激光雕刻': 'Logo laser-engraved on a wooden box',
  '保存当前输入框为预设': 'Save current prompt as preset',
  '预设已保存': 'Preset saved',
  '重命名预设': 'Rename preset',
  '保存预设': 'Save preset',
  '预设名称': 'Preset name',
  '定位 Logo': 'Position logo',
  '重新定位': 'Edit placement',
  '清除定位': 'Clear placement',
  '可视化定位': 'Visual placement',
  '局部重绘定位': 'Inpainting placement',
  '框选': 'Rectangle',
  '涂抹': 'Brush',
  '画笔大小': 'Brush size',
  '反相 Logo 颜色': 'Invert logo colors',
  '取消反相': 'Disable inversion',
  '确认定位': 'Confirm placement',
  '取消': 'Cancel',
  '确定': 'OK',
  '关闭': 'Close',
  '应用': 'Apply',
  '保存': 'Save',
  '复制': 'Copy',
  '上移': 'Move up',
  '下移': 'Move down',
  '拖拽排序': 'Drag to reorder',
  '场景图': 'Scene image',
  '产品图': 'Product image',
  '原始图片': 'Source image',
  '原图': 'Source',
  '结果图片': 'Result image',
  '配对预览': 'Pair preview',
  '配对与 Logo 定位': 'Pairing and logo placement',
  '上传两列图片后将按顺序自动配对': 'Upload both image sets to pair them automatically by order.',
  '按上传顺序与 Logo 配对': 'Paired with logos in upload order',
  '建议上传透明背景 PNG': 'Transparent-background PNG recommended',
  '提示词定位': 'Prompt-directed placement',
  '分组': 'Group',
  '已配对': 'Paired',
  '未配对': 'Unpaired',
  '关于生成内容': 'About generated content',
  '语言': 'Language',
  '中文': '中文',
  '英文': 'English',
  '按提示词顺序与设置并发执行': 'Runs in prompt order using the configured concurrency.',
  '按产品图自动分组，点击卡片查看全部结果': 'Grouped automatically by product image. Click a card to view all results.',
  '上传商品图并填写信息后，让模型规划详情页提示词': 'Upload a product image and enter its information, then let the model plan the detail-page prompts.',
  '预览合成长图': 'Preview combined long image',
  '下载合成长图': 'Download combined long image',
  '下载全部 ZIP': 'Download all ZIP',
  '重新分析并生成提示词': 'Analyze again and create prompts',
  '该详情图暂无上图文字': 'This detail image has no on-image copy.',
  '新增上图文案': 'Add on-image copy',
  '生成此图': 'Generate this image',
  '停止任务': 'Stop tasks',
  '开始合成': 'Start compositing',
  '开始重绘': 'Start inpainting',
  '清空结果': 'Clear results',
  '尚未生成': 'Not generated yet',
  '已完成': 'Completed',
  '张': 'images',
  '条': 'prompts',
  '组': 'groups',
  '任务': 'tasks',
  '个任务': 'tasks',
  '生成': 'Generate',
  '上传': 'Upload',
  '组 × 每组': 'groups ×',
  '每组': 'per group',
  '组已配对': 'groups paired',
  '按': 'Estimated from',
  '张场景图': 'scene images',
  '张产品图': 'product images',
  '条提示词': 'prompts',
  '张 Logo 合成图': 'logo composites',
  '张局部重绘图': 'inpainted images',
  '张商品详情图': 'product detail images',
  '个独立请求估算，双图输入费用为近似值。': 'independent requests; two-image input cost is approximate.',
  '张详情图估算，不含商品分析文本 token。': 'detail images; product-analysis text tokens are excluded.',
  'PNG / JPEG / WebP，单张不超过 20MB': 'PNG / JPEG / WebP, max 20 MB per image',
  'PNG / JPEG / WebP，不超过 20MB': 'PNG / JPEG / WebP, max 20 MB',
  '点击预设会写入当前选中的提示词输入框；右键自定义预设可重命名或删除。': 'Click a preset to apply it to the selected prompt field; right-click a custom preset to rename or delete it.',
  '新增专属提示词': 'Add product-specific prompt',
  '编辑专属提示词': 'Edit product-specific prompt',
  '新增提示词': 'Add prompt',
  '编辑提示词': 'Edit prompt',
  '继续添加图片': 'Add more images',
  '删除图片': 'Remove image',
  '产品图专属提示词': 'Product-specific prompt',
  '这里的内容仅应用于当前产品图。发送请求时会追加到每条场景提示词后面。': 'This content applies only to the current product image and is appended to every scene prompt sent for it.',
  '快捷关键词（点击插入）': 'Quick keywords (click to insert)',
  '新增预设': 'Add preset',
  '编辑专属提示词预设': 'Edit product prompt preset',
  '新增专属提示词预设': 'Add product prompt preset',
  '预设关键词': 'Preset keywords',
  '请填写预设名称和关键词': 'Enter a preset name and keywords.',
  '点击预设会插入而非覆盖；右键预设可编辑或删除。': 'Click a preset to insert it without replacing existing text; right-click to edit or delete.',
  '杯子尺寸': 'Cup dimensions',
  '高  CM，顶部杯口  CM直径，杯肚  CM': 'Height: ___ cm; top opening diameter: ___ cm; body diameter: ___ cm',
  '编辑': 'Edit',
  '例如：杯子高 22.6 CM，顶部杯口 7 CM直径，杯肚 9 CM；场景比例需符合真实物体尺寸。': 'Example: The cup is 22.6 cm tall, with a 7 cm top opening and a 9 cm body diameter. Keep the scene-to-cup scale true to real-world dimensions.',
  '官方定价': 'Official pricing',
  '例如：极简摄影棚': 'For example: minimalist photo studio',
  '例如：产品放置在浅色洞石台面上，晨光从左侧窗户照入，背景为柔焦现代客厅……': 'For example: Place the product on a light travertine surface, with morning light entering from the left and a softly blurred modern living room in the background…',
  '描述 Logo 放置位置、载体材质、融合方式、光影和需要保持不变的内容……': 'Describe the logo placement, surface material, blending style, lighting, and everything that must remain unchanged…',
  '例如：将选中区域的杯子颜色改为磨砂白色，保持其余区域完全不变……': 'For example: Change the cup in the selected area to matte white while keeping every other area unchanged…',
  '用自然语言填写商品名称、材质、尺寸、特点、目标用户、使用场景、品牌语气等。模型不会主动编造未提供的信息。': 'Describe the product name, material, dimensions, features, target audience, use cases, and brand voice in natural language. The model will not invent information you did not provide.',
  '仅修改红色选区': 'Modify only the red selected area',
  '红色区域是唯一允许 AI 修改的位置': 'The red area is the only region AI may modify',
  '重新选择图片会清除当前选区和生成结果。': 'Selecting another image clears the current selection and result.',
};

const phraseTranslations: Array<[string, string]> = [
  ['拖拽、点击或粘贴', 'Drag, click, or paste '],
  ['产品图', 'product image'],
  ['场景图', 'scene image'],
  ['详情图', 'detail image'],
  ['单张不超过 20MB', 'max 20 MB per image'],
  ['按产品图自动分组，点击卡片查看全部结果', 'Grouped by product image. Click a card to view all results.'],
  ['完成上方设置后，结果会按产品显示在这里', 'Results will appear here by product after setup.'],
  ['可填写 Worker 根地址或以 /v1beta 结尾的地址', 'Enter the Worker root URL or a URL ending in /v1beta.'],
  ['代理连接成功', 'Proxy connection successful'],
  ['代理连接失败', 'Proxy connection failed'],
  ['Cloudflare 代理等待 Gemini 响应超时（HTTP 524），请重试、降低分辨率，或临时切换为 Gemini 直连', 'The Cloudflare proxy timed out while waiting for Gemini (HTTP 524). Retry, lower the resolution, or temporarily switch to Gemini direct.'],
  ['已自动重试', 'Automatically retried'],
  ['次，建议稍后再试、降低并发或临时切换模型', 'time(s). Try again later, reduce concurrency, or temporarily switch models.'],
  ['请先填写代理地址', 'Enter a proxy URL first'],
  ['请检查地址、Worker 部署状态和 ALLOWED_ORIGINS', 'Check the URL, Worker deployment, and ALLOWED_ORIGINS'],
  ['上传图、任务和结果仅保留在当前页面会话', 'Uploads, tasks, and results remain only in this page session.'],
  ['所有 Nano Banana 生成图片均包含 SynthID 水印。', 'All images generated by Nano Banana contain a SynthID watermark. '],
  ['请确保你拥有上传图片的必要权利，并遵守 Gemini API 使用政策。', 'Make sure you have the rights to uploaded images and follow the Gemini API policy.'],
  ['点击预设会写入当前选中的提示词输入框', 'Click a preset to apply it to the selected prompt field'],
  ['右键自定义预设可重命名或删除', 'Right-click a custom preset to rename or delete it'],
];

function translateText(value: string): string {
  const trimmed = value.trim();
  const exact = translations[trimmed];
  if (exact) return value.replace(trimmed, exact);
  const regexTranslations: Array<[RegExp, string]> = [
    [/^准备替换 (\d+) 张图片$/, 'Ready to replace $1 images'],
    [/^(\d+) 张场景图 × 每张 (\d+) 个结果$/, '$1 scene images × $2 results each'],
    [/^场景 (\d+) · 结果 (\d+)$/, 'Scene $1 · Result $2'],
    [/^第 (\d+) 组$/, 'Group $1'],
    [/^按 (\d+) 个请求与 (\d+) 张输入参考图估算。$/, 'Estimated from $1 requests and $2 input reference images.'],
    [/^Logo 尺寸比例 · (\d+)%$/, 'Logo size ratio · $1%'],
    [/^杯口下边距比例 · (\d+)%$/, 'Margin below rim · $1%'],
    [/^(\d+) 张$/, '$1 images'],
    [/^(\d+) 条$/, '$1 prompts'],
    [/^准备生成 (\d+) 张场景图$/, 'Ready to generate $1 scene images'],
    [/^(\d+) 张产品图 × (\d+) 条提示词$/, '$1 product images × $2 prompts'],
    [/^按顺序一一对应 · (\d+) 张产品图 \/ (\d+) 条提示词$/, 'Pair by order · $1 product images / $2 prompts'],
    [/^准备生成 (\d+) 张 Logo 合成图$/, 'Ready to create $1 logo composites'],
    [/^(\d+) 组 × 每组 (\d+) 张$/, '$1 groups × $2 images each'],
    [/^(\d+)\/(\d+) 组已配对$/, '$1/$2 groups paired'],
    [/^生成 (\d+) 张局部重绘图$/, 'Generate $1 inpainted image'],
    [/^分析并生成 (\d+) 条提示词$/, 'Analyze and create $1 prompts'],
    [/^生成 (\d+) 张商品详情图$/, 'Generate $1 product detail images'],
    [/^按 (\d+) 个独立请求估算，双图输入费用为近似值。$/, 'Estimated from $1 independent requests; two-image input cost is approximate.'],
    [/^按 (\d+) 张详情图估算，不含商品分析文本 token。$/, 'Estimated for $1 detail images; product-analysis text tokens are excluded.'],
    [/^(\d+) 任务$/, '$1 tasks'],
  ];
  for (const [pattern, replacement] of regexTranslations) {
    if (pattern.test(trimmed)) return value.replace(trimmed, trimmed.replace(pattern, replacement));
  }
  let translated = value;
  phraseTranslations.forEach(([source, target]) => {
    translated = translated.replaceAll(source, target);
  });
  return translated;
}

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function DomTranslator({ language, children }: { language: AppLanguage; children: ReactNode }) {
  const originals = useRef(new WeakMap<Node, string>());
  const appliedText = useRef(new WeakMap<Node, string>());
  const attributeOriginals = useRef(new WeakMap<Element, Map<string, string>>());
  const appliedAttributes = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    const root = document.body;

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const lastApplied = appliedText.current.get(textNode);
        if (!originals.current.has(textNode) || textNode.data !== lastApplied) {
          originals.current.set(textNode, textNode.data);
        }
        const original = originals.current.get(textNode) ?? textNode.data;
        const next = language === 'en-US' ? translateText(original) : original;
        appliedText.current.set(textNode, next);
        if (textNode.data !== next) textNode.data = next;
        return;
      }
      if (!(node instanceof Element)) return;
      ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
        const current = node.getAttribute(attribute);
        if (!current) return;
        let saved = attributeOriginals.current.get(node);
        if (!saved) {
          saved = new Map();
          attributeOriginals.current.set(node, saved);
        }
        let applied = appliedAttributes.current.get(node);
        if (!applied) {
          applied = new Map();
          appliedAttributes.current.set(node, applied);
        }
        if (!saved.has(attribute) || current !== applied.get(attribute)) saved.set(attribute, current);
        const original = saved.get(attribute) ?? current;
        const next = language === 'en-US' ? translateText(original) : original;
        applied.set(attribute, next);
        if (current !== next) node.setAttribute(attribute, next);
      });
      node.childNodes.forEach(visit);
    };

    visit(root);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') visit(mutation.target);
        mutation.addedNodes.forEach(visit);
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);

  return children;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() =>
    localStorage.getItem(LANGUAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN',
  );
  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage }), [language]);
  const locale = language === 'en-US' ? { ...enUS, ...enUSX } : { ...zhCN, ...zhCNX };

  return (
    <LanguageContext.Provider value={value}>
      <XProvider
        locale={locale}
        theme={{
          token: {
            colorPrimary: '#7c5cff',
            borderRadius: 12,
            fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          },
        }}
      >
        <DomTranslator language={language}>{children}</DomTranslator>
      </XProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
