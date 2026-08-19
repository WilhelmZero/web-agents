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
  requestPrompt?: string;
  inputImages?: Blob[];
  resultSummary?: string;
  message?: string;
  outputImages?: Blob[];
}

const entries: RequestConsoleEntry[] = [];
const listeners = new Set<(items: RequestConsoleEntry[]) => void>();
const MAX_OUTPUT_IMAGES = 8;
const MAX_INPUT_IMAGES = 8;
const MAX_IMAGES_PER_ENTRY = 2;

function snapshot() {
  return [...entries].sort((a, b) => b.startedAt - a.startedAt);
}

function notify() {
  const items = snapshot();
  listeners.forEach((listener) => listener(items));
}

function trimRetainedImages(field: 'inputImages' | 'outputImages', limit: number) {
  let retained = 0;
  entries.forEach((item) => {
    const images = item[field];
    if (!images?.length) return;
    const available = Math.max(0, limit - retained);
    item[field] = images.slice(0, available);
    if (!item[field]?.length) delete item[field];
    retained += item[field]?.length || 0;
  });
}

export function subscribeRequestConsole(listener: (items: RequestConsoleEntry[]) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function startRequestConsoleEntry(input: Pick<RequestConsoleEntry, 'model' | 'connection' | 'requestSummary'> & Partial<Pick<RequestConsoleEntry, 'requestPrompt' | 'inputImages'>>) {
  const now = Date.now();
  const entry: RequestConsoleEntry = {
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    model: input.model,
    connection: input.connection,
    requestSummary: input.requestSummary,
    requestPrompt: input.requestPrompt?.trim() || undefined,
    inputImages: input.inputImages?.filter((image) => image.type.startsWith('image/')).slice(0, MAX_IMAGES_PER_ENTRY),
    status: 'running',
    attempt: 1,
  };
  entries.unshift(entry);
  if (entries.length > 60) entries.length = 60;
  trimRetainedImages('inputImages', MAX_INPUT_IMAGES);
  notify();
  return entry.id;
}

export function updateRequestConsoleEntry(id: string, patch: Partial<Omit<RequestConsoleEntry, 'id' | 'startedAt'>>) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  const outputImages = patch.outputImages?.filter((image) => image.type.startsWith('image/')).slice(0, MAX_IMAGES_PER_ENTRY);
  const inputImages = patch.inputImages?.filter((image) => image.type.startsWith('image/')).slice(0, MAX_IMAGES_PER_ENTRY);
  Object.assign(entry, patch, outputImages ? { outputImages } : {}, inputImages ? { inputImages } : {}, { updatedAt: Date.now() });
  trimRetainedImages('inputImages', MAX_INPUT_IMAGES);
  trimRetainedImages('outputImages', MAX_OUTPUT_IMAGES);
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
