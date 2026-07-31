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
  '编写场景提示词': 'Write scene prompts',
  '详情图提示词': 'Detail image prompts',
  '局部重绘提示词': 'Inpainting prompt',
  '商品信息': 'Product information',
  '上图文案': 'Image copy',
  '新增文案': 'Add copy',
  '新增一行': 'Add row',
  '批量粘贴': 'Bulk paste',
  '批量粘贴提示词': 'Bulk paste prompts',
  '分割方式': 'Split mode',
  '自定义符号': 'Custom delimiter',
  '按回车分割': 'Split by line break',
  '分隔符': 'Delimiter',
  '粘贴内容': 'Paste content',
  '模型': 'Model',
  '图片模型': 'Image model',
  '分析模型': 'Analysis model',
  '优化模型': 'Optimization model',
  '模型版本': 'Model version',
  '质量、速度与成本平衡，推荐用于大多数场景。': 'A balanced choice for quality, speed, and cost; recommended for most scenarios.',
  '输出分辨率': 'Output resolution',
  '任务组合': 'Task combinations',
  '并发任务数': 'Concurrent tasks',
  '提示词工具': 'Prompt tools',
  '一键优化全部提示词': 'Optimize all prompts',
  '本地配置': 'Local settings',
  '合成设置': 'Composite settings',
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
  '官方定价': 'Official pricing',
  '仅修改红色选区': 'Modify only the red selected area',
  '红色区域是唯一允许 AI 修改的位置': 'The red area is the only region AI may modify',
  '重新选择图片会清除当前选区和生成结果。': 'Selecting another image clears the current selection and result.',
  '用自然语言填写商品名称、材质、尺寸、特点、目标用户、使用场景、品牌语气等。模型不会主动编造未提供的信息。': 'Describe the product name, material, dimensions, features, audience, use cases, and brand voice. The model will not invent missing information.',
};

const phraseTranslations: Array<[string, string]> = [
  ['拖拽、点击或粘贴', 'Drag, click, or paste '],
  ['单张不超过 20MB', 'max 20 MB per image'],
  ['按产品图自动分组，点击卡片查看全部结果', 'Grouped by product image. Click a card to view all results.'],
  ['完成上方设置后，结果会按产品显示在这里', 'Results will appear here by product after setup.'],
  ['可填写 Worker 根地址或以 /v1beta 结尾的地址', 'Enter the Worker root URL or a URL ending in /v1beta.'],
  ['代理连接成功', 'Proxy connection successful'],
  ['代理连接失败', 'Proxy connection failed'],
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
  const attributeOriginals = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    const root = document.body;

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        if (!originals.current.has(textNode)) originals.current.set(textNode, textNode.data);
        const original = originals.current.get(textNode) ?? textNode.data;
        const next = language === 'en-US' ? translateText(original) : original;
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
        if (!saved.has(attribute)) saved.set(attribute, current);
        const original = saved.get(attribute) ?? current;
        node.setAttribute(attribute, language === 'en-US' ? translateText(original) : original);
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
