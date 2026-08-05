export type RequestConsoleStatus = 'running' | 'retrying' | 'success' | 'failed' | 'stopped';

export interface RequestConsoleEntry {
  id: string;
  startedAt: number;
  updatedAt: number;
  model: string;
  connection: 'direct' | 'proxy';
  status: RequestConsoleStatus;
  attempt: number;
  httpStatus?: number;
  durationMs?: number;
  requestSummary: string;
  resultSummary?: string;
  message?: string;
}

const entries: RequestConsoleEntry[] = [];
const listeners = new Set<(items: RequestConsoleEntry[]) => void>();

function snapshot() {
  return [...entries].sort((a, b) => b.startedAt - a.startedAt);
}

function notify() {
  const items = snapshot();
  listeners.forEach((listener) => listener(items));
}

export function subscribeRequestConsole(listener: (items: RequestConsoleEntry[]) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function startRequestConsoleEntry(input: Pick<RequestConsoleEntry, 'model' | 'connection' | 'requestSummary'>) {
  const now = Date.now();
  const entry: RequestConsoleEntry = {
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    model: input.model,
    connection: input.connection,
    requestSummary: input.requestSummary,
    status: 'running',
    attempt: 1,
  };
  entries.unshift(entry);
  if (entries.length > 200) entries.length = 200;
  notify();
  return entry.id;
}

export function updateRequestConsoleEntry(id: string, patch: Partial<Omit<RequestConsoleEntry, 'id' | 'startedAt'>>) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  Object.assign(entry, patch, { updatedAt: Date.now() });
  notify();
}

export function clearRequestConsole() {
  entries.length = 0;
  notify();
}

export function summarizeGeminiRequest(body: unknown) {
  const serialized = JSON.stringify(body);
  const imageCount = (serialized.match(/"inlineData"/g) || []).length;
  const textParts = (serialized.match(/"text":/g) || []).length;
  const size = serialized.match(/"imageSize":"([^"]+)"/)?.[1];
  const ratio = serialized.match(/"aspectRatio":"([^"]+)"/)?.[1];
  return [
    imageCount ? imageCount + ' 张输入图片' : '无输入图片',
    textParts + ' 段文本',
    size ? '输出 ' + size : '',
    ratio ? '比例 ' + ratio : '',
  ].filter(Boolean).join(' · ');
}