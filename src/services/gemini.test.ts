import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGlassLogoEtchInstruction, buildLogoReplacementInstruction, buildObjectReplacementInstruction, getGeminiApiRoot, getProxyHealthUrl, isRetryableGeminiStatus, verifyLogoReplacement } from './gemini';

describe('Gemini API 地址', () => {
  it('未配置代理时直连 Google', () => {
    expect(getGeminiApiRoot('')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('为 Worker 根地址补充 v1beta 路径', () => {
    expect(getGeminiApiRoot('https://proxy.example.workers.dev/'))
      .toBe('https://proxy.example.workers.dev/v1beta');
  });

  it('不会重复追加已有的 v1beta 路径', () => {
    expect(getGeminiApiRoot('https://proxy.example.workers.dev/v1beta'))
      .toBe('https://proxy.example.workers.dev/v1beta');
  });

  it('从代理根地址或 v1beta 地址生成健康检查地址', () => {
    expect(getProxyHealthUrl('https://proxy.example.workers.dev/'))
      .toBe('https://proxy.example.workers.dev/health');
    expect(getProxyHealthUrl('https://proxy.example.workers.dev/v1beta'))
      .toBe('https://proxy.example.workers.dev/health');
  });

  it('只对临时性服务错误进行自动重试', () => {
    expect([408, 429, 500, 502, 503, 504, 524].every(isRetryableGeminiStatus)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryableGeminiStatus)).toBe(false);
  });
});

describe('Logo 结果校验', () => {
  afterEach(() => vi.restoreAllMocks());

  it('提交参考图、生成图和准确文字并解析结构化结果', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ passed: false, referenceText: 'NAME', generatedText: 'N4ME', differences: ['A 被替换为 4'], graphicConsistent: true, summary: '字符不一致' }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const reference = new File(['logo'], 'logo.png', { type: 'image/png' });
    const generated = new Blob(['result'], { type: 'image/png' });
    const result = await verifyLogoReplacement({ apiKey: 'test-key', model: 'gemini-3.1-flash-lite', referenceLogo: reference, generatedImage: generated, expectedText: 'NAME', apiBaseUrl: null });
    expect(result).toMatchObject({ passed: false, referenceText: 'NAME', generatedText: 'N4ME', graphicConsistent: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.contents[0].parts[0].text).toContain('准确文字必须逐字符等于〈NAME〉');
    expect(body.contents[0].parts[0].text).toContain('differences 数组中的每一项和 summary 必须使用简体中文描述');
    expect(body.contents[0].parts[0].text).toContain('referenceText 和 generatedText 只记录图片中实际识别到的原始字符');
    expect(body.contents[0].parts.filter((part: { inlineData?: unknown }) => part.inlineData)).toHaveLength(2);
  });
});
describe('玻璃杯 Logo 雕刻技能指令', () => {
  it('将所有可调参数写入生成指令', () => {
    const instruction = buildGlassLogoEtchInstruction({
      scaleRatio: 0.65,
      topMarginRatio: 0.12,
      logoColor: 'black',
      textureMode: 'print',
      applyAllCups: false,
      outputCoordinateMode: 'pixel',
    });
    expect(instruction).toContain('min(W,H) × 0.65');
    expect(instruction).toContain('H × 0.12');
    expect(instruction).toContain('黑色');
    expect(instruction).toContain('实色表面油墨印刷');
    expect(instruction).toContain('仅对画面层级最靠前');
    expect(instruction).toContain('原图像素');
    expect(instruction).toContain('其他内容完全不变');
  });
});

describe('Logo 替换指令', () => {
  it('有旧 Logo 时声明三张图片顺序并限制仅修改 Logo', () => {
    const instruction = buildLogoReplacementInstruction({ hasOldLogo: true, logoColorMode: 'custom', customLogoColor: '#1a2b3c' });
    expect(instruction).toContain('第二张图片是旧 Logo');
    expect(instruction).toContain('第三张图片');
    expect(instruction).toContain('#1a2b3c');
    expect(instruction).toContain('若同一场景存在多个旧 Logo，必须全部替换');
    expect(instruction).toContain('原图所有像素对应内容必须保持不变');
    expect(instruction).toContain('杯体及曲面贴合强制规则');
    expect(instruction).toContain('当作附着于该三维表面的二维纹理进行 UV 投影');
    expect(instruction).toContain('左右两侧逐渐横向压缩');
    expect(instruction).toContain('严禁复制或继承旧 Logo 的平面形状、错误弧度');
    expect(instruction).toContain('杯口与杯底椭圆');
    expect(instruction).toContain('而不是照抄旧 Logo');
    expect(instruction).toContain('上、中、下三条水平带');
    expect(instruction).toContain('禁止平面贴纸感');
  });

  it('将准确文字和校验差异作为不可覆盖的修复约束', () => {
    const instruction = buildLogoReplacementInstruction({
      hasOldLogo: false,
      logoColorMode: 'original',
      expectedText: 'NAME’S CLASS 2026',
      correctionFeedback: '生成结果把 CLASS 写成了 CL4SS',
    });
    expect(instruction).toContain('〈NAME’S CLASS 2026〉');
    expect(instruction).toContain('大小写、空格、数字和标点完全一致');
    expect(instruction).toContain('生成结果把 CLASS 写成了 CL4SS');
    expect(instruction).toContain('不得改变位置、曲面贴合、工艺或场景其他内容');
  });
  it('自动模式逐个识别并沿用同一场景中的多种原工艺', () => {
    const instruction = buildLogoReplacementInstruction({ hasOldLogo: true, logoColorMode: 'white', engravingMode: 'auto' });
    expect(instruction).toContain('每一个旧 Logo 当前真实采用的制作或雕刻工艺');
    expect(instruction).toContain('木盒上的 Logo 沿用该木盒原有');
    expect(instruction).toContain('玻璃上的 Logo 沿用原有');
    expect(instruction).toContain('多种不同工艺');
    expect(instruction).toContain('逐个识别、逐个匹配');
    expect(instruction).not.toContain('将新 Logo 转换为白色');
  });
  it('区分木盒深色烧蚀并保护 Logo 小字字形', () => {
    const instruction = buildLogoReplacementInstruction({
      hasOldLogo: true, logoColorMode: 'white', woodEngravingEnabled: true, woodEngravingStyle: 'dark-burn',
    });
    expect(instruction).toContain('旧 Logo 位于木盒');
    expect(instruction).toContain('深色激光烧蚀雕刻');
    expect(instruction).toContain('深棕至炭黑色');
    expect(instruction).toContain('严禁生成白色、乳白色、浅色');
    expect(instruction).toContain('参考图本身是白色也必须忽略其颜色');
    expect(instruction).toContain('严禁对 Logo 执行 OCR');
    expect(instruction).toContain('不得产生乱码');
    expect(instruction).not.toContain('将新 Logo 转换为白色');
  });

  it('支持木盒原木同色浅雕和自定义方式', () => {
    const natural = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original', woodEngravingEnabled: true, woodEngravingStyle: 'natural-recessed', woodEngravingColorDepth: 0 });
    expect(natural).toContain('原木同色浅雕或凹刻');
    expect(natural).toContain('颜色深浅参数为 0%');
    expect(natural).toContain('颜色差必须近似 0%');
    expect(natural).toContain('不能使用固定默认色');
    expect(natural).toContain('绝对禁止深色轮廓');
    expect(natural).toContain('只在木材表面刻出极浅的真实几何凹槽');
    expect(natural).toContain('参考图的黑色或白色仅代表图形蒙版');
    expect(natural).toContain('输出前最终强制验收');
    expect(natural).toContain('黑色、白色及任何颜色像素只能用于确定凹槽的形状和位置');
    expect(natural).toContain('如果初步结果看起来像深色线稿');
    const darkNatural = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original', woodEngravingEnabled: true, woodEngravingStyle: 'natural-recessed', woodEngravingColorDepth: 85 });
    expect(darkNatural).toContain('22%–38%');
    expect(darkNatural).toContain('凹槽物理深度始终保持极浅且固定');
    const custom = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original', woodEngravingEnabled: true, woodEngravingStyle: 'custom', customWoodEngravingMethod: '浅金色精细线雕' });
    expect(custom).toContain('浅金色精细线雕');
  });

  it('玻璃默认使用激光磨砂雕刻并支持其他自定义载体', () => {
    const glass = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original', glassEngravingEnabled: true, woodEngravingEnabled: true });
    expect(glass).toContain('玻璃激光磨砂雕刻');
    expect(glass).toContain('半透明乳白或雾化蚀刻');
    expect(glass).toContain('木盒工艺雕刻');
    expect(glass).toContain('可在同一张场景图中同时生效');
    expect(glass).toContain('自动识别木盒底色并逐个选择工艺');
    expect(glass).toContain('深色木材或深色涂层');
    expect(glass).toContain('浅色木材或浅色涂层');
    const custom = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original', customEngravingEnabled: true, customEngravingObject: '深蓝色皮革盒', engravingMethod: '低温压凹' });
    expect(custom).toContain('深蓝色皮革盒');
    expect(custom).toContain('低温压凹');
  });
  it('未提供旧 Logo 时使用双图说明', () => {
    const instruction = buildLogoReplacementInstruction({ hasOldLogo: false, logoColorMode: 'original' });
    expect(instruction).toContain('第二张图片是必须用于替换的新 Logo');
    expect(instruction).not.toContain('第三张图片');
    expect(instruction).toContain('严格保持新 Logo 原始颜色');
  });
});

describe('物体批量替换指令', () => {
  it('只移植新杯本体和勾选的表面特征，其他内容跟随原场景', () => {
    const instruction = buildObjectReplacementInstruction({
      sourceObjectName: '玻璃杯', targetObjectName: '不锈钢保温杯', hasSourceReference: true, hasTargetReference: true,
      preservation: { print: true, logo: true, engraving: false, liquid: false, foam: false, custom: [] },
    });
    expect(instruction).toContain('第一张图片是原始场景图');
    expect(instruction).toContain('第二张图片仅用于帮助识别原物体');
    expect(instruction).toContain('第三张图片是新物体本体参考图');
    expect(instruction).toContain('全部实例都必须替换，不得遗漏');
    expect(instruction).toContain('杯身或物体表面的印花、Logo');
    expect(instruction).toContain('杯子本体专项');
    expect(instruction).toContain('实体杯身外壳、杯口、杯底');
    expect(instruction).toContain('液体类型、颜色、液面高度和可见状态');
    expect(instruction).toContain('原场景有泡沫时保持原有泡沫');
    expect(instruction).toContain('手部握持点和前后遮挡顺序');
    expect(instruction).toContain('最终高度只能由新杯参考图决定');
    expect(instruction).toContain('严格按新杯原始总高与最大宽度之比计算最终高度');
    expect(instruction).toContain('新杯较高时必须允许其轮廓自然向上延伸');
    expect(instruction).toContain('严禁压缩新杯高度以匹配旧杯');
    expect(instruction).toContain('禁止使用旧物体可见高度约束新物体高度');
    expect(instruction).toContain('严禁任何横向或纵向非等比拉伸');
    expect(instruction).toContain('Sx = Sy = Sz');
    expect(instruction).toContain('严禁用旧物体高度反推或限制该倍率');
    expect(instruction).toContain('扩展局部编辑区域容纳完整新物体');
    expect(instruction).toContain('归一化轮廓与新物体参考图逐段比较');
    expect(instruction).toContain('任何杯口、杯肚、腰线、杯底或其他轮廓比例偏差都判定为不合格');
    expect(instruction).toContain('不可编辑轮廓路径');
    expect(instruction).toContain('y/H = 0%、10%、25%、50%、75%、90%、100%');
    expect(instruction).toContain('轮廓宽度误差不得超过参考值约 1%');
    expect(instruction).toContain('杯底外扩角度、底脚圆角半径');
    expect(instruction).toContain('尤其禁止生成比新物体参考图更宽或更厚的杯底');
    expect(instruction).toContain('逆投影回标准正视比例');
    expect(instruction).toContain('改变腰线、曲线、锥度或杯肚宽度');
    expect(instruction).toContain('旧物体轮廓与按新物体真实比例放置后的新轮廓之并集');
    expect(instruction).toContain('旧物体上的同类印花、Logo、文字和雕刻全部属于旧物体本体');
    expect(instruction).toContain('最终只能出现新物体参考图中的表面图案');
    expect(instruction).toContain('禁止 OCR 后重新拼写');
    expect(instruction).toContain('不得复制参考图中的背景、构图、相机角度');
  });

  it('未勾选目标参考元素时不从目标图带入并保持原场景内容', () => {
    const instruction = buildObjectReplacementInstruction({
      sourceObjectName: '椅子', targetObjectName: '木凳', hasSourceReference: false, hasTargetReference: false,
      preservation: { print: false, logo: false, engraving: false, liquid: false, foam: false, custom: [] },
    });
    expect(instruction).not.toContain('第二张图片');
    expect(instruction).not.toContain('杯子本体专项');
    expect(instruction).toContain('不要强制复制新物体参考图上的印花、Logo、雕刻或装饰');
    expect(instruction).toContain('原场景有液体时必须保留');
    expect(instruction).toContain('原场景没有时不得新增');
    expect(instruction).toContain('原场景是除新物体本体身份之外所有信息的最高优先级来源');
    expect(instruction).toContain('变化必须仅限于旧物体轮廓、新物体真实比例轮廓及其紧邻融合边缘');
  });
});
