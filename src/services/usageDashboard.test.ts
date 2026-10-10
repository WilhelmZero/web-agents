import { expect, it } from 'vitest';
import { summarizeUsage } from './usageDashboard';

const now = new Date('2026-10-10T12:00:00Z');

it('sums server usage rows and keeps daily, tool and provider totals aligned', () => {
  const summary = summarizeUsage([
    { day: '2026-10-09T00:00:00.000Z', tool: 'scene', provider: 'openai', status: 'success', requests: '3', images: '5', retries: '1' },
    { day: '2026-10-09', tool: 'scene', provider: 'openai', status: 'failed', requests: 1, images: 0, retries: 2 },
    { day: '2026-10-10', tool: 'outpaint', provider: 'gemini', status: 'success', requests: 2, images: 2, retries: 0 },
  ], 7, 'all', now);
  expect(summary).toMatchObject({ requests: 6, images: 7, retries: 3, successful: 5, failed: 1, successRate: 83 });
  expect(summary.days.slice(-2)).toEqual([{ day: '2026-10-09', requests: 4, images: 5 }, { day: '2026-10-10', requests: 2, images: 2 }]);
  expect(summary.tools).toEqual([{ tool: 'scene', requests: 4, images: 5 }, { tool: 'outpaint', requests: 2, images: 2 }]);
  expect(summary.providers).toEqual([{ provider: 'openai', requests: 4 }, { provider: 'gemini', requests: 2 }]);
});

it('applies the selected tool and time window without inventing a success rate', () => {
  const rows = [
    { day: '2026-09-20', tool: 'scene', status: 'success', requests: 2, images: 2 },
    { day: '2026-10-09', tool: 'scene', status: 'failed', requests: 1, images: 0 },
    { day: '2026-10-09', tool: 'outpaint', status: 'success', requests: 5, images: 5 },
  ];
  expect(summarizeUsage(rows, 7, 'scene', now)).toMatchObject({ requests: 1, images: 0, successRate: 0 });
  expect(summarizeUsage(rows, 30, 'scene', now)).toMatchObject({ requests: 3, images: 2, successRate: 67 });
  expect(summarizeUsage([], 7, 'all', now).successRate).toBeNull();
});
