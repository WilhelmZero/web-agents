import { describe, expect, it } from 'vitest';
import type { LogoRemovalAnalysis, LogoRemovalSettings } from '../types';
import { DEFAULT_LOGO_REMOVAL_PROMPT, buildLogoRemovalAnalysisPrompt, buildLogoRemovalGenerationPrompt } from './logoRemoval';

const settings: LogoRemovalSettings = {
  scope: 'cup-body', analysisProvider: 'gemini', analysisModel: 'gemini-3.1-flash-lite', openAiAnalysisModel: 'gpt-5.6-luna',
  imageProvider: 'gemini', imageModel: 'gemini-3.1-flash-image', openAiImageModel: 'gpt-image-2', imageSize: '1K',
  verificationEnabled: true, verificationProvider: 'gemini', verificationModel: 'gemini-3.1-flash-lite', openAiVerificationModel: 'gpt-5.6-luna',
  prompt: DEFAULT_LOGO_REMOVAL_PROMPT, concurrency: 2, copiesPerImage: 1, verificationRetries: 2,
  autoRetryErrors: true, errorRetryLimit: 2, errorRetryDelaySeconds: 30,
};

const analysis: LogoRemovalAnalysis = {
  action: 'remove', summary: '杯身正面存在蚀刻 Logo', reason: '符合默认范围',
  targets: [{ id: 'target-1', carrier: '杯身', markType: '蚀刻', description: '杯身正面中上部', left: .32, top: .25, right: .68, bottom: .55, occlusion: '无' }],
  preserve: ['杯底尺寸文字', '背景卖点图标', '人物手势'],
};

describe('logo removal prompts', () => {
  it('limits the default analysis to cup body and protects layout text', () => {
    const prompt = buildLogoRemovalAnalysisPrompt('cup-body');
    expect(prompt).toContain('杯身外侧表面');
    expect(prompt).toContain('杯底、瓶体、礼盒和配件上的标识不属于目标');
    expect(prompt).toContain('商品说明、尺寸箭头和数字');
    expect(prompt).toContain('skip_no_target');
  });

  it('sends only analyzed target regions to generation and preserves non-target content', () => {
    const prompt = buildLogoRemovalGenerationPrompt(settings, analysis, '仍有文字残影');
    expect(prompt).toContain('left=0.3200');
    expect(prompt).toContain('right=0.6800');
    expect(prompt).toContain('杯底尺寸文字；背景卖点图标；人物手势');
    expect(prompt).toContain('仍有文字残影');
    expect(prompt).toContain('不得删除或修改其他内容');
  });

  it('changes scope without broadening unrelated text deletion', () => {
    expect(buildLogoRemovalAnalysisPrompt('cup-and-bottom')).toContain('杯底');
    expect(buildLogoRemovalAnalysisPrompt('all-product-carriers')).toContain('礼盒');
    expect(buildLogoRemovalAnalysisPrompt('all-product-carriers')).toContain('不得把商品说明');
  });
});
