import { useEffect, useRef } from 'react';
import { loadServerDocument, saveServerDocument, serverPersistenceEnabled } from './serverPersistence';

function withoutObjectUrls<T extends object>(value: T): T {
  const output = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'url' && !key.endsWith('Url'))) as Record<string, unknown>;
  if (Array.isArray(output.outpaintResults)) output.outpaintResults = output.outpaintResults.map((result: object) => Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'url')));
  return output as T;
}

function withObjectUrls<T extends object>(value: T, tool: string): T {
  const item = { ...value } as Record<string, unknown>;
  const sourceUrlKey = tool === 'paper-text' ? 'url' : tool.endsWith('products') || tool.endsWith('scenes') ? 'previewUrl' : 'sourceUrl';
  for (const [blobKey, urlKey] of [['file', sourceUrlKey], ['aiResultBlob', 'aiResultUrl'], ['resultBlob', 'resultUrl'], ['outpaintBlob', 'outpaintUrl']]) {
    if (item[blobKey] instanceof Blob) item[urlKey] = URL.createObjectURL(item[blobKey] as Blob);
  }
  if (Array.isArray(item.outpaintResults)) item.outpaintResults = item.outpaintResults.map((result: { blob?: Blob }) => ({ ...result, url: result.blob instanceof Blob ? URL.createObjectURL(result.blob) : undefined }));
  if (item.status === 'running' || item.status === 'waiting') item.status = 'failed';
  if ((item.status === 'success' || item.status === 'done') && 'resultBlob' in item && !item.resultBlob) {
    item.status = 'failed';
    item.error = '服务器生成结果已过期，请重新生成。';
  }
  return item as T;
}

export function useServerCollection<T extends object>(tool: string, items: T[], setItems: (items: T[]) => void): void {
  const hydrated = useRef(false);
  const writer = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!serverPersistenceEnabled()) return;
    let alive = true;
    void loadServerDocument<T[]>(`${tool}:collection`).then((stored) => {
      if (alive && stored) setItems(stored.map((item) => withObjectUrls(item, tool)));
      hydrated.current = true;
    }).catch(() => { hydrated.current = true; });
    return () => { alive = false; };
  }, [tool, setItems]);
  useEffect(() => {
    if (!serverPersistenceEnabled() || !hydrated.current) return;
    const snapshot = items.map(withoutObjectUrls);
    writer.current = writer.current.catch(() => {}).then(() => saveServerDocument(`${tool}:collection`, snapshot, tool));
  }, [items, tool]);
}
