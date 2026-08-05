import { describe, expect, it } from 'vitest';
import { buildGlassLogoEtchInstruction, buildLogoReplacementInstruction, buildObjectReplacementInstruction, getGeminiApiRoot, getProxyHealthUrl, isRetryableGeminiStatus } from './gemini';

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
  it('声明参考图顺序、全部替换和杯子专项限制', () => {
    const instruction = buildObjectReplacementInstruction({
      sourceObjectName: '玻璃杯',
      targetObjectName: '不锈钢保温杯',
      hasSourceReference: true,
      hasTargetReference: true,
      preservation: { print: true, logo: true, engraving: false, liquid: true, foam: false, custom: ['杯盖挂件'] },
    });
    expect(instruction).toContain('第一张图片');
    expect(instruction).toContain('第二张图片是原物体');
    expect(instruction).toContain('第三张图片是新物体');
    expect(instruction).toContain('必须全部替换');
    expect(instruction).toContain('每一个目标杯子');
    expect(instruction).toContain('印花、Logo、酒液或其他液体、杯盖挂件');
    expect(instruction).toContain('泡沫未被勾选');
    expect(instruction).toContain('酒液或其他液体');
    expect(instruction).not.toContain('原有液体液面');
  });

  it('无参考图且未勾选内容时允许酒液和泡沫随场景变化', () => {
    const instruction = buildObjectReplacementInstruction({
      sourceObjectName: '椅子', targetObjectName: '木凳', hasSourceReference: false, hasTargetReference: false,
      preservation: { print: false, logo: false, engraving: false, liquid: false, foam: false, custom: [] },
    });
    expect(instruction).not.toContain('第二张图片');
    expect(instruction).not.toContain('杯子专项替换');
    expect(instruction).not.toContain('严格保留：');
    expect(instruction).toContain('酒液、泡沫未被勾选');
    expect(instruction).toContain('允许模型根据新物体结构与当前场景自然调整');
    expect(instruction).toContain('规则优先于参考图外观、保持构图和其他任何约束');
  });
});