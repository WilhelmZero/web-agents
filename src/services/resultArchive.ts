import { useEffect, useRef } from 'react';
import { serverPersistenceEnabled } from './serverPersistence';

const blobVersions = new WeakMap<Blob, string>();
function versionOf(blob: Blob): string {
  let version = blobVersions.get(blob);
  if (!version) { version = crypto.randomUUID(); blobVersions.set(blob, version); }
  return version;
}

export interface ArchiveCandidate {
  id: string;
  status: string;
  resultBlob?: Blob;
  name: string;
  exportSpec?: Record<string, unknown>;
  jobId?: string;
  sourceBlob?: Blob;
  maskBlob?: Blob;
}

async function uploadPrivateImage(tool: string, blob: Blob, filename: string): Promise<string> {
  const response = await fetch('/api/assets', {
    method: 'POST', headers: { 'Content-Type': blob.type || 'image/png', 'X-Tool': tool, 'X-File-Name': encodeURIComponent(filename), 'X-Asset-Role': 'result' }, body: blob,
  });
  if (!response.ok) throw new Error(`成品图片保存失败（HTTP ${response.status}）`);
  return (await response.json() as { id: string }).id;
}

async function encodeExportSpec(tool: string, value: unknown, field = 'source'): Promise<unknown> {
  if (value instanceof Blob) return { __studioResultAsset: await uploadPrivateImage(tool, value, `${field}.png`) };
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => encodeExportSpec(tool, item, `${field}_${index}`)));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) output[key] = await encodeExportSpec(tool, item, key);
    return output;
  }
  return value;
}

export async function archiveFinalImage(tool: string, candidate: ArchiveCandidate): Promise<void> {
  if (!serverPersistenceEnabled() || !candidate.resultBlob || !['success', 'done'].includes(candidate.status)) return;
  const operationId = `${tool}:${candidate.id}`;
  const blob = candidate.resultBlob;
  if (!blob.type.startsWith('image/')) throw new Error('只有最终图片可加入生成结果');
  const filename = candidate.name.slice(0, 255);
  const existing = await fetch(`/api/results/operation/${encodeURIComponent(operationId)}`);
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error(`无法检查成品归档（HTTP ${existing.status}）`);
  const assetId = await uploadPrivateImage(tool, blob, filename);
  const sourceAssetId = candidate.sourceBlob ? await uploadPrivateImage(tool, candidate.sourceBlob, `source_${filename}`) : undefined;
  const maskAssetId = candidate.maskBlob ? await uploadPrivateImage(tool, candidate.maskBlob, `mask_${filename}`) : undefined;
  const exportSpec = await encodeExportSpec(tool, candidate.exportSpec || {});
  const resultResponse = await fetch('/api/results', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId, tool, assetId, name: filename, jobId: candidate.jobId, exportSpec: { ...(exportSpec as Record<string, unknown>), ...(sourceAssetId ? { sourceAssetId } : {}), ...(maskAssetId ? { maskAssetId } : {}) } }),
  });
  if (!resultResponse.ok) throw new Error(`生成结果登记失败（HTTP ${resultResponse.status}）`);
  window.dispatchEvent(new Event('studio:results-updated'));
}

export function useArchiveResults(tool: string, candidates: ArchiveCandidate[]): void {
  const submitted = useRef(new Set<string>());
  useEffect(() => {
    for (const candidate of candidates) {
      if (!candidate.resultBlob || !['success', 'done'].includes(candidate.status)) continue;
      const versionedId = `${candidate.id}:${versionOf(candidate.resultBlob)}`;
      if (submitted.current.has(versionedId)) continue;
      submitted.current.add(versionedId);
      void archiveFinalImage(tool, { ...candidate, id: versionedId }).catch((error) => {
        submitted.current.delete(versionedId);
        window.dispatchEvent(new CustomEvent('studio:archive-error', { detail: error instanceof Error ? error.message : String(error) }));
      });
    }
  }, [tool, candidates]);
}
