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
});
