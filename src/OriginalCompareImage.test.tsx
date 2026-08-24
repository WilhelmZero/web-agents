import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OriginalCompareImage from './OriginalCompareImage';

describe('OriginalCompareImage', () => {
  it('opens the generated image directly and toggles the original from the preview toolbar', async () => {
    render(<OriginalCompareImage src="generated.png" originalSrc="original.png" alt="去除 Logo 结果" />);

    fireEvent.click(screen.getByRole('img', { name: '去除 Logo 结果' }));
    const showOriginal = await screen.findByRole('button', { name: '查看原图' });
    fireEvent.click(showOriginal);

    expect(screen.getByRole('button', { name: '查看生成图' })).toBeInTheDocument();
  });
});
