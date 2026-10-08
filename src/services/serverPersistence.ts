const MARKER = '__studioAssetV1';
const knownAssets = new WeakMap<Blob, string>();

export function serverPersistenceEnabled(): boolean {
  return typeof window !== 'undefined' && window.__studioServerKeys !== undefined;
}

async function encode(value: unknown, tool: string, field = ''): Promise<unknown> {
  if (value instanceof Blob) {
    const known = knownAssets.get(value);
    if (known) return { [MARKER]: known, type: value.type, name: value instanceof File ? value.name : null, modified: value instanceof File ? value.lastModified : null };
    const response = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': value.type || 'application/octet-stream', 'X-Tool': tool, 'X-File-Name': encodeURIComponent(value instanceof File ? value.name : 'asset'), 'X-Asset-Role': /result|candidate|generated|outpaint|ai/i.test(field) ? 'result' : 'source' },
      body: value,
    });
    if (!response.ok) throw new Error(`服务器素材保存失败（HTTP ${response.status}）`);
    const result = await response.json() as { id: string };
    knownAssets.set(value, result.id);
    return { [MARKER]: result.id, type: value.type, name: value instanceof File ? value.name : null, modified: value instanceof File ? value.lastModified : null };
  }
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) output.push(await encode(item, tool, field));
    return output;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) output[key] = await encode(item, tool, key);
    return output;
  }
  return value;
}

async function decode(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(decode));
  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (typeof entry[MARKER] === 'string') {
      const response = await fetch(`/api/assets/${entry[MARKER]}`);
      if (response.status === 410) return undefined;
      if (!response.ok) throw new Error('无法读取服务器素材');
      const blob = await response.blob();
      const result = typeof entry.name === 'string' ? new File([blob], entry.name, { type: String(entry.type || blob.type), lastModified: Number(entry.modified || Date.now()) }) : blob;
      knownAssets.set(result, entry[MARKER]);
      return result;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(entry)) output[key] = await decode(item);
    return output;
  }
  return value;
}

export async function loadServerDocument<T>(key: string): Promise<T | null> {
  const response = await fetch(`/api/documents/${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error(`服务器项目读取失败（HTTP ${response.status}）`);
  const stored = await response.json() as unknown;
  return stored === null ? null : await decode(stored) as T;
}

export async function saveServerDocument(key: string, value: unknown, tool: string): Promise<void> {
  const encoded = await encode(value, tool);
  const response = await fetch(`/api/documents/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(encoded),
  });
  if (!response.ok) throw new Error(`服务器项目保存失败（HTTP ${response.status}）`);
}
