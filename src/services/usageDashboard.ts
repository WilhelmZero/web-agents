export interface UsageRow {
  day?: string;
  source?: string;
  tool?: string;
  provider?: string;
  model?: string;
  status?: string;
  requests?: number | string;
  images?: number | string;
  retries?: number | string;
}

export interface UsageSummary {
  requests: number;
  images: number;
  retries: number;
  successful: number;
  failed: number;
  successRate: number | null;
  days: Array<{ day: string; requests: number; images: number }>;
  tools: Array<{ tool: string; requests: number; images: number }>;
  providers: Array<{ provider: string; requests: number }>;
}

function count(value: number | string | undefined, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function dateKey(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function summarizeUsage(rows: UsageRow[], periodDays: 7 | 30, tool = 'all', now = new Date()): UsageSummary {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Array.from({ length: periodDays }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - periodDays + index + 1);
    return { day: day.toISOString().slice(0, 10), requests: 0, images: 0 };
  });
  const firstDay = days[0].day;
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  const byTool = new Map<string, { tool: string; requests: number; images: number }>();
  const byProvider = new Map<string, { provider: string; requests: number }>();
  let requests = 0;
  let images = 0;
  let retries = 0;
  let successful = 0;
  let failed = 0;

  for (const row of rows) {
    const day = dateKey(row.day);
    if (!day || day < firstDay || day > days[days.length - 1].day || (tool !== 'all' && row.tool !== tool)) continue;
    const rowRequests = count(row.requests, 1);
    const rowImages = count(row.images);
    requests += rowRequests;
    images += rowImages;
    retries += count(row.retries);
    if (row.status === 'success') successful += rowRequests;
    else if (['failed', 'interrupted'].includes(row.status || '')) failed += rowRequests;
    const daily = byDay.get(day)!;
    daily.requests += rowRequests;
    daily.images += rowImages;
    const toolKey = row.tool || 'unknown';
    const toolEntry = byTool.get(toolKey) || { tool: toolKey, requests: 0, images: 0 };
    toolEntry.requests += rowRequests;
    toolEntry.images += rowImages;
    byTool.set(toolKey, toolEntry);
    const providerKey = row.provider || 'unknown';
    const providerEntry = byProvider.get(providerKey) || { provider: providerKey, requests: 0 };
    providerEntry.requests += rowRequests;
    byProvider.set(providerKey, providerEntry);
  }

  return {
    requests, images, retries, successful, failed,
    successRate: successful + failed ? Math.round((successful / (successful + failed)) * 100) : null,
    days,
    tools: [...byTool.values()].sort((a, b) => b.images - a.images || b.requests - a.requests),
    providers: [...byProvider.values()].sort((a, b) => b.requests - a.requests),
  };
}
