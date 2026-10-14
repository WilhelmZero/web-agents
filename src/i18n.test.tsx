import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from './i18n';
import { localizeMoreToolDefault } from './moreToolI18n';

function DynamicCount() {
  const [count, setCount] = useState(0);
  return (
    <>
      <div data-testid="count">{count} 张</div>
      <button onClick={() => setCount((current) => current + 1)}>增加</button>
    </>
  );
}

function CupAndStickerTranslationFixture() {
  return <>
    <label>图案缩放 {147}%</label>
    <label>水平缩放 {100}%</label>
    <label>斜边方向缩放 {100}%</label>
    <div>矩形扩图历史（完成后自动应用）</div>
    <div>候选 {2} · GPT Image</div>
    <div>{`生成按参考图 ${1024}×${1536} 的比例进行；高清档等比本地放大，不裁切画面，也不会增加 AI 原生细节。`}</div>
    <input aria-label="图片缩放滑动条" />
  </>;
}

function MoreToolTranslationFixture() {
  return <>
    <nav>更多工具</nav>
    <button>场景 + Logo 一次替换</button>
    <button>自动分类 Logo 替换</button>
    <label>选择要导入的图片目录</label>
    <label>输出图片比例</label>
    <label>图形分组间距</label>
  </>;
}

function RemainingEnglishCopyFixture() {
  return <>
    <span title="系统就绪" aria-label="AI 累计生成 3 张图片">Scene Studio</span>
    <div>本站服务器转发 AI 请求</div>
    <div>服务器环境变量中的 Key 优先。未配置时，此窗口的备用 Key 保存在当前浏览器，仅通过 HTTPS 发送给本站服务器；请勿在不受信任的设备上配置。</div>
    <div>控制台不会记录 API Key 或 Base64 请求正文；提示词与缩略图详情默认收起，输入和输出图片各最多保留最近 8 张；每次最多显示 4 张输入、2 张输出，日志仅保留在当前页面会话。</div>
    <div>当前模式由 AI 直接生成包含背景底色的完整图片。</div>
  </>;
}

describe('语言层动态内容', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('中文模式不会把 React 更新后的数量恢复成初始值', async () => {
    render(<LanguageProvider><DynamicCount /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: '增加' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1 张'));
  });

  it('英文模式会在数量变化后保留最新数值并重新翻译', async () => {
    localStorage.setItem('scene-studio-language', 'en-US');
    render(<LanguageProvider><DynamicCount /></LanguageProvider>);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0 images'));
    fireEvent.click(screen.getByRole('button', { name: '增加' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1 images'));
  });

  it('translates split cup controls, outpainting history, and dynamic reference dimensions', async () => {
    localStorage.setItem('scene-studio-language', 'en-US');
    render(<LanguageProvider><CupAndStickerTranslationFixture /></LanguageProvider>);
    expect(await screen.findByText('Artwork scale 147%')).toBeVisible();
    expect(screen.getByText('Horizontal scale 100%')).toBeVisible();
    expect(screen.getByText('Slanted-side scale 100%')).toBeVisible();
    expect(screen.getByText('Rectangular outpainting history (applied automatically when complete)')).toBeVisible();
    expect(screen.getByText('Candidate 2 · GPT Image')).toBeVisible();
    expect(screen.getByText(/Generation follows the 1024×1536 reference ratio/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Image scale slider' })).toBeVisible();
  });

  it('translates secondary tool navigation and key controls in English mode', async () => {
    localStorage.setItem('scene-studio-language', 'en-US');
    render(<LanguageProvider><MoreToolTranslationFixture /></LanguageProvider>);
    expect(await screen.findByText('More tools')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace scene and logo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Auto-classified Logo replacement' })).toBeVisible();
    expect(screen.getByText('Choose image folders to import')).toBeVisible();
    expect(screen.getByText('Output image aspect ratio')).toBeVisible();
    expect(screen.getByText('Shape grouping distance')).toBeVisible();
  });

  it('switches only untouched secondary-tool default prompts', () => {
    const original = '替换为海滨夏日主题';
    const english = localizeMoreToolDefault(original, 'en-US');
    expect(english).toBe('Change to a summer beach theme');
    expect(localizeMoreToolDefault(english, 'zh-CN')).toBe(original);
    expect(localizeMoreToolDefault('A custom prompt', 'zh-CN')).toBe('A custom prompt');
  });

  it('translates remaining English-mode status, configuration, and help copy', async () => {
    localStorage.setItem('scene-studio-language', 'en-US');
    render(<LanguageProvider><RemainingEnglishCopyFixture /></LanguageProvider>);
    await waitFor(() => expect(screen.getByText('Scene Studio')).toHaveAttribute('title', 'System ready'));
    expect(screen.getByText('Scene Studio')).toHaveAttribute('aria-label', 'AI generated 3 images in total');
    expect(screen.getByText('AI requests are routed through this server')).toBeVisible();
    expect(screen.getByText(/Server environment keys take priority/)).toBeVisible();
    expect(screen.getByText(/The console does not record API keys/)).toBeVisible();
    expect(screen.getByText(/AI generates the complete image/)).toBeVisible();
  });
});
