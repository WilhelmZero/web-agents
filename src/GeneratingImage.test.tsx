import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GeneratingImage from './GeneratingImage';
import { LanguageProvider } from './i18n';

describe('生成进度模拟', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('生成中每秒持续增加并且不会只停在第一次更新', () => {
    render(<LanguageProvider><GeneratingImage status="running" percent={1} /></LanguageProvider>);
    expect(screen.getByText('生成中… 1%')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('生成中… 2%')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('生成中… 3%')).toBeInTheDocument();
  });

  it('模拟进度最高停在 96%', () => {
    render(<LanguageProvider><GeneratingImage status="running" percent={95} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('生成中… 96%')).toBeInTheDocument();
  });

  it('同一个任务在结果卡和弹窗中共享完全相同的进度', () => {
    render(
      <LanguageProvider>
        <GeneratingImage progressKey="task-1" status="running" percent={1} />
        <GeneratingImage progressKey="task-1" status="running" percent={1} />
      </LanguageProvider>,
    );
    act(() => vi.advanceTimersByTime(2000));
    const labels = screen.getAllByText('生成中… 3%');
    expect(labels).toHaveLength(2);
  });
});
