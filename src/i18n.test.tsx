import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from './i18n';

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
});
