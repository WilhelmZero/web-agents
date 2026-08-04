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

  it('支持木盒激光雕刻并保护 Logo 小字字形', () => {
    const instruction = buildLogoReplacementInstruction({
      hasOldLogo: true,
      logoColorMode: 'white',
      logoEffect: 'laser-engrave',
      engravingTarget: 'wood-box',
      engravingMethod: '浅层激光烧蚀并保留木纹',
    });
    expect(instruction).toContain('场景中的木盒');
    expect(instruction).toContain('浅层激光烧蚀并保留木纹');
    expect(instruction).toContain('随木材本色自然变化');
    expect(instruction).toContain('严禁对 Logo 执行 OCR');
    expect(instruction).toContain('不得产生乱码');
    expect(instruction).toContain('字符的数量、顺序、大小写');
    expect(instruction).not.toContain('将新 Logo 转换为白色');
  });

  it('支持自定义雕刻物体和工艺', () => {
    const instruction = buildLogoReplacementInstruction({
      hasOldLogo: false, logoColorMode: 'original', logoEffect: 'deboss', engravingTarget: 'custom',
      customEngravingObject: '深蓝色皮革盒', engravingMethod: '低温压凹',
    });
    expect(instruction).toContain('深蓝色皮革盒');
    expect(instruction).toContain('低温压凹');
    expect(instruction).toContain('真实凹刻或压凹');
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